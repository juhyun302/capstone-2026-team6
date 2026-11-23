"""Figure checks and the figure path through the pipeline; no model is called.

AC10 초안(docs/SPEC.md 5.2절)을 위한 케이스이며 사람 검토 전이다. 케이스와 기대값은 팀이
AC10을 확정할 때 함께 검토한다. 기대 메시지는 web/src/figure/check.ts가 같은 명세에 내는
메시지와 같다(2026-11-22 두 구현에 같은 명세 15개를 넣어 대조).
"""

from copy import deepcopy
import json
import math
from types import SimpleNamespace

import pytest

from aleph.figure import ExprError, check_figure, compile_expr, validate_figure
from aleph.generation import load_prompt, validate_candidate_question
from aleph.model_client import openai_complete
from aleph.pipeline import generate_linked_questions, validate_candidate_design

CUBIC = {
    "width_mm": 80, "aspect": "free", "height_mm": 64,
    "view": {"x": [-2.6, 3], "y": [-3, 4.8]},
    "items": [
        {"type": "axes", "x": [-2.5, 2.9], "y": [-2.8, 4.6]},
        {"type": "curve", "id": "f", "expr": "x^3-3*x", "domain": [-2, 2.2]},
        {"type": "guide", "at": [-1, 2], "to": "both", "on": ["f"]},
        {"type": "tick", "axis": "x", "value": -1},
        {"type": "tick", "axis": "y", "value": 2},
        {"type": "label", "tex": "y=f(x)", "at": [2.2, 4], "position": "left"},
    ],
}
TRIANGLE = {
    "width_mm": 72, "aspect": "equal", "view": {"x": [-2.6, 4.6], "y": [-0.7, 3.6]},
    "points": {"A": [0, 3], "B": [-2, 0], "C": [4, 0], "H": [0, 0]},
    "items": [
        {"type": "polygon", "points": ["A", "B", "C"]},
        {"type": "segment", "from": "A", "to": "H", "style": "dashed"},
        {"type": "right_angle", "vertex": "H", "a": "A", "b": "C"},
        {"type": "angle", "vertex": "B", "a": "C", "b": "A", "tex": "\\theta"},
        {"type": "point_names", "names": ["A", "B", "C", "H"]},
    ],
}
STATEMENT = "그림과 같이 함수 $y=f(x)$의 그래프가 있다. $f(x)$의 극댓값을 구하시오."


def with_items(spec, *items):
    return {**deepcopy(spec), "items": list(items)}


# ---- formulas -------------------------------------------------------------------------------

@pytest.mark.parametrize("text, x, value", [
    ("x^3-3x", 2, 2),
    ("2x(x+2)(x-5)", 1, -24),
    ("-x^2", 3, -9),
    ("2^3^2", 0, 512),
    ("e^-x", 0, 1),
    ("|x-1|+|x|", -1, 3),
    ("x**2", 4, 16),
    ("sqrt(4)*pi", 0, 2 * math.pi),
    ("log(2, 8)", 0, 3),
    ("log(100)", 0, 2),
    ("ln(e^2)", 0, 2),
    ("cbrt(-8)", 0, -2),
    ("sin(pi/2) + cos(0)", 0, 2),
])
def test_formulas_read_like_the_browser(text, x, value):
    assert compile_expr(text)(x) == pytest.approx(value)


@pytest.mark.parametrize("text, x", [("ln(x)", 0), ("sqrt(x)", -1), ("1/x", 0), ("x^(1/2)", -4),
                                     ("exp(x)", 1000), ("log(1, x)", 2)])
def test_undefined_values_are_nan_not_exceptions(text, x):
    assert math.isnan(compile_expr(text)(x))


@pytest.mark.parametrize("text", ["", "x^^2", "sinx", "y+1", "(x+1", "sqrt()", "log(1,2,3)", "x # 1"])
def test_unreadable_formulas_raise(text):
    with pytest.raises(ExprError):
        compile_expr(text)


def test_coordinates_cannot_use_x():
    with pytest.raises(ExprError):
        compile_expr("x+1", variable=False)


# ---- figure spec ----------------------------------------------------------------------------

@pytest.mark.parametrize("spec", [CUBIC, TRIANGLE])
def test_valid_figures_pass(spec):
    assert validate_figure(deepcopy(spec)) is None


def test_the_example_in_the_generation_prompt_is_valid():
    prompt = load_prompt("generate_candidate")
    example = prompt.split("- 예: ", 1)[1].split("\n", 1)[0]
    assert validate_figure(json.loads(example)) is None


