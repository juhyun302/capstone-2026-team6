"""Candidate-review rules and the full generate-then-review flow; no model is called."""

from copy import deepcopy
import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft7Validator

from aleph.generation import load_prompt
from aleph.review import (
    generate_linked_question,
    review_candidate,
    validate_blind_solution,
    validate_review_output,
)

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "tests/harness/review_cases.yaml"
ERROR_CODES = {
    "QUESTION_ERROR": {"MISSING_ELEMENTS", "MISSING_MECHANISM"},
    "OUTPUT_ERROR": {"JSON_INVALID", "SCHEMA_INVALID", "EMPTY_TEXT", "COMPARISON_REQUIRED",
                     "VERDICT_CONFLICT"},
}
TEXT = {"type": "string", "minLength": 1}
REVIEW_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["validity_issue", "curriculum_issue", "verdict", "reason", "reviewer_type",
                 "approval_status"],
    "properties": {
        "validity_issue": {"type": "boolean"},
        "curriculum_issue": {"type": "boolean"},
        "verdict": {"enum": ["USE", "REVISE", "HOLD", "REJECT"]},
        "reason": TEXT,
        "reviewer_type": {"const": "AI"},
        "approval_status": {"const": "PROVISIONAL"},
    },
}
CASE_SCHEMA = {
    "type": "object",
    "required": ["name", "kind", "ac", "parser_outputs", "solver_outputs", "reviewer_outputs",
                 "expect_status", "expect_error_code", "expect_parser_calls",
                 "expect_solver_calls", "expect_reviewer_calls", "expect_review",
                 "expect_transferable", "note"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "pattern": "^[a-z][a-z0-9_]+$"},
        "kind": {"enum": ["normal", "boundary", "forbidden"]},
        "ac": {"type": "array", "minItems": 1, "uniqueItems": True,
               "items": {"enum": ["AC2", "AC3", "AC4", "AC5", "AC7"]}},
        "parser_outputs": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "solver_outputs": {"type": "array", "items": {"type": "string"}},
        "reviewer_outputs": {"type": "array", "items": {"type": "string"}},
        "expect_status": {"enum": ["OK", "QUESTION_ERROR", "OUTPUT_ERROR"]},
        "expect_error_code": {"enum": [None, *ERROR_CODES["QUESTION_ERROR"],
                                       *ERROR_CODES["OUTPUT_ERROR"]]},
        "expect_parser_calls": {"type": "integer", "minimum": 1, "maximum": 2},
        "expect_solver_calls": {"type": "integer", "minimum": 0, "maximum": 2},
        "expect_reviewer_calls": {"type": "integer", "minimum": 0, "maximum": 2},
        "expect_review": {"oneOf": [REVIEW_SCHEMA, {"type": "null"}]},
        "expect_transferable": {"type": ["boolean", "null"]},
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
        "function": {"const": "aleph.review.review_candidate"},
        "cases": {"type": "array", "minItems": 1, "items": CASE_SCHEMA},
    },
}
SOURCE = {"problem": {"text": "원문 문항"}, "explanation": {"text": "원문 해설"}}
CANDIDATE = {"statement": "후보 문항", "solution": "후보 풀이"}
REQUEST = {"source_question": SOURCE, "candidate_question": CANDIDATE, "curriculum_scope": "수학Ⅱ"}
GENERATION_REQUEST = {"source_question": SOURCE, "intended_use": "보충지",
                      "target_level": "준킬러", "curriculum_scope": "수학Ⅱ"}
IDEA = {"concept": "수열", "key_elements": ["요소 하나", "요소 둘"], "mechanism": "연결"}
BLIND = {"status": "solved", "answer": "3", "solution": "독립 풀이", "issues": []}
REVIEW = {"validity_issue": False, "curriculum_issue": False, "transferable": True,
          "verdict": "USE", "reason": "요소 하나와 요소 둘이 연결대로 쓰인다."}


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
        if ok != isinstance(case["expect_review"], dict):
            raise ValueError("Status and expected review disagree")
        if ok != isinstance(case["expect_transferable"], bool):
            raise ValueError("Status and expected transferable disagree")
        if not ok and case["expect_error_code"] not in ERROR_CODES[case["expect_status"]]:
            raise ValueError("Error code does not belong to the expected status")
        for role in ("parser", "solver", "reviewer"):
            if len(case[f"{role}_outputs"]) != case[f"expect_{role}_calls"]:
                raise ValueError("Scripted outputs and expected calls disagree")
    return cases


