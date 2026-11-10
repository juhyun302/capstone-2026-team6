"""Design several candidates from one SolutionIdea, then draft, screen and review each."""

from concurrent.futures import ThreadPoolExecutor
from functools import partial
import json
from pathlib import Path

from jsonschema import Draft7Validator

from aleph.generation import (
    Complete,
    _first_valid,
    check_generation_request,
    extract_solution_idea,
    load_prompt,
    validate_candidate_question,
)
from aleph.review import _error, _strict_json, review_candidate
from aleph.similarity import THRESHOLD, similarity

_HERE = Path(__file__).parent
_DESIGN_SCHEMA = json.loads(
    (_HERE / "schemas/candidate_design.schema.json").read_text(encoding="utf-8")
)
Draft7Validator.check_schema(_DESIGN_SCHEMA)
_DESIGN_VALIDATOR = Draft7Validator(_DESIGN_SCHEMA)
_PLAN_KEYS = list(_DESIGN_SCHEMA["properties"]["plans"]["items"]["properties"])
MAX_CANDIDATES = 5
_SCOPE_REASON = ("선택한 교육과정 범위 안에서는 이 문항의 연계문항을 설계할 수 없다는 답이 왔습니다. "
                 "문항의 과목에 맞는 범위를 골라 다시 시도해 주세요.")


def _declined(design) -> bool:
    """A designer that cannot stay inside the scope answers with no plans or no changed axes."""
    plans = design.get("plans") if isinstance(design, dict) else None
    return isinstance(plans, list) and all(
        isinstance(plan, dict) and plan.get("changed_axes") == [] for plan in plans)


def _schema_problem(design) -> str:
    """Name the first rule a design broke, so a retry and a person can fix that rule."""
    error = min(_DESIGN_VALIDATOR.iter_errors(design),
                key=lambda e: ([str(part) for part in e.absolute_path], e.validator))
    path = list(error.absolute_path)
    if path == ["plans"] and error.validator in ("minItems", "maxItems"):
        return "설계안 수가 1개에서 5개 사이가 아닙니다"
    if len(path) < 2:
        return "최상위는 plans 하나만 가진 객체여야 합니다"
    index = path[1]
    plan = design["plans"][index]
    plan_id = plan.get("id") if isinstance(plan, dict) else None
    name = plan_id if isinstance(plan_id, str) and plan_id.strip() else f"{index + 1}번째 설계안"
    if len(path) == 2:
        if error.validator == "required":
            missing = [key for key in error.validator_value if key not in error.instance]
            return f"{name}에 {missing[0]} 항목이 없습니다"
        if error.validator == "additionalProperties":
            extra = sorted(key for key in error.instance if key not in _PLAN_KEYS)
            return f"{name}에 정해지지 않은 항목이 있습니다: {extra[0]}"
        return f"{name}이 객체가 아닙니다"
    key = path[2]
    if key == "changed_axes":
        if error.validator == "minItems":
            return f"{name}의 changed_axes가 3개보다 적습니다"
        return f"{name}의 changed_axes에 허용되지 않거나 겹치는 값이 있습니다"
    if key == "id":
        return f"{name}의 id가 p1~p9 형식이 아닙니다"
    if error.validator == "pattern":
        return f"{name}의 {key}에 한자가 들어 있습니다"
    if error.validator == "anyOf":
        return f"{name}의 {key}가 문장 또는 문장 배열이 아니거나 한자가 들어 있습니다"
    if error.validator == "minLength":
        return f"{name}의 {key}가 비어 있습니다"
    return f"{name}의 {key} 형식이 맞지 않습니다"


def validate_candidate_design(raw_output: str, *, count: int) -> dict:
    """Check the plan structure; whether a plan is a good idea is the reviewer's call."""
    if isinstance(count, bool) or not isinstance(count, int):
        raise TypeError("count must be an integer")
    try:
        design = _strict_json(raw_output)
    except ValueError:
        return _error("JSON_INVALID", "중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.", "design")
    if _declined(design):
        return {"status": "QUESTION_ERROR", "error_code": "SCOPE_CONFLICT",
                "reason": _SCOPE_REASON, "design": None}
    if not _DESIGN_VALIDATOR.is_valid(design):
        return _error("SCHEMA_INVALID", f"설계안이 규칙을 어겼습니다: {_schema_problem(design)}.", "design")
    plans = design["plans"]
    texts = [text for plan in plans for value in plan.values()
             for text in (value if isinstance(value, list) else [value]) if isinstance(text, str)]
    if any(not text.strip() for text in texts):
        return _error("EMPTY_TEXT", "공백만 있는 문자열을 설계로 사용할 수 없습니다.", "design")
    if len(plans) != count or len({plan["id"] for plan in plans}) != len(plans):
        return _error("DESIGN_INVALID", "설계안의 수나 ID가 요청과 다릅니다.", "design")
    return {"status": "OK", "error_code": None, "reason": None, "design": design}