@pytest.mark.parametrize("spec, message", [
    (with_items(CUBIC, *CUBIC["items"], {"type": "dot", "at": [1, 1], "on": ["f"]}),
     "items[6](dot)의 점 (1, 1)이 곡선 f 위에 있지 않습니다"),
    (with_items(CUBIC, {"type": "piecewise", "pieces": [{"expr": "x", "domain": [0, 1]},
                                                        {"expr": "x+1", "domain": [1, 2]}]}),
     "items[0](piecewise)가 x=1에서 이어지지 않습니다. 끊어지는 함수는 curve 여러 개로 그립니다"),
    (with_items(CUBIC, {"type": "piecewise", "pieces": [{"expr": "x", "domain": [0, 1]},
                                                        {"expr": "x", "domain": [1.5, 2]}]}),
     "items[0](piecewise).pieces[1]의 구간이 앞 구간의 끝에서 시작하지 않습니다"),
    (with_items(TRIANGLE, {"type": "right_angle", "vertex": "B", "a": "A", "b": "C"}),
     "items[0](right_angle)의 두 변이 수직이 아닙니다"),
    (with_items(TRIANGLE, {"type": "segment", "from": "A", "to": "Z"}),
     "items[0](segment).to의 점 Z이 points에 없습니다"),
    (with_items(CUBIC, {"type": "curve", "expr": "x^^2", "domain": [0, 1]}),
     "items[0](curve)의 식을 읽을 수 없습니다: x^^2 (^의 자리)"),
    (with_items(CUBIC, {"type": "curve", "expr": "ln(x)", "domain": [0, 1]}),
     "items[0](curve)의 식 ln(x)을 x=0에서 계산할 수 없습니다"),
    (with_items(CUBIC, {"type": "shade", "upper": "x^2-2x+2", "lower": "x+2", "domain": [0, 3]}),
     "items[0](shade)의 upper가 x=0.048에서 lower보다 아래에 있습니다"),
    (with_items(CUBIC, {"type": "curve", "id": "f", "expr": "x", "domain": [0, 1]},
                {"type": "curve", "id": "f", "expr": "x", "domain": [0, 1]}),
     "items[1]의 id f가 두 번 쓰였습니다"),
    (with_items(CUBIC, {"type": "dot", "at": [0, 0], "on": ["g"]}),
     "items[0](dot)의 곡선 g이 없습니다. on에는 curve나 piecewise의 id를 씁니다"),
])
def test_figures_that_cannot_hold_are_named(spec, message):
    assert check_figure(spec) == message
    assert validate_figure(spec) == message


@pytest.mark.parametrize("change, message", [
    ({"items": [{"type": "curve", "expr": "x"}]}, "items[0]에 domain 항목이 없습니다"),
    ({"items": [{"type": "curve", "expr": "x", "domain": [0, 1], "color": "red", "alpha": 1}]},
     "items[0]에 정해지지 않은 항목이 있습니다: alpha"),
    ({"items": [{"type": "curv", "expr": "x", "domain": [0, 1]}]}, "items[0].type의 값이 허용되지 않습니다"),
    ({"height_mm": None}, "그림에 height_mm 항목이 없습니다"),
    ({"items": [{"type": "dot", "at": 5}]}, "items[0].at의 형식이 맞지 않습니다"),
    ({"width_mm": 120}, "width_mm의 형식이 맞지 않습니다"),
    ({"view": {"x": [1, 0], "y": [0, 1]}}, "view.x의 앞 값이 뒤 값보다 작아야 합니다"),
])
def test_schema_problems_are_named(change, message):
    spec = {**deepcopy(CUBIC), **change}
    spec = {key: value for key, value in spec.items() if value is not None}
    assert validate_figure(spec) == message


# ---- candidate ------------------------------------------------------------------------------

def candidate(**fields):
    return json.dumps({"statement": STATEMENT, "solution": "풀이", **fields}, ensure_ascii=False)


def plan(figure):
    return {"id": "p1", "figure": figure}


def test_candidate_with_a_statement_figure_passes():
    checked = validate_candidate_question(candidate(statement_figure=CUBIC), plan=plan("statement"))
    assert checked["status"] == "OK"
    assert checked["candidate_question"]["statement_figure"] == CUBIC


