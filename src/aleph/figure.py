"""Check a FigureSpec: the schema, then whether every formula, reference and mark holds.

The renderer (web/src/figure/) draws what passes here; web/src/figure/check.ts is the same
check for the browser build, with the same order and messages. Neither check draws the figure,
so the gap between labels and lines is the renderer's report, not a rule here.
"""

import json
import math
from pathlib import Path

from jsonschema import Draft7Validator

_HERE = Path(__file__).parent
_SCHEMA = json.loads((_HERE / "schemas/figure.schema.json").read_text(encoding="utf-8"))
Draft7Validator.check_schema(_SCHEMA)
_VALIDATOR = Draft7Validator(_SCHEMA)

FIGURE_KEYS = ("statement_figure", "solution_figure")
FIGURE_NAME = {"statement_figure": "문항 그림(statement_figure)",
               "solution_figure": "풀이 그림(solution_figure)"}
SAMPLES = 64
# a point may miss its curve by 0.2% of the view height: well under 0.1mm on paper
TOLERANCE = 0.002
_FUNCTIONS = {"sqrt": (1,), "cbrt": (1,), "abs": (1,), "sin": (1,), "cos": (1,), "tan": (1,),
              "exp": (1,), "ln": (1,), "log": (1, 2)}
_CONSTANTS = {"pi": math.pi, "e": math.e}


class ExprError(ValueError):
    """A formula that cannot be read."""


class _Problem(Exception):
    pass


# ---- formulas -------------------------------------------------------------------------------

def _tokens(text: str) -> list:
    tokens, i = [], 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
        elif c.isdigit() or (c == "." and i + 1 < len(text) and text[i + 1].isdigit()):
            j = i
            while j < len(text) and (text[j].isdigit() or text[j] == "."):
                j += 1
            try:
                tokens.append(("num", float(text[i:j])))
            except ValueError as exc:
                raise ExprError(f"수 {text[i:j]}") from exc
            i = j
        elif c.isascii() and c.isalpha():
            j = i
            while j < len(text) and text[j].isascii() and text[j].isalpha():
                j += 1
            tokens.append(("name", text[i:j]))
            i = j
        elif c == "π":
            tokens.append(("name", "pi"))
            i += 1
        elif text.startswith("**", i):
            tokens.append(("op", "^"))
            i += 2
        elif c in "+-*/^(),|":
            tokens.append(("op", c))
            i += 1
        else:
            raise ExprError(f"쓸 수 없는 글자 {c}")
    return tokens


class _Parser:
    def __init__(self, text: str, variable: bool):
        self.tokens = _tokens(text)
        self.at = 0
        self.variable = variable
        self.bars = 0

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else (None, None)

    def take(self, op=None):
        token = self.peek()
        if op is not None and token != ("op", op):
            raise ExprError(f"{op}가 필요한 자리")
        self.at += 1
        return token

    def parse(self):
        if not self.tokens:
            raise ExprError("빈 식")
        node = self.expr()
        if self.at != len(self.tokens):
            raise ExprError(f"남은 글자 {self.peek()[1]}")
        return node

    def expr(self):
        node = self.term()
        while self.peek() in (("op", "+"), ("op", "-")):
            op = self.take()[1]
            node = ("bin", op, node, self.term())
        return node

    def starts_atom(self) -> bool:
        kind, value = self.peek()
        return kind in ("num", "name") or value == "(" or (value == "|" and self.bars == 0)

    def term(self):
        node = self.factor()
        while True:
            if self.peek() in (("op", "*"), ("op", "/")):
                op = self.take()[1]
                node = ("bin", op, node, self.factor())
            elif self.starts_atom():
                node = ("bin", "*", node, self.factor())
            else:
                return node

    def factor(self):
        if self.peek() == ("op", "-"):
            self.take()
            return ("neg", self.factor())
        if self.peek() == ("op", "+"):
            self.take()
            return self.factor()
        node = self.atom()
        if self.peek() == ("op", "^"):
            self.take()
            node = ("bin", "^", node, self.factor())
        return node

    def atom(self):
        kind, value = self.take()
        if kind == "num":
            return ("num", value)
        if kind == "name":
            if value in _FUNCTIONS:
                self.take("(")
                args = [self.expr()]
                while self.peek() == ("op", ","):
                    self.take()
                    args.append(self.expr())
                self.take(")")
                if len(args) not in _FUNCTIONS[value]:
                    raise ExprError(f"{value}의 인자 수")
                return ("call", value, args)
            if value in _CONSTANTS:
                return ("num", _CONSTANTS[value])
            if value == "x" and self.variable:
                return ("var",)
            raise ExprError(f"알 수 없는 이름 {value}")
        if value == "(":
            node = self.expr()
            self.take(")")
            return node
        if value == "|":
            self.bars += 1
            node = self.expr()
            self.bars -= 1
            self.take("|")
            return ("call", "abs", [node])
        raise ExprError("식이 끝나지 않음" if kind is None else f"{value}의 자리")


