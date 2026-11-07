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
MAX_CANDIDATES = 5


def validate_candidate_design(raw_output: str, *, count: int) -> dict:
    """Check the plan structure; whether a plan is a good idea is the reviewer's call."""
    if isinstance(count, bool) or not isinstance(count, int):
        raise TypeError("count must be an integer")
    try:
        design = _strict_json(raw_output)
    except ValueError:
        return _error("JSON_INVALID", "중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.", "design")
    if not _DESIGN_VALIDATOR.is_valid(design):
        return _error("SCHEMA_INVALID", "설계안이 스키마의 키, 타입, 변화 축 수 또는 언어 제약을 위반했습니다.",
                      "design")
    plans = design["plans"]
    texts = [text for plan in plans for value in plan.values()
             for text in (value if isinstance(value, list) else [value]) if isinstance(text, str)]
    if any(not text.strip() for text in texts):
        return _error("EMPTY_TEXT", "공백만 있는 문자열을 설계로 사용할 수 없습니다.", "design")
    if len(plans) != count or len({plan["id"] for plan in plans}) != len(plans):
        return _error("DESIGN_INVALID", "설계안의 수나 ID가 요청과 다릅니다.", "design")
    return {"status": "OK", "error_code": None, "reason": None, "design": design}


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

    design_user = json.dumps({"source_question": source, "solution_idea": idea, "count": count,
                              **conditions}, ensure_ascii=False)
    designed = _first_valid(complete, load_prompt("design_candidates"), design_user,
                            partial(validate_candidate_design, count=count))
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
