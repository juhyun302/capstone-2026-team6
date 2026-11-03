"""Golden cases, case-file validation, and call-boundary checks."""

from copy import deepcopy
import json
from pathlib import Path
import sys

import pytest
import yaml
from jsonschema import Draft7Validator, ValidationError

from aleph.validation import validate_solution_idea

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "tests/harness/golden_cases.yaml"
IDEA_VALIDATOR = Draft7Validator(json.loads(
    (ROOT / "src/aleph/schemas/solution_idea.schema.json").read_text(encoding="utf-8")
))
ERROR_CODES = {
    "QUESTION_ERROR": {"MISSING_ELEMENTS", "MISSING_MECHANISM"},
    "OUTPUT_ERROR": {"JSON_INVALID", "SCHEMA_INVALID", "EMPTY_TEXT", "COMPARISON_REQUIRED"},
}
TEXT = {"type": "string", "minLength": 1}
CASE_SCHEMA = {
    "type": "object",
    "required": ["name", "kind", "ac", "input", "expect_status", "expect_error_code",
                 "expect_idea", "note"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "pattern": "^[a-z][a-z0-9_]+$"},
        "kind": {"enum": ["normal", "boundary", "forbidden"]},
        "ac": {"type": "array", "minItems": 1, "uniqueItems": True,
               "items": {"enum": ["AC1", "AC2"]}},
        "input": {
            "type": "object", "additionalProperties": False,
            "required": ["comparison_available"],
            "properties": {"raw_output": {"type": "string"}, "raw_output_file": TEXT,
                           "comparison_available": {"type": "boolean"}},
            "oneOf": [{"required": ["raw_output"]}, {"required": ["raw_output_file"]}],
        },
        "expect_status": {"enum": ["OK", "QUESTION_ERROR", "OUTPUT_ERROR"]},
        "expect_error_code": {"enum": [None, "JSON_INVALID", "SCHEMA_INVALID", "EMPTY_TEXT",
                                       "COMPARISON_REQUIRED", "MISSING_ELEMENTS", "MISSING_MECHANISM"]},
        "expect_idea": {"type": ["object", "null"]},
        "note": TEXT,
    },
}
FILE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["version", "review_status", "base_commit", "function", "cases"],
    "properties": {
        "version": {"const": 1},
        "review_status": {"enum": ["DRAFT_REQUIRES_HUMAN_REVIEW", "HUMAN_APPROVED"]},
        "base_commit": {"type": "string", "pattern": "^[a-f0-9]{40}$"},
        "function": {"const": "aleph.validation.validate_solution_idea"},
        "cases": {"type": "array", "minItems": 1, "items": CASE_SCHEMA},
    },
}


class UniqueKeyLoader(yaml.SafeLoader):
    """A repeated key must not silently replace a case or its expectation."""

    def construct_mapping(self, node, deep=False):
        mapping = super().construct_mapping(node, deep=deep)
        if len(mapping) != len(node.value):
            raise ValueError("Duplicate YAML key")
        return mapping


def load_cases(path=CASES_PATH):
    document = yaml.load(Path(path).read_text(encoding="utf-8"), Loader=UniqueKeyLoader)
    Draft7Validator(FILE_SCHEMA).validate(document)
    cases = document["cases"]
    names = [case["name"] for case in cases]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate case name")
    for case in cases:
        ok = case["expect_status"] == "OK"
        if ok != (case["expect_error_code"] is None):
            raise ValueError("Status and error code disagree")
        if ok != isinstance(case["expect_idea"], dict):
            raise ValueError("Status and expected idea disagree")
        if ok:
            IDEA_VALIDATOR.validate(case["expect_idea"])
        elif case["expect_error_code"] not in ERROR_CODES[case["expect_status"]]:
            raise ValueError("Error code does not belong to the expected status")
        if "raw_output_file" in case["input"]:
            fixture = (ROOT / case["input"]["raw_output_file"]).resolve()
            if not fixture.is_relative_to(ROOT / "docs/spikes/evidence"):
                raise ValueError("Fixture must be in docs/spikes/evidence")
            if not fixture.is_file():
                raise ValueError("Fixture is missing")
    return cases