def test_null_figures_mean_no_figure():
    text = json.dumps({"statement": "함수 $f(x)$의 극댓값을 구하시오.", "solution": "풀이",
                       "statement_figure": None, "solution_figure": None}, ensure_ascii=False)
    assert validate_candidate_question(text, plan=plan("none"))["status"] == "OK"


@pytest.mark.parametrize("raw, given_plan, code", [
    (candidate(statement_figure=with_items(CUBIC, {"type": "curve", "expr": "ln(x)", "domain": [0, 1]})),
     plan("statement"), "FIGURE_INVALID"),
    (candidate(), None, "FIGURE_MISMATCH"),
    (json.dumps({"statement": "함수의 극댓값을 구하시오.", "solution": "풀이", "statement_figure": CUBIC}),
     None, "FIGURE_MISMATCH"),
    (json.dumps({"statement": "함수의 극댓값을 구하시오.", "solution": "풀이"}), plan("statement"),
     "FIGURE_MISMATCH"),
    (candidate(statement_figure=CUBIC), plan("none"), "FIGURE_MISMATCH"),
    (candidate(statement_figure=CUBIC), plan("both"), "FIGURE_MISMATCH"),
    (candidate(statement_figure=[1, 2]), plan("statement"), "SCHEMA_INVALID"),
])
def test_figure_and_statement_and_plan_must_agree(raw, given_plan, code):
    checked = validate_candidate_question(raw, plan=given_plan)
    assert (checked["status"], checked["error_code"]) == ("OUTPUT_ERROR", code)
    assert checked["candidate_question"] is None


def test_a_solution_figure_the_plan_did_not_ask_for_is_allowed():
    raw = json.dumps({"statement": "함수의 극댓값을 구하시오.", "solution": "풀이", "solution_figure": TRIANGLE})
    assert validate_candidate_question(raw, plan=plan("none"))["status"] == "OK"


def test_plan_figure_is_optional_but_must_be_known():
    base = {"id": "p1", "object": "대상", "condition_form": "조건", "target": "묻는 것",
            "representation": "그림 제시", "solution_route": ["첫 단계", "둘째 단계"],
            "changed_axes": ["object", "target", "representation"], "added_judgment": "판단"}
    assert validate_candidate_design(json.dumps({"plans": [base]}), count=1)["status"] == "OK"
    good = validate_candidate_design(json.dumps({"plans": [{**base, "figure": "both"}]}), count=1)
    assert good["status"] == "OK"
    bad = validate_candidate_design(json.dumps({"plans": [{**base, "figure": "3d"}]}), count=1)
    assert bad["error_code"] == "SCHEMA_INVALID" and "figure" in bad["reason"]


# ---- pipeline -------------------------------------------------------------------------------

REQUEST = {
    "source_question": {"problem": {"text": "원문"}, "explanation": {"text": "해설"}},
    "intended_use": "보충지", "target_level": "준킬러", "curriculum_scope": "수학Ⅱ",
}
IDEA = {"concept": "극값", "key_elements": ["도함수 부호로 극값 위치를 찾는다", "적분으로 원함수를 구한다"],
        "mechanism": "찾은 위치를 원함수에 대입한다"}
PLAN = {"id": "p1", "object": "삼차함수", "condition_form": "그래프", "target": "극댓값",
        "representation": "그림 제시", "solution_route": ["개형을 읽는다", "적분한다"],
        "changed_axes": ["object", "representation", "target"], "added_judgment": "그래프에서 부호를 읽는다",
        "figure": "statement"}
BLIND = {"status": "solved", "answer": "2", "solution": "풀었다", "issues": []}
REVIEW = {"validity_issue": False, "curriculum_issue": False, "transferable": True, "verdict": "USE",
          "reason": "두 요소가 쓰였다"}
PICTURE = "data:image/png;base64,AAAA"


class Model:
    """Replays outputs by prompt and keeps what each call received, images included."""

    def __init__(self, **outputs):
        self.outputs = {load_prompt(name): [json.dumps(o, ensure_ascii=False) for o in items]
                        for name, items in outputs.items()}
        self.calls = []
        self.names = {load_prompt(name): name for name in outputs}

    def __call__(self, system, user, images=None):
        self.calls.append((self.names[system], json.loads(user), images))
        return self.outputs[system].pop(0)

    def sent(self, name):
        return [(user, images) for called, user, images in self.calls if called == name]