def _power(a, b):
    return math.pow(a, b)


def _call(name, args):
    if name == "log":
        return math.log10(args[0]) if len(args) == 1 else math.log(args[1]) / math.log(args[0])
    a = args[0]
    return {"sqrt": math.sqrt, "cbrt": math.cbrt, "abs": abs, "sin": math.sin, "cos": math.cos,
            "tan": math.tan, "exp": math.exp, "ln": math.log}[name](a)


def _evaluate(node, x):
    kind = node[0]
    if kind == "num":
        return node[1]
    if kind == "var":
        return x
    if kind == "neg":
        return -_evaluate(node[1], x)
    if kind == "call":
        return _call(node[1], [_evaluate(arg, x) for arg in node[2]])
    op, a, b = node[1], _evaluate(node[2], x), _evaluate(node[3], x)
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    if op == "/":
        return a / b
    return _power(a, b)


def compile_expr(text: str, *, variable: bool = True):
    """Return f(x) for a formula; a value the formula cannot take is nan, never an exception."""
    if not isinstance(text, str):
        raise TypeError("expression must be a string")
    tree = _Parser(text, variable).parse()

    def f(x: float = 0.0) -> float:
        try:
            value = float(_evaluate(tree, x))
        except (ValueError, ZeroDivisionError, OverflowError):
            return math.nan
        return value if math.isfinite(value) else math.nan

    return f


# ---- schema ---------------------------------------------------------------------------------

def _where(path) -> str:
    text = ""
    for part in path:
        text += f"[{part}]" if isinstance(part, int) else (f".{part}" if text else part)
    return text or "그림"


def _schema_problem(spec) -> str | None:
    errors = list(_VALIDATOR.iter_errors(spec))
    if not errors:
        return None
    error = min(errors, key=lambda e: ([str(part) for part in e.absolute_path], e.validator))
    where = _where(error.absolute_path)
    if error.validator == "required":
        missing = [key for key in error.validator_value if key not in error.instance]
        return f"{where}에 {missing[0]} 항목이 없습니다"
    if error.validator == "additionalProperties":
        known = error.schema.get("properties", {})
        extra = sorted(key for key in error.instance if key not in known)
        return f"{where}에 정해지지 않은 항목이 있습니다: {extra[0]}"
    if error.validator in ("enum", "const"):
        return f"{where}의 값이 허용되지 않습니다"
    return f"{where}의 형식이 맞지 않습니다"


# ---- meaning --------------------------------------------------------------------------------

def _fmt(value: float) -> str:
    """At most three decimals, no trailing zeros; the same text as fmt in check.ts."""
    text = f"{round(value, 3):.3f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