def function_input(case):
    values = dict(case["input"])
    if "raw_output_file" in values:
        values["raw_output"] = (ROOT / values.pop("raw_output_file")).read_text(encoding="utf-8")
    return values


CASES = load_cases()


def test_golden_cases_loaded():
    assert CASES
    assert {case["kind"] for case in CASES} == {"normal", "boundary", "forbidden"}


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_validation_golden(case):
    result = validate_solution_idea(**function_input(case))
    assert set(result) == {"status", "error_code", "reason", "solution_idea"}
    assert result["status"] == case["expect_status"], "status mismatch"
    assert result["error_code"] == case["expect_error_code"], "error_code mismatch"
    if case["expect_status"] == "OK":
        IDEA_VALIDATOR.validate(result["solution_idea"])
        assert result["reason"] is None
    else:
        assert isinstance(result["reason"], str) and result["reason"].strip(), "missing reason"
    assert result["solution_idea"] == case["expect_idea"], "solution_idea mismatch"


@pytest.mark.parametrize("defect", [
    "missing_expectation", "unknown_key", "empty_cases", "duplicate_name", "wrong_input_type",
    "conflicting_status", "missing_fixture", "outside_fixture",
    "invalid_expected_idea", "wrong_error_code_for_status",
])
def test_loader_rejects_invalid_case(tmp_path, defect):
    data = yaml.safe_load(CASES_PATH.read_text(encoding="utf-8"))
    case = data["cases"][0]
    if defect == "missing_expectation":
        del case["expect_status"]
    elif defect == "unknown_key":
        case["expect_stauts"] = "OK"
    elif defect == "empty_cases":
        data["cases"] = []
    elif defect == "duplicate_name":
        data["cases"].append(deepcopy(case))
    elif defect == "wrong_input_type":
        case["input"]["comparison_available"] = "false"
    elif defect == "conflicting_status":
        case["expect_error_code"] = "SCHEMA_INVALID"
    elif defect == "missing_fixture":
        case["input"]["raw_output_file"] = "docs/spikes/evidence/nonexistent.txt"
    elif defect == "outside_fixture":
        case["input"]["raw_output_file"] = "README.md"
    elif defect == "invalid_expected_idea":
        case["expect_idea"] = {}
    else:
        case["expect_status"] = "QUESTION_ERROR"
        case["expect_error_code"] = "JSON_INVALID"
        case["expect_idea"] = None
    path = tmp_path / "invalid.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises((ValueError, ValidationError)):
        load_cases(path)


@pytest.mark.parametrize("location", ["file", "case"])
def test_loader_rejects_duplicate_yaml_keys(tmp_path, location):
    text = CASES_PATH.read_text(encoding="utf-8")
    if location == "file":
        first_case = yaml.safe_load(text)["cases"][:1]
        text += "\ncases:\n" + yaml.safe_dump(first_case, allow_unicode=True)
    else:
        text = text.replace("  expect_status: OK", "  expect_status: OK\n  expect_status: OK", 1)
    path = tmp_path / "duplicate.yaml"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError, match="Duplicate YAML key"):
        load_cases(path)


@pytest.mark.parametrize("case_name, invalid_value", [("comparison_true", 1), ("comparison_false", 0)])
def test_golden_rejects_number_instead_of_boolean(monkeypatch, case_name, invalid_value):
    case = next(c for c in CASES if c["name"] == case_name)
    idea = deepcopy(case["expect_idea"])
    idea["transferable"] = invalid_value
    wrong_result = {"status": "OK", "error_code": None, "reason": None, "solution_idea": idea}
    monkeypatch.setattr(sys.modules[__name__], "validate_solution_idea", lambda **kwargs: wrong_result)
    with pytest.raises(ValidationError) as error:
        test_validation_golden(case)
    assert list(error.value.path) == ["transferable"]
    assert error.value.validator == "type"


@pytest.mark.parametrize("value", [None, {}, b"{}"])
def test_non_string_response_is_a_call_error(value):
    with pytest.raises(TypeError):
        validate_solution_idea(value)


@pytest.mark.parametrize("value", ["false", 1, None])
def test_comparison_flag_must_be_boolean(value):
    with pytest.raises(TypeError):
        validate_solution_idea("{}", comparison_available=value)