def figure_run(*drafts, render=True):
    model = Model(parse_query=[IDEA], design_candidates=[{"plans": [PLAN]}],
                  generate_candidate=list(drafts), solve_candidate=[BLIND], review_candidate=[REVIEW])
    drawn = []

    def render_figure(figure):
        drawn.append(figure)
        return PICTURE

    result = generate_linked_questions(deepcopy(REQUEST), model, count=1, workers=1,
                                       render_figure=render_figure if render else None)
    return model, result, drawn


def draft(figure):
    return {"statement": STATEMENT, "solution": "풀이", "statement_figure": figure}


def test_blind_solver_sees_the_statement_figure_only_as_a_picture():
    model, result, drawn = figure_run(draft(CUBIC))
    assert result["status"] == "OK"
    [(user, images)] = model.sent("solve_candidate")
    assert set(user) == {"statement", "curriculum_scope"}
    assert images == [PICTURE] and drawn == [CUBIC]


def test_reviewer_gets_the_spec_and_the_picture_and_is_told_which():
    model, _, _ = figure_run(draft(CUBIC))
    [(user, images)] = model.sent("review_candidate")
    assert user["figure_images"] == ["statement_figure"]
    assert user["candidate_question"]["statement_figure"] == CUBIC
    assert images == [PICTURE]


def test_only_solve_and_review_calls_carry_pictures():
    model, _, _ = figure_run(draft(CUBIC))
    assert all(images is None for name, _, images in model.calls
               if name not in ("solve_candidate", "review_candidate"))


def test_a_broken_figure_is_retried_with_the_rule_it_broke():
    off_curve = with_items(CUBIC, *CUBIC["items"], {"type": "dot", "at": [-1, 5], "on": ["f"]})
    model, result, _ = figure_run(draft(off_curve), draft(CUBIC))
    first, second = model.sent("generate_candidate")
    assert "previous_error" not in first[0]
    assert "곡선 f 위에 있지 않습니다" in second[0]["previous_error"]
    assert result["candidates"][0]["candidate_question"]["statement_figure"] == CUBIC


def test_two_broken_figures_leave_no_candidate():
    broken = draft(with_items(CUBIC, {"type": "curve", "expr": "ln(x)", "domain": [0, 1]}))
    model = Model(parse_query=[IDEA], design_candidates=[{"plans": [PLAN]}],
                  generate_candidate=[broken, broken])
    result = generate_linked_questions(deepcopy(REQUEST), model, count=1, workers=1,
                                       render_figure=lambda figure: PICTURE)
    assert result["status"] == "OUTPUT_ERROR"
    assert result["candidates"][0]["error_code"] == "FIGURE_INVALID"
    assert not model.sent("solve_candidate")


def test_without_a_renderer_a_statement_figure_stops_before_the_blind_solve():
    model = Model(parse_query=[IDEA], design_candidates=[{"plans": [PLAN]}],
                  generate_candidate=[draft(CUBIC)])
    result = generate_linked_questions(deepcopy(REQUEST), model, count=1, workers=1)
    assert result["candidates"][0]["error_code"] == "FIGURE_UNRENDERED"
    assert result["candidates"][0]["review_result"] is None
    assert not model.sent("solve_candidate")


def test_a_solution_figure_alone_needs_no_renderer():
    solution_plan = {**PLAN, "figure": "solution"}
    model = Model(parse_query=[IDEA], design_candidates=[{"plans": [solution_plan]}],
                  generate_candidate=[{"statement": "함수의 극댓값을 구하시오.", "solution": "풀이",
                                       "solution_figure": TRIANGLE}],
                  solve_candidate=[BLIND], review_candidate=[REVIEW])
    result = generate_linked_questions(deepcopy(REQUEST), model, count=1, workers=1)
    assert result["status"] == "OK"
    assert [images for _, images in model.sent("solve_candidate")] == [None]


# ---- model call -----------------------------------------------------------------------------

def test_model_client_sends_pictures_after_the_text():
    calls = []
    client = SimpleNamespace(responses=SimpleNamespace(
        create=lambda **kwargs: calls.append(kwargs) or SimpleNamespace(status="completed", output_text="{}")))
    complete = openai_complete("model-a", client=client)
    complete("규칙", "자료", [PICTURE])
    complete("규칙", "자료")
    [message] = calls[0]["input"]
    assert message["role"] == "user"
    assert [part["type"] for part in message["content"]] == ["input_text", "input_image"]
    assert message["content"][1]["image_url"] == PICTURE
    assert calls[1]["input"] == "자료"
