// Formulas in a figure spec: the same grammar and functions as compile_expr in
// src/aleph/figure.py. + - * / ^ (or **), implicit products (2x, x(x-1)), |x|, and
// sqrt cbrt abs sin cos tan exp ln log(x) log(base, x), pi, e. A value a formula cannot
// take is NaN, never an exception.

export class ExprError extends Error {}

type Token = ['num', number] | ['name', string] | ['op', string] | [null, null]
export type Node =
  | ['num', number]
  | ['var']
  | ['neg', Node]
  | ['bin', string, Node, Node]
  | ['call', string, Node[]]

const FUNCTIONS: Record<string, number[]> = { sqrt: [1], cbrt: [1], abs: [1], sin: [1], cos: [1], tan: [1], exp: [1], ln: [1], log: [1, 2] }
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }
const isDigit = (c: string) => c >= '0' && c <= '9'
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

function tokens(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i += 1
    } else if (isDigit(c) || (c === '.' && i + 1 < text.length && isDigit(text[i + 1]))) {
      let j = i
      while (j < text.length && (isDigit(text[j]) || text[j] === '.')) j += 1
      const raw = text.slice(i, j)
      if (!/^(\d+\.?\d*|\.\d+)$/.test(raw)) throw new ExprError(`수 ${raw}`)
      out.push(['num', Number(raw)])
      i = j
    } else if (isLetter(c)) {
      let j = i
      while (j < text.length && isLetter(text[j])) j += 1
      out.push(['name', text.slice(i, j)])
      i = j
    } else if (c === 'π') {
      out.push(['name', 'pi'])
      i += 1
    } else if (text.startsWith('**', i)) {
      out.push(['op', '^'])
      i += 2
    } else if ('+-*/^(),|'.includes(c)) {
      out.push(['op', c])
      i += 1
    } else {
      throw new ExprError(`쓸 수 없는 글자 ${c}`)
    }
  }
  return out
}

class Parser {
  private at = 0
  private bars = 0
  private readonly list: Token[]

  constructor(text: string, private readonly variable: boolean) {
    this.list = tokens(text)
  }

  private peek(): Token {
    return this.at < this.list.length ? this.list[this.at] : [null, null]
  }

  private is(op: string) {
    const [kind, value] = this.peek()
    return kind === 'op' && value === op
  }

  private take(op?: string): Token {
    if (op !== undefined && !this.is(op)) throw new ExprError(`${op}가 필요한 자리`)
    const token = this.peek()
    this.at += 1
    return token
  }

  parse(): Node {
    if (!this.list.length) throw new ExprError('빈 식')
    const node = this.expr()
    if (this.at !== this.list.length) throw new ExprError(`남은 글자 ${this.peek()[1]}`)
    return node
  }

  private expr(): Node {
    let node = this.term()
    while (this.is('+') || this.is('-')) {
      const op = this.take()[1] as string
      node = ['bin', op, node, this.term()]
    }
    return node
  }

  private startsAtom() {
    const [kind, value] = this.peek()
    return kind === 'num' || kind === 'name' || (kind === 'op' && (value === '(' || (value === '|' && this.bars === 0)))
  }

  private term(): Node {
    let node = this.factor()
    for (;;) {
      if (this.is('*') || this.is('/')) {
        const op = this.take()[1] as string
        node = ['bin', op, node, this.factor()]
      } else if (this.startsAtom()) {
        node = ['bin', '*', node, this.factor()]
      } else {
        return node
      }
    }
  }

  private factor(): Node {
    if (this.is('-')) {
      this.take()
      return ['neg', this.factor()]
    }
    if (this.is('+')) {
      this.take()
      return this.factor()
    }
    let node = this.atom()
    if (this.is('^')) {
      this.take()
      node = ['bin', '^', node, this.factor()]
    }
    return node
  }