class _Checker:
    def __init__(self, spec: dict):
        self.spec = spec
        self.points = {}
        self.curves = {}

    def number(self, value, where: str) -> float:
        if not isinstance(value, str):
            return float(value)
        try:
            result = compile_expr(value, variable=False)()
        except ExprError as exc:
            raise _Problem(f"{where}의 식을 읽을 수 없습니다: {value} ({exc})") from exc
        if math.isnan(result):
            raise _Problem(f"{where}의 식을 계산할 수 없습니다: {value}")
        return result

    def range(self, value, where: str) -> tuple:
        low, high = self.number(value[0], where), self.number(value[1], where)
        if not low < high:
            raise _Problem(f"{where}의 앞 값이 뒤 값보다 작아야 합니다")
        return low, high

    def position(self, value, where: str) -> tuple:
        if isinstance(value, str):
            if value not in self.points:
                raise _Problem(f"{where}의 점 {value}이 points에 없습니다")
            return self.points[value]
        return self.number(value[0], where), self.number(value[1], where)

    def formula(self, text: str, domain: tuple, where: str):
        try:
            f = compile_expr(text)
        except ExprError as exc:
            raise _Problem(f"{where}의 식을 읽을 수 없습니다: {text} ({exc})") from exc
        low, high = domain
        for k in range(SAMPLES):
            x = low + (high - low) * k / (SAMPLES - 1)
            if math.isnan(f(x)):
                raise _Problem(f"{where}의 식 {text}을 x={_fmt(x)}에서 계산할 수 없습니다")
        return f

    def run(self) -> None:
        spec = self.spec
        x_view = self.range(spec["view"]["x"], "view.x")
        y_view = self.range(spec["view"]["y"], "view.y")
        self.tol_x = TOLERANCE * (x_view[1] - x_view[0])
        self.tol_y = TOLERANCE * (y_view[1] - y_view[0])
        for name, pair in (spec.get("points") or {}).items():
            self.points[name] = (self.number(pair[0], f"points.{name}"),
                                 self.number(pair[1], f"points.{name}"))
        ids = set()
        for index, item in enumerate(spec["items"]):
            if "id" in item:
                if item["id"] in ids:
                    raise _Problem(f"items[{index}]의 id {item['id']}가 두 번 쓰였습니다")
                ids.add(item["id"])
        for index, item in enumerate(spec["items"]):
            getattr(self, f"_{item['type']}")(item, f"items[{index}]({item['type']})")

    def on_curves(self, item: dict, at: tuple, where: str) -> None:
        for curve_id in item.get("on", []):
            if curve_id not in self.curves:
                raise _Problem(f"{where}의 곡선 {curve_id}이 없습니다. on에는 curve나 piecewise의 id를 씁니다")
            x, y = at
            values = [f(min(max(x, low), high)) for f, low, high in self.curves[curve_id]
                      if low - self.tol_x <= x <= high + self.tol_x]
            if not any(abs(value - y) <= self.tol_y for value in values):
                raise _Problem(f"{where}의 점 ({_fmt(x)}, {_fmt(y)})이 곡선 {curve_id} 위에 있지 않습니다")

    def _axes(self, item, where):
        self.range(item["x"], f"{where}.x")
        self.range(item["y"], f"{where}.y")

    def _curve(self, item, where):
        domain = self.range(item["domain"], f"{where}.domain")
        f = self.formula(item["expr"], domain, where)
        if "id" in item:
            self.curves[item["id"]] = [(f, *domain)]

    def _piecewise(self, item, where):
        pieces = []
        for k, piece in enumerate(item["pieces"]):
            domain = self.range(piece["domain"], f"{where}.pieces[{k}].domain")
            pieces.append((self.formula(piece["expr"], domain, f"{where}.pieces[{k}]"), *domain))
        for k in range(len(pieces) - 1):
            (f, _, end), (g, start, _) = pieces[k], pieces[k + 1]
            if abs(end - start) > 1e-9 * (1 + abs(end)):
                raise _Problem(f"{where}.pieces[{k + 1}]의 구간이 앞 구간의 끝에서 시작하지 않습니다")
            if abs(f(end) - g(end)) > self.tol_y:
                raise _Problem(f"{where}가 x={_fmt(end)}에서 이어지지 않습니다. 끊어지는 함수는 curve 여러 개로 그립니다")
        if "id" in item:
            self.curves[item["id"]] = pieces

    def _segment(self, item, where):
        self.position(item["from"], f"{where}.from")
        self.position(item["to"], f"{where}.to")

    def _polygon(self, item, where):
        for k, point in enumerate(item["points"]):
            self.position(point, f"{where}.points[{k}]")

    _shade_polygon = _polygon

    def _circle(self, item, where):
        self.position(item["center"], f"{where}.center")
        if not self.number(item["radius"], f"{where}.radius") > 0:
            raise _Problem(f"{where}의 반지름이 양수가 아닙니다")

    def _arc(self, item, where):
        self._circle(item, where)
        start = self.number(item["from_deg"], f"{where}.from_deg")
        end = self.number(item["to_deg"], f"{where}.to_deg")
        if start == end:
            raise _Problem(f"{where}의 from_deg와 to_deg가 같습니다")

    def _dot(self, item, where):
        self.on_curves(item, self.position(item["at"], f"{where}.at"), where)

    _guide = _dot

    def _shade(self, item, where):
        domain = self.range(item["domain"], f"{where}.domain")
        upper = self.formula(item["upper"], domain, f"{where}.upper")
        lower = self.formula(item["lower"], domain, f"{where}.lower")
        low, high = domain
        for k in range(SAMPLES):
            x = low + (high - low) * k / (SAMPLES - 1)
            if upper(x) < lower(x) - self.tol_y:
                raise _Problem(f"{where}의 upper가 x={_fmt(x)}에서 lower보다 아래에 있습니다")

    def _label(self, item, where):
        self.position(item["at"], f"{where}.at")

    def _tick(self, item, where):
        self.number(item["value"], f"{where}.value")

    def _point_names(self, item, where):
        for name in item["names"]:
            self.position(name, f"{where}.names")
        if "center" in item:
            self.position(item["center"], f"{where}.center")

    def _two_points(self, item, where, first, second):
        a = self.position(item[first], f"{where}.{first}")
        b = self.position(item[second], f"{where}.{second}")
        if a == b:
            raise _Problem(f"{where}의 {first}와 {second}가 같은 점입니다")
        return a, b

    def _callout(self, item, where):
        self._two_points(item, where, "from", "to")

    _same_length = _callout

    def _rays(self, item, where):
        v = self.position(item["vertex"], f"{where}.vertex")
        a = self.position(item["a"], f"{where}.a")
        b = self.position(item["b"], f"{where}.b")
        if a == v or b == v:
            raise _Problem(f"{where}의 a나 b가 꼭짓점과 같은 점입니다")
        return (a[0] - v[0], a[1] - v[1]), (b[0] - v[0], b[1] - v[1])

    def _right_angle(self, item, where):
        u, w = self._rays(item, where)
        cos = (u[0] * w[0] + u[1] * w[1]) / (math.hypot(*u) * math.hypot(*w))
        if abs(cos) > 0.01:
            raise _Problem(f"{where}의 두 변이 수직이 아닙니다")

    def _angle(self, item, where):
        self._rays(item, where)