class ScriptedModel:
    """Replays written outputs by prompt and fails on any call a case did not expect."""

    def __init__(self, **outputs):
        self.outputs = {load_prompt(name): list(values) for name, values in outputs.items()}
        self.users = {load_prompt(name): [] for name in outputs}

    def __call__(self, system, user):
        self.users[system].append(user)
        return self.outputs[system].pop(0)

    def sent(self, name):
        return [json.loads(user) for user in self.users[load_prompt(name)]]


def model_for(case):
    return ScriptedModel(parse_query=case["parser_outputs"],
                         solve_candidate=case["solver_outputs"],
                         review_candidate=case["reviewer_outputs"])


CASES = load_cases()


def test_golden_cases_loaded():
    assert {case["kind"] for case in CASES} == {"normal", "boundary", "forbidden"}
    assert {"AC2", "AC3", "AC4", "AC5", "AC7"} == {ac for case in CASES for ac in case["ac"]}


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_review_golden(case):
    model = model_for(case)
    result = review_candidate(deepcopy(REQUEST), model)
    assert set(result) == {"status", "error_code", "reason", "solution_idea", "review_result"}
    assert result["status"] == case["expect_status"], "status mismatch"
    assert result["error_code"] == case["expect_error_code"], "error_code mismatch"
    assert len(model.sent("parse_query")) == case["expect_parser_calls"], "parser calls"
    assert len(model.sent("solve_candidate")) == case["expect_solver_calls"], "solver calls"
    assert len(model.sent("review_candidate")) == case["expect_reviewer_calls"], "reviewer calls"
    assert result["review_result"] == case["expect_review"], "review mismatch"
    if case["expect_status"] == "OK":
        assert result["reason"] is None
        assert result["solution_idea"]["transferable"] is case["expect_transferable"]
    else:
        assert isinstance(result["reason"], str) and result["reason"].strip(), "missing reason"


@pytest.mark.parametrize("defect", [
    "conflicting_status", "ok_without_review", "error_with_transferable",
    "wrong_error_code_for_status", "fewer_outputs_than_calls", "unknown_key", "duplicate_name",
    "approved_expectation",
])
def test_loader_rejects_invalid_case(tmp_path, defect):
    data = yaml.safe_load(CASES_PATH.read_text(encoding="utf-8"))
    case = data["cases"][0]
    if defect == "conflicting_status":
        case["expect_error_code"] = "JSON_INVALID"
    elif defect == "ok_without_review":
        case["expect_review"] = None
    elif defect == "error_with_transferable":
        case["expect_status"] = "OUTPUT_ERROR"
        case["expect_error_code"] = "VERDICT_CONFLICT"
        case["expect_review"] = None
    elif defect == "wrong_error_code_for_status":
        case["expect_status"] = "QUESTION_ERROR"
        case["expect_error_code"] = "VERDICT_CONFLICT"
        case["expect_review"] = None
        case["expect_transferable"] = None
    elif defect == "fewer_outputs_than_calls":
        case["expect_solver_calls"] = 2
    elif defect == "unknown_key":
        case["surprise"] = True
    elif defect == "duplicate_name":
        data["cases"].append(deepcopy(case))
    elif defect == "approved_expectation":
        case["expect_review"]["approval_status"] = "APPROVED"
    path = tmp_path / "cases.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(Exception):
        load_cases(path)


def test_blind_solver_sees_only_the_statement_and_scope():
    model = ScriptedModel(parse_query=[json.dumps(IDEA)], solve_candidate=[json.dumps(BLIND)],
                          review_candidate=[json.dumps(REVIEW)])
    review_candidate(deepcopy(REQUEST), model)
    assert model.sent("solve_candidate") == [
        {"statement": CANDIDATE["statement"], "curriculum_scope": "수학Ⅱ"}]


def test_reviewer_compares_source_idea_candidate_and_blind_solution():
    model = ScriptedModel(parse_query=[json.dumps(IDEA)], solve_candidate=[json.dumps(BLIND)],
                          review_candidate=[json.dumps(REVIEW)])
    review_candidate(deepcopy(REQUEST), model)
    assert model.sent("review_candidate") == [{
        "source_question": {"problem": "원문 문항", "explanation": "원문 해설"},
        "solution_idea": IDEA, "candidate_question": CANDIDATE, "blind_solution": BLIND,
        "curriculum_scope": "수학Ⅱ",
    }]


