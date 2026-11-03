"""Validate output structure and missing values, not mathematical evidence."""

import json
from pathlib import Path

from jsonschema import Draft7Validator

_SCHEMA = json.loads(
    (Path(__file__).parent / "schemas/solution_idea.schema.json").read_text(encoding="utf-8")
)
Draft7Validator.check_schema(_SCHEMA)
_VALIDATOR = Draft7Validator(_SCHEMA)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError("Non-standard JSON constant")


def _error(code, reason):
    return {
        "status": "QUESTION_ERROR" if code in {"MISSING_ELEMENTS", "MISSING_MECHANISM"} else "OUTPUT_ERROR",
        "error_code": code,
        "reason": reason,
        "solution_idea": None,
    }


def validate_solution_idea(raw_output: str, *, comparison_available: bool = False) -> dict:
    """Return a structural result; OK still requires source-evidence review."""
    if not isinstance(raw_output, str):
        raise TypeError("raw_output must be a string")
    if not isinstance(comparison_available, bool):
        raise TypeError("comparison_available must be a boolean")

    try:
        idea = json.loads(raw_output, object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    except ValueError:
        return _error("JSON_INVALID", "중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.")

    if not _VALIDATOR.is_valid(idea):
        return _error("SCHEMA_INVALID", "출력이 SolutionIdea 스키마의 키, 타입 또는 값 제약을 위반했습니다.")

    text_values = [idea["concept"], idea["mechanism"], *(idea["key_elements"] or [])]
    if any(isinstance(value, str) and not value.strip() for value in text_values):
        return _error("EMPTY_TEXT", "공백만 있는 문자열을 풀이 정보로 사용할 수 없습니다.")
    if "transferable" in idea and not comparison_available:
        return _error("COMPARISON_REQUIRED", "전이 여부를 판단하려면 원문과 후보의 풀이 비교 근거가 필요합니다.")
    if idea["key_elements"] is None:
        return _error("MISSING_ELEMENTS", "근거 있는 핵심 풀이 요소 두 개가 필요합니다.")
    if idea["mechanism"] is None:
        return _error("MISSING_MECHANISM", "두 핵심 풀이 요소의 연결 메커니즘이 필요합니다.")

    return {"status": "OK", "error_code": None, "reason": None, "solution_idea": idea}