def _design(complete: Complete, design_input: dict, count: int) -> dict:
    """Retry a malformed design once, telling the designer which rule the first one broke."""
    system = load_prompt("design_candidates")
    designed = validate_candidate_design(
        complete(system, json.dumps(design_input, ensure_ascii=False)), count=count)
    if designed["status"] == "OUTPUT_ERROR":
        retry = {**design_input, "previous_error": designed["reason"]}
        designed = validate_candidate_design(
            complete(system, json.dumps(retry, ensure_ascii=False)), count=count)
    return designed


def _draft(complete: Complete, source: dict, idea: dict, conditions: dict, plans: list,
           plan: dict) -> dict:
    siblings = [other for other in plans if other["id"] != plan["id"]]
    user = json.dumps({"source_question": source, "solution_idea": idea, "plan": plan,
                       "sibling_plans": siblings, **conditions}, ensure_ascii=False)
    return _first_valid(complete, load_prompt("generate_candidate"), user,
                        validate_candidate_question)


def _surface_checks(source_problem: str, statements: list) -> list:
    """Flag a later candidate, never the earlier one, when two are nearly the same."""
    checks, seen = [], []
    for statement in statements:
        if statement is None:
            checks.append(None)
            continue
        to_source = similarity(source_problem, statement)
        to_sibling = max((similarity(other, statement) for other in seen), default=0.0)
        checks.append({"source_similarity": to_source, "max_sibling_similarity": to_sibling,
                       "copy_suspected": max(to_source, to_sibling) >= THRESHOLD})
        seen.append(statement)
    return checks


def generate_linked_questions(request: dict, complete: Complete, *, count: int = 3,
                              workers: int = 3) -> dict:
    """Return every planned candidate; only reviewed ones carry a question to show (AC7)."""
    if isinstance(count, bool) or not isinstance(count, int):
        raise TypeError("count must be an integer")
    if not 1 <= count <= MAX_CANDIDATES:
        raise ValueError(f"count must be between 1 and {MAX_CANDIDATES}")
    source, conditions = check_generation_request(request)

    extraction = extract_solution_idea(request["source_question"], complete)
    if extraction["status"] != "OK":
        return {**extraction, "candidates": []}
    idea = extraction["solution_idea"]

    design_input = {"source_question": source, "solution_idea": idea, "count": count, **conditions}
    designed = _design(complete, design_input, count)
    if designed["status"] != "OK":
        return {"status": designed["status"], "error_code": designed["error_code"],
                "reason": designed["reason"], "solution_idea": idea, "candidates": []}
    plans = designed["design"]["plans"]

    with ThreadPoolExecutor(max_workers=workers) as pool:
        drafts = list(pool.map(partial(_draft, complete, source, idea, conditions, plans), plans))
    checks = _surface_checks(source["problem"], [
        draft["candidate_question"]["statement"] if draft["status"] == "OK" else None
        for draft in drafts])

    def review(index):
        if drafts[index]["status"] != "OK":
            return None
        return review_candidate(
            {"source_question": request["source_question"],
             "candidate_question": drafts[index]["candidate_question"],
             "curriculum_scope": conditions["curriculum_scope"]},
            complete, solution_idea=idea, surface_check=checks[index])

    with ThreadPoolExecutor(max_workers=workers) as pool:
        reviews = list(pool.map(review, range(len(plans))))

    candidates = []
    for plan, draft, check, reviewed in zip(plans, drafts, checks, reviews):
        failed = draft if draft["status"] != "OK" else reviewed if reviewed["status"] != "OK" else None
        outcome = failed or reviewed
        candidates.append({
            "id": plan["id"], "plan": plan, "surface_check": check,
            "status": outcome["status"], "error_code": outcome["error_code"],
            "reason": outcome["reason"],
            "candidate_question": None if failed else draft["candidate_question"],
            "review_result": None if failed else reviewed["review_result"],
            "transferable": None if failed else reviewed["solution_idea"]["transferable"],
        })

    if not any(candidate["review_result"] for candidate in candidates):
        return {"status": "OUTPUT_ERROR", "error_code": candidates[0]["error_code"],
                "reason": "검토까지 마친 후보가 하나도 없습니다.", "solution_idea": idea,
                "candidates": candidates}
    return {"status": "OK", "error_code": None, "reason": None, "solution_idea": idea,
            "candidates": candidates}