def test_supplied_idea_skips_extraction():
    model = ScriptedModel(parse_query=[], solve_candidate=[json.dumps(BLIND)],
                          review_candidate=[json.dumps(REVIEW)])
    result = review_candidate(deepcopy(REQUEST), model, solution_idea=IDEA)
    assert result["status"] == "OK"
    assert result["solution_idea"] == {**IDEA, "transferable": True}
    assert not model.sent("parse_query")


@pytest.mark.parametrize("idea", [
    {"concept": "수열", "key_elements": None, "mechanism": None},
    {"concept": "수열", "key_elements": ["요소 하나", "요소 둘"], "mechanism": None},
    {"concept": "수열", "key_elements": ["요소 하나"], "mechanism": "연결"},
])
def test_incomplete_supplied_idea_is_refused(idea):
    def model(system, user):
        raise AssertionError("model must not be called")

    with pytest.raises(ValueError):
        review_candidate(deepcopy(REQUEST), model, solution_idea=idea)


@pytest.mark.parametrize("defect", [
    "no_candidate", "blank_statement", "no_solution", "extra_key", "no_scope", "image_problem",
])
def test_invalid_review_request_fails_before_any_model_call(defect):
    request = deepcopy(REQUEST)
    if defect == "no_candidate":
        del request["candidate_question"]
    elif defect == "blank_statement":
        request["candidate_question"]["statement"] = " "
    elif defect == "no_solution":
        del request["candidate_question"]["solution"]
    elif defect == "extra_key":
        request["candidate_question"]["verdict"] = "USE"
    elif defect == "no_scope":
        del request["curriculum_scope"]
    elif defect == "image_problem":
        request["source_question"]["problem"]["image"] = "problem.png"

    def model(system, user):
        raise AssertionError("model must not be called")

    with pytest.raises(ValueError):
        review_candidate(request, model)


def linked_model(*, reviewer=None, generator=None, parser=None):
    return ScriptedModel(
        parse_query=parser or [json.dumps(IDEA)],
        generate_candidate=generator if generator is not None else [json.dumps(CANDIDATE)],
        solve_candidate=[json.dumps(BLIND)],
        review_candidate=reviewer if reviewer is not None else [json.dumps(REVIEW)],
    )


def test_linked_question_returns_the_spec_output():
    model = linked_model()
    result = generate_linked_question(deepcopy(GENERATION_REQUEST), model)
    assert set(result) == {"status", "error_code", "reason", "solution_idea",
                           "candidate_question", "review_result"}
    assert result["status"] == "OK"
    assert result["candidate_question"] == CANDIDATE
    assert result["solution_idea"] == {**IDEA, "transferable": True}
    assert result["review_result"]["approval_status"] == "PROVISIONAL"
    assert result["review_result"]["reviewer_type"] == "AI"
    assert len(model.sent("parse_query")) == 1


def test_linked_question_stops_when_no_idea_is_confirmed():
    model = linked_model(parser=['{"concept":"미분","key_elements":null,"mechanism":null}'],
                         generator=[], reviewer=[])
    result = generate_linked_question(deepcopy(GENERATION_REQUEST), model)
    assert result["status"] == "QUESTION_ERROR"
    assert result["candidate_question"] is None and result["review_result"] is None
    assert not model.sent("solve_candidate")


def test_linked_question_skips_review_when_generation_fails():
    model = linked_model(generator=["not json", "still not json"], reviewer=[])
    result = generate_linked_question(deepcopy(GENERATION_REQUEST), model)
    assert result["status"] == "OUTPUT_ERROR"
    assert result["candidate_question"] is None and result["review_result"] is None
    assert not model.sent("solve_candidate")


def test_candidate_is_not_shown_without_a_review():
    conflict = json.dumps({**REVIEW, "validity_issue": True})
    model = linked_model(reviewer=[conflict, conflict])
    result = generate_linked_question(deepcopy(GENERATION_REQUEST), model)
    assert result["status"] == "OUTPUT_ERROR"
    assert result["error_code"] == "VERDICT_CONFLICT"
    assert result["candidate_question"] is None and result["review_result"] is None
    assert result["solution_idea"] == IDEA


@pytest.mark.parametrize("raw_output", [None, 1, b"{}"])
def test_review_validators_reject_non_string(raw_output):
    with pytest.raises(TypeError):
        validate_blind_solution(raw_output)
    with pytest.raises(TypeError):
        validate_review_output(raw_output, blind_clean=True)


def test_blind_clean_must_be_boolean():
    with pytest.raises(TypeError):
        validate_review_output(json.dumps(REVIEW), blind_clean="yes")
