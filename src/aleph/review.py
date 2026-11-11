"""Solve a candidate blind, review it, and keep every AI verdict provisional."""

from functools import partial
import json
from pathlib import Path

from jsonschema import Draft7Validator

from aleph.generation import (
    Complete,
    _first_valid,
    _source_text,
    extract_solution_idea,
    generate_candidate,
    load_prompt,
    validate_candidate_question,
)
from aleph.validation import _reject_constant, _unique_object, validate_solution_idea

_HERE = Path(__file__).parent


def _validator(name):
    schema = json.loads((_HERE / f"schemas/{name}.schema.json").read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


_BLIND_VALIDATOR = _validator("blind_solution")
_REVIEW_VALIDATOR = _validator("review_output")


def _error(code, reason, key):
    return {"status": "OUTPUT_ERROR", "error_code": code, "reason": reason, key: None}


def _strict_json(raw_output):
    if not isinstance(raw_output, str):
        raise TypeError("raw_output must be a string")
    return json.loads(raw_output, object_pairs_hook=_unique_object,
                      parse_constant=_reject_constant)


def validate_blind_solution(raw_output: str) -> dict:
    """Return a structural result; a solved status is not proof the answer is right."""
    try:
        blind = _strict_json(raw_output)
    except ValueError:
        return _error("JSON_INVALID", "중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.",
                      "blind_solution")
    if not _BLIND_VALIDATOR.is_valid(blind):
        return _error("SCHEMA_INVALID", "출력이 독립 풀이 스키마의 키, 타입 또는 값 제약을 위반했습니다.",
                      "blind_solution")
    if not blind["solution"].strip():
        return _error("EMPTY_TEXT", "공백만 있는 문자열을 풀이로 사용할 수 없습니다.", "blind_solution")
    return {"status": "OK", "error_code": None, "reason": None, "blind_solution": blind}


def validate_review_output(raw_output: str, *, blind_clean: bool,
                           copy_suspected: bool = False) -> dict:
    """Reject a USE that contradicts the reported issues; never rewrite the verdict."""
    if not isinstance(blind_clean, bool) or not isinstance(copy_suspected, bool):
        raise TypeError("blind_clean and copy_suspected must be booleans")
    try:
        review = _strict_json(raw_output)
    except ValueError:
        return _error("JSON_INVALID", "중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.",
                      "review_output")
    if not _REVIEW_VALIDATOR.is_valid(review):
        return _error("SCHEMA_INVALID", "출력이 검토 스키마의 키, 타입 또는 값 제약을 위반했습니다.",
                      "review_output")
    if not review["reason"].strip():
        return _error("EMPTY_TEXT", "공백만 있는 문자열을 검토 이유로 사용할 수 없습니다.", "review_output")

    blocked = (review["validity_issue"] or review["curriculum_issue"]
               or not review["transferable"] or not blind_clean or copy_suspected)
    if review["verdict"] == "USE" and blocked:
        return _error("VERDICT_CONFLICT", "확인된 문제가 있는 후보를 USE로 판정할 수 없습니다.",
                      "review_output")
    return {"status": "OK", "error_code": None, "reason": None, "review_output": review}


def _candidate(candidate_question: dict) -> dict:
    if not isinstance(candidate_question, dict):
        raise ValueError("candidate_question is required")
    checked = validate_candidate_question(json.dumps(candidate_question, ensure_ascii=False))
    if checked["status"] != "OK":
        raise ValueError(f"candidate_question: {checked['reason']}")
    return checked["candidate_question"]


def _confirmed_idea(solution_idea: dict) -> dict:
    checked = validate_solution_idea(json.dumps(solution_idea, ensure_ascii=False))
    if checked["status"] != "OK":
        raise ValueError(f"solution_idea: {checked['reason']}")
    return checked["solution_idea"]


def _failed(result: dict, solution_idea) -> dict:
    return {"status": result["status"], "error_code": result["error_code"],
            "reason": result["reason"], "solution_idea": solution_idea, "review_result": None}


def review_candidate(request: dict, complete: Complete, *, solution_idea: dict | None = None,
                     surface_check: dict | None = None) -> dict:
    """Pass a confirmed idea to avoid a second extraction of the same source."""
    scope = request.get("curriculum_scope")
    if not isinstance(scope, str) or not scope.strip():
        raise ValueError("curriculum_scope is required")
    source = _source_text(request.get("source_question") or {})
    candidate = _candidate(request.get("candidate_question"))

    if solution_idea is None:
        extraction = extract_solution_idea(request["source_question"], complete)
        if extraction["status"] != "OK":
            return _failed(extraction, None)
        idea = extraction["solution_idea"]
    else:
        idea = _confirmed_idea(solution_idea)

    blind_user = json.dumps({"statement": candidate["statement"], "curriculum_scope": scope},
                            ensure_ascii=False)
    solved = _first_valid(complete, load_prompt("solve_candidate"), blind_user,
                          validate_blind_solution)
    if solved["status"] != "OK":
        return _failed(solved, idea)

    blind = solved["blind_solution"]
    blind_clean = blind["status"] == "solved" and not blind["issues"]
    review_input = {"source_question": source, "solution_idea": idea,
                    "candidate_question": candidate, "blind_solution": blind,
                    "curriculum_scope": scope}
    if surface_check is not None:
        review_input["surface_check"] = surface_check
    copy_suspected = bool(surface_check and surface_check.get("copy_suspected"))
    review_user = json.dumps(review_input, ensure_ascii=False)
    reviewed = _first_valid(complete, load_prompt("review_candidate"), review_user,
                            partial(validate_review_output, blind_clean=blind_clean,
                                    copy_suspected=copy_suspected))
    if reviewed["status"] != "OK":
        return _failed(reviewed, idea)

    output = reviewed["review_output"]
    return {
        "status": "OK", "error_code": None, "reason": None,
        "solution_idea": {**idea, "transferable": output["transferable"]},
        "review_result": {
            "validity_issue": output["validity_issue"],
            "curriculum_issue": output["curriculum_issue"],
            "verdict": output["verdict"],
            "reason": output["reason"],
            "reviewer_type": "AI",
            "approval_status": "PROVISIONAL",
        },
    }


def generate_linked_question(request: dict, complete: Complete) -> dict:
    """Return a candidate only together with its provisional review (AC7)."""
    drafted = generate_candidate(request, complete)
    if drafted["status"] != "OK":
        return {**drafted, "review_result": None}

    reviewed = review_candidate(
        {"source_question": request["source_question"],
         "candidate_question": drafted["candidate_question"],
         "curriculum_scope": request["curriculum_scope"]},
        complete, solution_idea=drafted["solution_idea"])
    shown = drafted["candidate_question"] if reviewed["status"] == "OK" else None
    return {**reviewed, "candidate_question": shown}
