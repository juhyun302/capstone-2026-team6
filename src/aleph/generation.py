"""Extract a SolutionIdea and draft one candidate; review is a separate step."""

import json
from pathlib import Path
from typing import Callable

from jsonschema import Draft7Validator

from aleph.validation import _reject_constant, _unique_object, validate_solution_idea

_HERE = Path(__file__).parent
_SCHEMA = json.loads(
    (_HERE / "schemas/candidate_question.schema.json").read_text(encoding="utf-8")
)
Draft7Validator.check_schema(_SCHEMA)
_VALIDATOR = Draft7Validator(_SCHEMA)
_PROMPT_START = "<!-- prompt:start -->"
_PROMPT_END = "<!-- prompt:end -->"
_CONDITIONS = ("intended_use", "target_level", "curriculum_scope")

Complete = Callable[[str, str], str]


def load_prompt(name: str) -> str:
    """Return only the part of a prompt file that is sent to the model."""
    text = (_HERE / f"prompts/{name}.md").read_text(encoding="utf-8")
    if text.count(_PROMPT_START) != 1 or text.count(_PROMPT_END) != 1:
        raise ValueError(f"{name}: prompt markers must appear exactly once")
    return text.split(_PROMPT_START)[1].split(_PROMPT_END)[0].strip()


def _candidate_error(code, reason):
    return {"status": "OUTPUT_ERROR", "error_code": code, "reason": reason,
            "candidate_question": None}


def validate_candidate_question(raw_output: str) -> dict:
    """Return a structural result; OK says nothing about mathematical validity."""
    if not isinstance(raw_output, str):
        raise TypeError("raw_output must be a string")

    try:
        candidate = json.loads(raw_output, object_pairs_hook=_unique_object,
                               parse_constant=_reject_constant)
    except ValueError:
        return _candidate_error("JSON_INVALID", "중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.")

    if not _VALIDATOR.is_valid(candidate):
        return _candidate_error("SCHEMA_INVALID", "출력이 후보 문항 스키마의 키, 타입 또는 값 제약을 위반했습니다.")
    if not all(value.strip() for value in candidate.values()):
        return _candidate_error("EMPTY_TEXT", "공백만 있는 문자열을 문항이나 풀이로 사용할 수 없습니다.")

    return {"status": "OK", "error_code": None, "reason": None, "candidate_question": candidate}


def _source_text(source_question: dict) -> dict:
    """Images fail loudly until a model call can actually send them."""
    source = {}
    for name in ("problem", "explanation"):
        part = source_question.get(name) or {}
        if part.get("image"):
            raise ValueError(f"{name}: image input is not supported yet")
        text = part.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"{name}: text is required")
        source[name] = text
    return source


def _first_valid(complete: Complete, system: str, user: str, validate) -> dict:
    """Retry a malformed output once; a missing-information result is final."""
    result = validate(complete(system, user))
    if result["status"] == "OUTPUT_ERROR":
        result = validate(complete(system, user))
    return result


def extract_solution_idea(source_question: dict, complete: Complete) -> dict:
    """Run parse_query and return the validate_solution_idea result."""
    user = json.dumps(_source_text(source_question), ensure_ascii=False)
    return _first_valid(complete, load_prompt("parse_query"), user, validate_solution_idea)


def generate_candidate(request: dict, complete: Complete) -> dict:
    """Draft one candidate only after both key elements and the mechanism are confirmed."""
    conditions = {}
    for name in _CONDITIONS:
        value = request.get(name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{name} is required")
        conditions[name] = value
    source = _source_text(request.get("source_question") or {})

    extraction = extract_solution_idea(request["source_question"], complete)
    if extraction["status"] != "OK":
        return {**extraction, "candidate_question": None}

    idea = extraction["solution_idea"]
    user = json.dumps({"source_question": source, "solution_idea": idea, **conditions},
                      ensure_ascii=False)
    drafted = _first_valid(complete, load_prompt("generate_candidate"), user,
                           validate_candidate_question)
    return {**drafted, "solution_idea": idea}
