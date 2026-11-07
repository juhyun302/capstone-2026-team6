"""Design-then-generate flow with several candidates; no model is called."""

from copy import deepcopy
import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft7Validator

from aleph.generation import load_prompt
from aleph.pipeline import generate_linked_questions, validate_candidate_design
from aleph.similarity import THRESHOLD, similarity

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "tests/harness/pipeline_cases.yaml"
PROMPTS = ["parse_query", "design_candidates", "generate_candidate", "solve_candidate",
           "review_candidate"]
VERDICTS = ["USE", "REVISE", "HOLD", "REJECT"]
ERROR_CODES = {
    "QUESTION_ERROR": {"MISSING_ELEMENTS", "MISSING_MECHANISM"},
    "OUTPUT_ERROR": {"JSON_INVALID", "SCHEMA_INVALID", "EMPTY_TEXT", "COMPARISON_REQUIRED",
                     "VERDICT_CONFLICT", "DESIGN_INVALID"},
}
TEXT = {"type": "string", "minLength": 1}
CASE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["name", "kind", "ac", "outputs", "expect_status", "expect_error_code",
                 "expect_shown", "expect_copy", "note"],
    "properties": {
        "name": {"type": "string", "pattern": "^[a-z][a-z0-9_]+$"},
        "kind": {"enum": ["normal", "boundary", "forbidden"]},
        "ac": {"type": "array", "minItems": 1, "uniqueItems": True,
               "items": {"enum": ["AC1", "AC2", "AC3", "AC7"]}},
        "outputs": {
            "type": "object", "additionalProperties": False, "required": PROMPTS,
            "properties": {name: {"type": "array", "items": {"type": "string"}} for name in PROMPTS},
        },
        "expect_status": {"enum": ["OK", "QUESTION_ERROR", "OUTPUT_ERROR"]},
        "expect_error_code": {"enum": [None, *ERROR_CODES["QUESTION_ERROR"],
                                       *ERROR_CODES["OUTPUT_ERROR"]]},
        "expect_shown": {"type": "object", "additionalProperties": {"enum": VERDICTS},
                         "propertyNames": {"pattern": "^p[1-9]$"}},
        "expect_copy": {"type": "array", "items": {"pattern": "^p[1-9]$"}, "uniqueItems": True},
        "note": TEXT,
    },
}
FILE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["version", "review_status", "base_commit", "function", "fixtures", "cases"],
    "properties": {
        "version": {"const": 1},
        "review_status": {"enum": ["DRAFT_REQUIRES_HUMAN_REVIEW", "HUMAN_APPROVED"]},
        "base_commit": {"type": "string", "pattern": "^[a-f0-9]{40}$"},
        "function": {"const": "aleph.pipeline.generate_linked_questions"},
        "fixtures": {"type": "object"},
        "cases": {"type": "array", "minItems": 1, "items": CASE_SCHEMA},
    },
}
REQUEST = {
    "source_question": {
        "problem": {"text": "함수 $f(x)=x^2+1$에 대하여 $f(3)$의 값을 구하시오."},
        "explanation": {"text": "$x=3$을 대입하고 두 요소를 연결한다."},
    },
    "intended_use": "보충지", "target_level": "준킬러", "curriculum_scope": "수학Ⅱ",
}


class UniqueKeyLoader(yaml.SafeLoader):
    """A repeated key must not silently replace a case or its expectation."""

    def construct_mapping(self, node, deep=False):
        mapping = super().construct_mapping(node, deep=deep)
        if len(mapping) != len(node.value):
            raise ValueError("Duplicate YAML key")
        return mapping


def load_document(path=CASES_PATH):
    document = yaml.load(Path(path).read_text(encoding="utf-8"), Loader=UniqueKeyLoader)
    Draft7Validator(FILE_SCHEMA).validate(document)
    names = [case["name"] for case in document["cases"]]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate case name")
    for case in document["cases"]:
        ok = case["expect_status"] == "OK"
        if ok != (case["expect_error_code"] is None):
            raise ValueError("Status and error code disagree")
        if ok != bool(case["expect_shown"]):
            raise ValueError("Status and shown candidates disagree")
        if not ok and case["expect_error_code"] not in ERROR_CODES[case["expect_status"]]:
            raise ValueError("Error code does not belong to the expected status")
    return document