  private atom(): Node {
    const [kind, value] = this.take()
    if (kind === 'num') return ['num', value]
    if (kind === 'name') {
      if (value in FUNCTIONS) {
        this.take('(')
        const args = [this.expr()]
        while (this.is(',')) {
          this.take()
          args.push(this.expr())
        }
        this.take(')')
        if (!FUNCTIONS[value].includes(args.length)) throw new ExprError(`${value}의 인자 수`)
        return ['call', value, args]
      }
      if (value in CONSTANTS) return ['num', CONSTANTS[value]]
      if (value === 'x' && this.variable) return ['var']
      throw new ExprError(`알 수 없는 이름 ${value}`)
    }
    if (value === '(') {
      const node = this.expr()
      this.take(')')
      return node
    }
    if (value === '|') {
      this.bars += 1
      const node = this.expr()
      this.bars -= 1
      this.take('|')
      return ['call', 'abs', [node]]
    }
    throw new ExprError(kind === null ? '식이 끝나지 않음' : `${value}의 자리`)
  }
}

function call(name: string, args: number[]): number {
  const [a] = args
  switch (name) {
    case 'log':
      return args.length === 1 ? Math.log10(a) : Math.log(args[1]) / Math.log(a)
    case 'sqrt':
      return Math.sqrt(a)
    case 'cbrt':
      return Math.cbrt(a)
    case 'abs':
      return Math.abs(a)
    case 'sin':
      return Math.sin(a)
    case 'cos':
      return Math.cos(a)
    case 'tan':
      return Math.tan(a)
    case 'exp':
      return Math.exp(a)
    default:
      return Math.log(a)
  }
}

function evaluate(node: Node, x: number): number {
  switch (node[0]) {
    case 'num':
      return node[1]
    case 'var':
      return x
    case 'neg':
      return -evaluate(node[1], x)
    case 'call':
      return call(node[1], node[2].map((arg) => evaluate(arg, x)))
    default: {
      const a = evaluate(node[2], x)
      const b = evaluate(node[3], x)
      if (node[1] === '+') return a + b
      if (node[1] === '-') return a - b
      if (node[1] === '*') return a * b
      if (node[1] === '/') return a / b
      return Math.pow(a, b)
    }
  }
}

export interface Compiled {
  (x?: number): number
  tree: Node
}

/** f(x) for a formula; NaN where it is undefined. Throws ExprError when it cannot be read. */
export function compileExpr(text: string, variable = true): Compiled {
  const tree = new Parser(text, variable).parse()
  const f = ((x = 0) => {
    const value = evaluate(tree, x)
    return Number.isFinite(value) ? value : NaN
  }) as Compiled
  f.tree = tree
  return f
}

const PY_CALL: Record<string, (args: string[]) => string> = {
  sqrt: ([a]) => `math.sqrt(${a})`,
  cbrt: ([a]) => `math.cbrt(${a})`,
  abs: ([a]) => `abs(${a})`,
  sin: ([a]) => `math.sin(${a})`,
  cos: ([a]) => `math.cos(${a})`,
  tan: ([a]) => `math.tan(${a})`,
  exp: ([a]) => `math.exp(${a})`,
  ln: ([a]) => `math.log(${a})`,
  log: (args) => (args.length === 1 ? `math.log10(${args[0]})` : `math.log(${args[1]}, ${args[0]})`),
}

const pyNumber = (v: number) => (v === Math.PI ? 'math.pi' : v === Math.E ? 'math.e' : String(v))

/** The formula as Python (math module), for the drawing-kit script. */
export function toPython(node: Node): string {
  switch (node[0]) {
    case 'num':
      return pyNumber(node[1])
    case 'var':
      return 'x'
    case 'neg':
      return `(-${toPython(node[1])})`
    case 'call':
      return PY_CALL[node[1]](node[2].map(toPython))
    default:
      return node[1] === '^' ? `math.pow(${toPython(node[2])}, ${toPython(node[3])})` : `(${toPython(node[2])} ${node[1]} ${toPython(node[3])})`
  }
}
