// Browser port of src/aleph/figure.py: the schema, then whether every formula, reference and
// mark holds. Same order and messages as the Python check, so a retry tells the model the same thing.

import Ajv from 'ajv'
import figureSchema from '../../../src/aleph/schemas/figure.schema.json?raw'
import { compileExpr, ExprError, type Compiled } from './expr'
import type { FigureItem, FigureSpec, Num, Pair, Pos } from './types'
import { FIGURE_KEYS, FIGURE_NAME } from './types'

export const SAMPLES = 64
export const TOLERANCE = 0.002

const SCHEMA = JSON.parse(figureSchema)
const VALIDATE = new Ajv({ strict: false, allErrors: true }).compile(SCHEMA)

class Problem extends Error {}

function where(path: string[]) {
  let text = ''
  for (const part of path) text += /^\d+$/.test(part) ? `[${part}]` : text ? `.${part}` : part
  return text || '그림'
}

const comparePaths = (a: string[], b: string[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length - b.length
}

function schemaProblem(spec: unknown): string | null {
  if (VALIDATE(spec)) return null
  const errors = (VALIDATE.errors ?? [])
    .filter((e) => e.keyword !== 'if')
    .map((e) => ({ path: e.instancePath.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')), keyword: e.keyword, params: e.params as Record<string, string> }))
  errors.sort((a, b) => comparePaths(a.path, b.path) || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0))
  const first = errors[0]
  const at = where(first.path)
  if (first.keyword === 'required') return `${at}에 ${first.params.missingProperty} 항목이 없습니다`
  if (first.keyword === 'additionalProperties') {
    const extra = errors
      .filter((e) => e.keyword === 'additionalProperties' && comparePaths(e.path, first.path) === 0)
      .map((e) => e.params.additionalProperty)
      .sort()
    return `${at}에 정해지지 않은 항목이 있습니다: ${extra[0]}`
  }
  if (first.keyword === 'enum' || first.keyword === 'const') return `${at}의 값이 허용되지 않습니다`
  return `${at}의 형식이 맞지 않습니다`
}

/** At most three decimals, no trailing zeros; the same text as _fmt in figure.py. */
export function fmt(value: number) {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' ? '0' : text
}

type Piece = [Compiled, number, number]
type Point = [number, number]

class Checker {
  readonly points: Record<string, Point> = {}
  readonly curves: Record<string, Piece[]> = {}
  private tolX = 0
  private tolY = 0

  constructor(private readonly spec: FigureSpec) {}

  number(value: Num, at: string): number {
    if (typeof value !== 'string') return value
    let result: number
    try {
      result = compileExpr(value, false)()
    } catch (error) {
      if (error instanceof ExprError) throw new Problem(`${at}의 식을 읽을 수 없습니다: ${value} (${error.message})`)
      throw error
    }
    if (Number.isNaN(result)) throw new Problem(`${at}의 식을 계산할 수 없습니다: ${value}`)
    return result
  }

  range(value: Pair, at: string): [number, number] {
    const low = this.number(value[0], at)
    const high = this.number(value[1], at)
    if (!(low < high)) throw new Problem(`${at}의 앞 값이 뒤 값보다 작아야 합니다`)
    return [low, high]
  }

  position(value: Pos, at: string): Point {
    if (typeof value === 'string') {
      if (!(value in this.points)) throw new Problem(`${at}의 점 ${value}이 points에 없습니다`)
      return this.points[value]
    }
    return [this.number(value[0], at), this.number(value[1], at)]
  }

  formula(text: string, [low, high]: [number, number], at: string): Compiled {
    let f: Compiled
    try {
      f = compileExpr(text)
    } catch (error) {
      if (error instanceof ExprError) throw new Problem(`${at}의 식을 읽을 수 없습니다: ${text} (${error.message})`)
      throw error
    }
    for (let k = 0; k < SAMPLES; k += 1) {
      const x = low + ((high - low) * k) / (SAMPLES - 1)
      if (Number.isNaN(f(x))) throw new Problem(`${at}의 식 ${text}을 x=${fmt(x)}에서 계산할 수 없습니다`)
    }
    return f
  }

  run() {
    const { spec } = this
    const x = this.range(spec.view.x, 'view.x')
    const y = this.range(spec.view.y, 'view.y')
    this.tolX = TOLERANCE * (x[1] - x[0])
    this.tolY = TOLERANCE * (y[1] - y[0])
    for (const [name, pair] of Object.entries(spec.points ?? {})) {
      this.points[name] = [this.number(pair[0], `points.${name}`), this.number(pair[1], `points.${name}`)]
    }
    const ids = new Set<string>()
    spec.items.forEach((item, index) => {
      if ('id' in item && item.id !== undefined) {
        if (ids.has(item.id)) throw new Problem(`items[${index}]의 id ${item.id}가 두 번 쓰였습니다`)
        ids.add(item.id)
      }
    })
    spec.items.forEach((item, index) => this.item(item, `items[${index}](${item.type})`))
  }

  private onCurves(on: string[] | undefined, [x, y]: Point, at: string) {
    for (const id of on ?? []) {
      if (!(id in this.curves)) throw new Problem(`${at}의 곡선 ${id}이 없습니다. on에는 curve나 piecewise의 id를 씁니다`)
      const values = this.curves[id]
        .filter(([, low, high]) => low - this.tolX <= x && x <= high + this.tolX)
        .map(([f, low, high]) => f(Math.min(Math.max(x, low), high)))
      if (!values.some((value) => Math.abs(value - y) <= this.tolY)) throw new Problem(`${at}의 점 (${fmt(x)}, ${fmt(y)})이 곡선 ${id} 위에 있지 않습니다`)
    }
  }

  private twoPoints(a: Pos, b: Pos, at: string, first: string, second: string) {
    const p = this.position(a, `${at}.${first}`)
    const q = this.position(b, `${at}.${second}`)
    if (p[0] === q[0] && p[1] === q[1]) throw new Problem(`${at}의 ${first}와 ${second}가 같은 점입니다`)
  }

  private rays(vertex: Pos, a: Pos, b: Pos, at: string): [Point, Point] {
    const v = this.position(vertex, `${at}.vertex`)
    const p = this.position(a, `${at}.a`)
    const q = this.position(b, `${at}.b`)
    if ((p[0] === v[0] && p[1] === v[1]) || (q[0] === v[0] && q[1] === v[1])) throw new Problem(`${at}의 a나 b가 꼭짓점과 같은 점입니다`)
    return [[p[0] - v[0], p[1] - v[1]], [q[0] - v[0], q[1] - v[1]]]
  }

  private circle(center: Pos, radius: Num, at: string) {
    this.position(center, `${at}.center`)
    if (!(this.number(radius, `${at}.radius`) > 0)) throw new Problem(`${at}의 반지름이 양수가 아닙니다`)
  }

  private item(item: FigureItem, at: string) {
    switch (item.type) {
      case 'axes':
        this.range(item.x, `${at}.x`)
        this.range(item.y, `${at}.y`)
        return
      case 'curve': {
        const domain = this.range(item.domain, `${at}.domain`)
        const f = this.formula(item.expr, domain, at)
        if (item.id !== undefined) this.curves[item.id] = [[f, ...domain]]
        return
      }
      case 'piecewise': {
        const pieces: Piece[] = item.pieces.map((piece, k) => {
          const domain = this.range(piece.domain, `${at}.pieces[${k}].domain`)
          return [this.formula(piece.expr, domain, `${at}.pieces[${k}]`), ...domain]
        })
        for (let k = 0; k < pieces.length - 1; k += 1) {
          const [f, , end] = pieces[k]
          const [g, start] = pieces[k + 1]
          if (Math.abs(end - start) > 1e-9 * (1 + Math.abs(end))) throw new Problem(`${at}.pieces[${k + 1}]의 구간이 앞 구간의 끝에서 시작하지 않습니다`)
          if (Math.abs(f(end) - g(end)) > this.tolY) throw new Problem(`${at}가 x=${fmt(end)}에서 이어지지 않습니다. 끊어지는 함수는 curve 여러 개로 그립니다`)
        }
        if (item.id !== undefined) this.curves[item.id] = pieces
        return
      }
      case 'segment':
        this.position(item.from, `${at}.from`)
        this.position(item.to, `${at}.to`)
        return
      case 'polygon':
      case 'shade_polygon':
        item.points.forEach((point, k) => this.position(point, `${at}.points[${k}]`))
        return
      case 'circle':
        this.circle(item.center, item.radius, at)
        return
      case 'arc': {
        this.circle(item.center, item.radius, at)
        const start = this.number(item.from_deg, `${at}.from_deg`)
        const end = this.number(item.to_deg, `${at}.to_deg`)
        if (start === end) throw new Problem(`${at}의 from_deg와 to_deg가 같습니다`)
        return
      }
      case 'dot':
      case 'guide':
        this.onCurves(item.on, this.position(item.at, `${at}.at`), at)
        return
      case 'shade': {
        const domain = this.range(item.domain, `${at}.domain`)
        const upper = this.formula(item.upper, domain, `${at}.upper`)
        const lower = this.formula(item.lower, domain, `${at}.lower`)
        const [low, high] = domain
        for (let k = 0; k < SAMPLES; k += 1) {
          const x = low + ((high - low) * k) / (SAMPLES - 1)
          if (upper(x) < lower(x) - this.tolY) throw new Problem(`${at}의 upper가 x=${fmt(x)}에서 lower보다 아래에 있습니다`)
        }
        return
      }
      case 'label':
        this.position(item.at, `${at}.at`)
        return
      case 'tick':
        this.number(item.value, `${at}.value`)
        return
      case 'point_names':
        for (const name of item.names) this.position(name, `${at}.names`)
        if (item.center !== undefined) this.position(item.center, `${at}.center`)
        return
      case 'callout':
      case 'same_length':
        this.twoPoints(item.from, item.to, at, 'from', 'to')
        return
      case 'right_angle': {
        const [u, w] = this.rays(item.vertex, item.a, item.b, at)
        const cos = (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))
        if (Math.abs(cos) > 0.01) throw new Problem(`${at}의 두 변이 수직이 아닙니다`)
        return
      }
      case 'angle':
        this.rays(item.vertex, item.a, item.b, at)
    }
  }
}

/** The first broken rule of a schema-valid figure, or null. */
export function checkFigure(spec: FigureSpec): string | null {
  try {
    new Checker(spec).run()
  } catch (error) {
    if (error instanceof Problem) return error.message
    throw error
  }
  return null
}

/** Why a figure cannot be drawn as written, or null when it can. */
export function validateFigure(spec: unknown): string | null {
  return schemaProblem(spec) ?? checkFigure(spec as FigureSpec)
}

/** Every named point and number of a valid figure, resolved; the renderer's input. */
export function resolvePoints(spec: FigureSpec) {
  const checker = new Checker(spec)
  checker.run()
  return checker
}

interface WithFigures {
  statement: string
  statement_figure?: unknown
  solution_figure?: unknown
}

/** A statement that points to a figure must have one, and the plan decides which exist. */
export function figureMismatch(candidate: WithFigures, plan?: { figure?: string } | null): string | null {
  const hasStatement = candidate.statement_figure != null
  const hasSolution = candidate.solution_figure != null
  const mentions = candidate.statement.includes('그림')
  if (hasStatement && !mentions) return '문항 그림이 있는데 statement가 그림을 가리키지 않습니다. "그림과 같이"처럼 그림을 가리켜야 합니다.'
  if (mentions && !hasStatement) return 'statement가 그림을 가리키는데 statement_figure가 없습니다.'
  if (!plan) return null
  const planned = plan.figure ?? 'none'
  if ((planned === 'statement' || planned === 'both') && !hasStatement) return '설계안이 문항 그림을 쓰기로 했는데 statement_figure가 없습니다.'
  if ((planned === 'none' || planned === 'solution') && hasStatement) return '설계안이 문항 그림을 쓰지 않기로 했는데 statement_figure가 있습니다.'
  if ((planned === 'solution' || planned === 'both') && !hasSolution) return '설계안이 풀이 그림을 쓰기로 했는데 solution_figure가 없습니다.'
  return null
}

/** The first figure problem of a candidate, as validate_candidate_question reports it. */
export function candidateFigureProblem(candidate: WithFigures & Record<string, unknown>, plan?: { figure?: string } | null): { code: 'FIGURE_INVALID' | 'FIGURE_MISMATCH'; reason: string } | null {
  for (const key of FIGURE_KEYS) {
    if (candidate[key] != null) {
      const problem = validateFigure(candidate[key])
      if (problem) return { code: 'FIGURE_INVALID', reason: `${FIGURE_NAME[key]} 명세가 규칙을 어겼습니다: ${problem}.` }
    }
  }
  const mismatch = figureMismatch(candidate, plan)
  return mismatch ? { code: 'FIGURE_MISMATCH', reason: mismatch } : null
}