class ScriptedModel:
    """Replays written outputs by prompt and fails on any call a case did not expect."""

    def __init__(self, outputs):
        self.outputs = {load_prompt(name): list(outputs.get(name, [])) for name in PROMPTS}
        self.users = {load_prompt(name): [] for name in PROMPTS}

    def __call__(self, system, user):
        self.users[system].append(user)
        return self.outputs[system].pop(0)

    def sent(self, name):
        return [json.loads(user) for user in self.users[load_prompt(name)]]

    def left(self):
        return {name: len(self.outputs[load_prompt(name)]) for name in PROMPTS}


CASES = load_document()["cases"]


def run(outputs, request=REQUEST, **kwargs):
    model = ScriptedModel(outputs)
    result = generate_linked_questions(deepcopy(request), model, workers=1, **kwargs)
    return model, result


def test_golden_cases_loaded():
    assert {case["kind"] for case in CASES} == {"normal", "boundary", "forbidden"}


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_pipeline_golden(case):
    model, result = run(case["outputs"])
    assert set(result) == {"status", "error_code", "reason", "solution_idea", "candidates"}
    assert result["status"] == case["expect_status"], "status mismatch"
    assert result["error_code"] == case["expect_error_code"], "error_code mismatch"
    assert model.left() == {name: 0 for name in PROMPTS}, "unexpected number of model calls"
    shown = {c["id"]: c["review_result"]["verdict"] for c in result["candidates"]
             if c["review_result"]}
    assert shown == case["expect_shown"], "shown candidates mismatch"
    copied = [c["id"] for c in result["candidates"]
              if c["surface_check"] and c["surface_check"]["copy_suspected"]]
    assert copied == case["expect_copy"], "copy flags mismatch"
    for candidate in result["candidates"]:
        if candidate["review_result"]:
            assert candidate["candidate_question"] is not None
            assert candidate["review_result"]["reviewer_type"] == "AI"
            assert candidate["review_result"]["approval_status"] == "PROVISIONAL"
        else:
            assert candidate["candidate_question"] is None, "candidate shown without review"
    if case["expect_status"] != "OK":
        assert isinstance(result["reason"], str) and result["reason"].strip()


@pytest.mark.parametrize("defect", ["conflicting_status", "ok_without_shown", "unknown_key",
                                    "duplicate_name", "missing_prompt"])
def test_loader_rejects_invalid_case(tmp_path, defect):
    data = yaml.safe_load(CASES_PATH.read_text(encoding="utf-8"))
    case = data["cases"][0]
    if defect == "conflicting_status":
        case["expect_error_code"] = "JSON_INVALID"
    elif defect == "ok_without_shown":
        case["expect_shown"] = {}
    elif defect == "unknown_key":
        case["surprise"] = True
    elif defect == "duplicate_name":
        data["cases"].append(deepcopy(case))
    elif defect == "missing_prompt":
        del case["outputs"]["design_candidates"]
    path = tmp_path / "cases.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(Exception):
        load_document(path)


FIX = load_document()["fixtures"]
HAPPY = CASES[0]["outputs"]


def test_designer_receives_source_idea_count_and_conditions():
    model, _ = run(HAPPY)
    sent = model.sent("design_candidates")[0]
    assert sent["count"] == 3
    assert sent["solution_idea"] == json.loads(FIX["idea"])
    assert sent["source_question"]["problem"] == REQUEST["source_question"]["problem"]["text"]
    assert sent["curriculum_scope"] == "수학Ⅱ"
    assert sent["intended_use"] == "보충지" and sent["target_level"] == "준킬러"


def test_each_generator_call_gets_its_plan_and_only_the_other_plans():
    model, _ = run(HAPPY)
    plans = json.loads(FIX["design3"])["plans"]
    for sent, plan in zip(model.sent("generate_candidate"), plans):
        assert sent["plan"] == plan
        assert [p["id"] for p in sent["sibling_plans"]] == [p["id"] for p in plans if p is not plan]
        assert sent["solution_idea"] == json.loads(FIX["idea"])