def check_figure(spec: dict) -> str | None:
    """Return the first broken rule of a schema-valid figure, or None."""
    try:
        _Checker(spec).run()
    except _Problem as problem:
        return str(problem)
    return None


def validate_figure(spec) -> str | None:
    """Return why a figure cannot be drawn as written, or None when it can."""
    return _schema_problem(spec) or check_figure(spec)


def figure_mismatch(candidate: dict, plan: dict | None = None) -> str | None:
    """A statement that points to a figure must have one, and the plan decides which exist."""
    has_statement = candidate.get("statement_figure") is not None
    has_solution = candidate.get("solution_figure") is not None
    mentions = "그림" in candidate["statement"]
    if has_statement and not mentions:
        return "문항 그림이 있는데 statement가 그림을 가리키지 않습니다. \"그림과 같이\"처럼 그림을 가리켜야 합니다."
    if mentions and not has_statement:
        return "statement가 그림을 가리키는데 statement_figure가 없습니다."
    if plan is None:
        return None
    planned = plan.get("figure", "none")
    if planned in ("statement", "both") and not has_statement:
        return "설계안이 문항 그림을 쓰기로 했는데 statement_figure가 없습니다."
    if planned in ("none", "solution") and has_statement:
        return "설계안이 문항 그림을 쓰지 않기로 했는데 statement_figure가 있습니다."
    if planned in ("solution", "both") and not has_solution:
        return "설계안이 풀이 그림을 쓰기로 했는데 solution_figure가 없습니다."
    return None