def test_reviewer_gets_the_surface_check():
    model, result = run(CASES[7]["outputs"])
    checks = [sent["surface_check"] for sent in model.sent("review_candidate")]
    assert checks[0]["copy_suspected"] is True
    assert checks[0]["source_similarity"] >= THRESHOLD
    assert checks[1]["copy_suspected"] is False
    assert result["candidates"][0]["transferable"] is False


def test_blind_solver_still_sees_only_the_statement():
    model, _ = run(HAPPY)
    assert all(set(sent) == {"statement", "curriculum_scope"} for sent in model.sent("solve_candidate"))


@pytest.mark.parametrize("count", [0, 6, "3", None])
def test_invalid_count_fails_before_any_model_call(count):
    def model(system, user):
        raise AssertionError("model must not be called")

    with pytest.raises((ValueError, TypeError)):
        generate_linked_questions(deepcopy(REQUEST), model, count=count)


def test_parallel_workers_give_the_same_candidates():
    outputs = dict(HAPPY)
    outputs["review_candidate"] = [FIX["use"]] * 3

    def model_for():
        statements = {}
        by_prompt = {load_prompt("parse_query"): FIX["idea"],
                     load_prompt("design_candidates"): FIX["design3"],
                     load_prompt("solve_candidate"): FIX["blind"],
                     load_prompt("review_candidate"): FIX["use"]}

        def model(system, user):
            if system == load_prompt("generate_candidate"):
                plan = json.loads(user)["plan"]["id"]
                statements[plan] = {"p1": FIX["c1"], "p2": FIX["c2"], "p3": FIX["c3"]}[plan]
                return statements[plan]
            return by_prompt[system]
        return model

    one = generate_linked_questions(deepcopy(REQUEST), model_for(), workers=1)
    many = generate_linked_questions(deepcopy(REQUEST), model_for(), workers=3)
    assert one == many


def test_similarity_masks_numbers_and_spaces():
    assert similarity("$f(x)=x^2+1$", "$f(x) = x^2 + 7$") == 1.0
    assert similarity("등차수열의 공차", "원 위의 두 점") < THRESHOLD
    with pytest.raises(TypeError):
        similarity(None, "a")


def test_design_validator_rejects_non_string_and_bad_count():
    with pytest.raises(TypeError):
        validate_candidate_design(None, count=3)
    with pytest.raises(TypeError):
        validate_candidate_design(FIX["design3"], count="3")
    assert validate_candidate_design(FIX["design3"], count=3)["status"] == "OK"
    assert validate_candidate_design(FIX["design3"], count=2)["error_code"] == "DESIGN_INVALID"


def test_design_with_hanzi_is_rejected():
    plans = json.loads(FIX["design3"])
    plans["plans"][0]["added_judgment"] = "候选 판단"
    result = validate_candidate_design(json.dumps(plans, ensure_ascii=False), count=3)
    assert result["error_code"] == "SCHEMA_INVALID"


def test_duplicate_plan_ids_are_rejected():
    plans = json.loads(FIX["design3"])
    plans["plans"][1]["id"] = "p1"
    result = validate_candidate_design(json.dumps(plans, ensure_ascii=False), count=3)
    assert result["error_code"] == "DESIGN_INVALID"


def test_solution_route_may_be_a_list_of_steps():
    plans = json.loads(FIX["design3"])
    plans["plans"][0]["solution_route"] = ["좌표를 정한다", "넓이비로 경우를 나눈다"]
    assert validate_candidate_design(json.dumps(plans, ensure_ascii=False), count=3)["status"] == "OK"
    plans["plans"][0]["solution_route"] = ["좌표를 정한다", "  "]
    assert validate_candidate_design(json.dumps(plans, ensure_ascii=False), count=3)["error_code"] == "EMPTY_TEXT"
    plans["plans"][0]["solution_route"] = []
    assert validate_candidate_design(json.dumps(plans, ensure_ascii=False), count=3)["error_code"] == "SCHEMA_INVALID"
