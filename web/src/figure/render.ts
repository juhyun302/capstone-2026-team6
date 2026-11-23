// Draw a FigureSpec as one SVG, to the drawing kit's standard (figlib_tikz.py and its manual):
// curves 0.8pt, axes and helper lines 0.35pt, dashes 1.5pt/1.5pt fitted so both ends are half
// dashes, Stealth tips 2.06 x 1.05mm, dots 1.1mm, shading RGB(188,188,188) always at the back,
// labels 11pt with x, y, O at the kit's measured places. Every label is kept at least 0.3mm from
// every line: the asked place first, then the nearest free one; a label that still touches a
// line is reported, as fig.save reports it.
// Coordinates here are mm from the board's lower left, y up; the SVG flips y on output.

import { checkFigure, fmt, resolvePoints } from './check'
import { compileExpr } from './expr'
import { texBox, type TexBox } from './tex'
import type { FigureItem, FigureSpec, Num, Pos, Position, Style } from './types'

export type Pt = [number, number]
export type Cmd = { k: 'M' | 'L'; p: Pt } | { k: 'C'; c1: Pt; c2: Pt; p: Pt } | { k: 'Z' }
export type Cubic = [Pt, Pt, Pt, Pt]

const BP = 25.4 / 72
export const W_MAIN = 0.8 * BP
export const W_AUX = 0.35 * BP
const DASH = 1.5 * BP
const DOT_D = 1.1
const GRAY = 'rgb(188,188,188)'
const TIP = { length: 2.06, width: 1.05, inset: 0.45 }
export const AXIS_LABEL: Record<'x' | 'y' | 'O', Pt> = { x: [-0.76, -1.68], y: [-1.95, -0.61], O: [-2.03, -2.28] }
export const MIN_GAP = 0.3
export const SIZE_W: Pt = [65, 90]
export const SIZE_H = 120
/** 11pt, the size of the kit's equation labels. */
export const EM = 11 * BP
export const PAD = 5
const LABEL_GAP = 1.0
const ERROR_MM = 0.02

export interface Frame {
  W: number
  H: number
  ux: number
  uy: number
  ox: number
  oy: number
  view: { x: Pt; y: Pt }
  warnings: string[]
}

export const G = (fr: Frame, x: number, y: number): Pt => [fr.ox + x * fr.ux, fr.oy + y * fr.uy]

/** Board size and units: the view fills the board inside a 5mm margin. */
export function frameOf(spec: FigureSpec, view: { x: Pt; y: Pt }): Frame {
  const [x0, x1] = view.x
  const [y0, y1] = view.y
  const warnings: string[] = []
  let W = spec.width_mm
  let H: number
  let ux: number
  let uy: number
  if (spec.aspect === 'equal') {
    ux = uy = (W - 2 * PAD) / (x1 - x0)
    H = (y1 - y0) * uy + 2 * PAD
    if (H > SIZE_H) {
      ux = uy = (SIZE_H - 2 * PAD) / (y1 - y0)
      H = SIZE_H
      W = (x1 - x0) * ux + 2 * PAD
      warnings.push(`높이를 ${SIZE_H}mm에 맞추느라 대지 너비가 ${fmt(W)}mm로 줄었습니다`)
    }
  } else {
    H = spec.height_mm ?? 60
    ux = (W - 2 * PAD) / (x1 - x0)
    uy = (H - 2 * PAD) / (y1 - y0)
  }
  if (W < SIZE_W[0] || W > SIZE_W[1]) warnings.push(`대지 너비 ${fmt(W)}mm (권장 ${SIZE_W[0]}~${SIZE_W[1]}mm)`)
  if (H > SIZE_H) warnings.push(`대지 높이 ${fmt(H)}mm (상한 ${SIZE_H}mm)`)
  return { W, H, ux, uy, ox: PAD - x0 * ux, oy: PAD - y0 * uy, view, warnings }
}

// ---- geometry -------------------------------------------------------------------------------

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => mul(a, 1 / (len(a) || 1))

function bezier([p0, c1, c2, p3]: Cubic, t: number): Pt {
  const u = 1 - t
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
  ]
}

/** Polylines of a path, 16 points per cubic. */
function flatten(cmds: Cmd[]): Pt[][] {
  const lines: Pt[][] = []
  let current: Pt[] = []
  let start: Pt = [0, 0]
  for (const cmd of cmds) {
    if (cmd.k === 'M') {
      if (current.length) lines.push(current)
      current = [cmd.p]
      start = cmd.p
    } else if (cmd.k === 'L') {
      current.push(cmd.p)
    } else if (cmd.k === 'C') {
      const from = current[current.length - 1]
      for (let i = 1; i <= 16; i += 1) current.push(bezier([from, cmd.c1, cmd.c2, cmd.p], i / 16))
    } else {
      current.push(start)
    }
  }
  if (current.length) lines.push(current)
  return lines
}

const polylineLength = (pts: Pt[]) => pts.slice(1).reduce((sum, p, i) => sum + len(sub(p, pts[i])), 0)

/** "Align dashes to corners and path ends, adjusting lengths": a whole number of dashes, half dashes at both ends. */
function dashOf(length: number, closed: boolean) {
  const m = Math.max(1, Math.round(length / (2 * DASH)))
  const s = length / (2 * m)
  return { s, phase: closed ? 0 : s / 2 }
}

/** Slope of f at x without leaving [a, b], where f may be undefined. */
function slope(f: (x: number) => number, x: number, a: number, b: number) {
  const h = 1e-6 * Math.max(1, Math.abs(x))
  const lo = Math.max(a, x - h)
  const hi = Math.min(b, x + h)
  const value = (f(hi) - f(lo)) / (hi - lo)
  return Number.isFinite(value) ? value : 0
}

/**
 * The kit's Hermite cubic pieces (exact for polynomials of degree 3 or less), split where a piece
 * strays more than 0.02mm from the curve, so any smooth formula comes out right.
 */
function hermite(fr: Frame, f: (x: number) => number, a: number, b: number): Cubic[] {
  const out: Cubic[] = []
  const piece = (xa: number, xb: number, depth: number) => {
    const ya = f(xa)
    const yb = f(xb)
    const A = G(fr, xa, ya)
    const B = G(fr, xb, yb)
    const h = xb - xa
    const chord = len(sub(B, A))
    const limit = (t: Pt) => (len(t) > chord * 0.55 ? mul(unit(t), chord * 0.55) : t)
    const t1 = limit([(h / 3) * fr.ux, (h / 3) * slope(f, xa, a, b) * fr.uy])
    const t2 = limit([(h / 3) * fr.ux, (h / 3) * slope(f, xb, a, b) * fr.uy])
    const cubic: Cubic = [A, add(A, t1), sub(B, t2), B]
    if (depth < 10) {
      for (const t of [0.25, 0.5, 0.75]) {
        const p = bezier(cubic, t)
        const x = (p[0] - fr.ox) / fr.ux
        if (x <= xa || x >= xb) continue
        const y = f(x)
        if (!Number.isFinite(y)) continue
        const steep = (slope(f, x, a, b) * fr.uy) / fr.ux
        if (Math.abs(p[1] - (fr.oy + y * fr.uy)) / Math.hypot(1, steep) > ERROR_MM) {
          piece(xa, (xa + xb) / 2, depth + 1)
          piece((xa + xb) / 2, xb, depth + 1)
          return
        }
      }
    }
    out.push(cubic)
  }
  const n = 8
  for (let i = 0; i < n; i += 1) piece(a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n, 0)
  return out
}

/** How many pieces this curve needed; the kit script draws it with as many equal ones. */
export const pieceCount = (fr: Frame, f: (x: number) => number, a: number, b: number) => hermite(fr, f, a, b).length

/** The cubic pieces drawn for y=f(x) on [a, b], board mm; the kit script reuses them where the kit's own pieces would stray. */
export const curveCubics = hermite

const cubicCmds = (cubics: Cubic[], start = true): Cmd[] => [
  ...(start ? [{ k: 'M' as const, p: cubics[0][0] }] : []),
  ...cubics.map(([, c1, c2, p]) => ({ k: 'C' as const, c1, c2, p })),
]
const reversed = (cubics: Cubic[]): Cubic[] => cubics.map(([p0, c1, c2, p3]): Cubic => [p3, c2, c1, p0]).reverse()

/** Twice the signed area of a closed outline; positive when it runs counterclockwise. */
const turning = (cmds: Cmd[]) => {
  const pts = flatten(cmds).flat()
  return pts.reduce((sum, p, i) => {
    const q = pts[(i + 1) % pts.length]
    return sum + p[0] * q[1] - q[0] * p[1]
  }, 0)
}

/** One closed outline (M, then L/C, then Z) traced the other way. */
function reverseOutline(cmds: Cmd[]): Cmd[] {
  const segments: { from: Pt; c?: [Pt, Pt]; to: Pt }[] = []
  let start: Pt = [0, 0]
  let current: Pt = [0, 0]
  for (const cmd of cmds) {
    if (cmd.k === 'M') start = current = cmd.p
    else if (cmd.k === 'L') {
      segments.push({ from: current, to: cmd.p })
      current = cmd.p
    } else if (cmd.k === 'C') {
      segments.push({ from: current, c: [cmd.c1, cmd.c2], to: cmd.p })
      current = cmd.p
    }
  }
  const out: Cmd[] = [{ k: 'M', p: start }]
  if (current[0] !== start[0] || current[1] !== start[1]) out.push({ k: 'L', p: current })
  for (const s of segments.reverse()) out.push(s.c ? { k: 'C', c1: s.c[1], c2: s.c[0], p: s.from } : { k: 'L', p: s.from })
  out.push({ k: 'Z' })
  return out
}

/** An ellipse arc from t0 to t1 degrees, counterclockwise, in pieces of at most 90 degrees. */
function ellipseCubics(c: Pt, rx: number, ry: number, t0: number, t1: number): Cubic[] {
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / 90))
  const out: Cubic[] = []
  for (let i = 0; i < n; i += 1) {
    const a = ((t0 + ((t1 - t0) * i) / n) * Math.PI) / 180
    const b = ((t0 + ((t1 - t0) * (i + 1)) / n) * Math.PI) / 180
    const k = (4 / 3) * Math.tan((b - a) / 4)
    const p0: Pt = [c[0] + rx * Math.cos(a), c[1] + ry * Math.sin(a)]
    const p3: Pt = [c[0] + rx * Math.cos(b), c[1] + ry * Math.sin(b)]
    out.push([p0, add(p0, mul([-rx * Math.sin(a), ry * Math.cos(a)], k)), sub(p3, mul([-rx * Math.sin(b), ry * Math.cos(b)], k)), p3])
  }
  return out
}

// ---- distances for the label check ----------------------------------------------------------

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const pointRect = (p: Pt, r: Rect) => Math.hypot(Math.max(r.x0 - p[0], 0, p[0] - r.x1), Math.max(r.y0 - p[1], 0, p[1] - r.y1))

function pointSegment(p: Pt, a: Pt, b: Pt) {
  const d = sub(b, a)
  const l2 = d[0] * d[0] + d[1] * d[1]
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0
  return len(sub(p, add(a, mul(d, t))))
}

/** Liang-Barsky: does the segment ab touch the rectangle? */
function crosses(a: Pt, b: Pt, r: Rect) {
  let t0 = 0
  let t1 = 1
  const d = sub(b, a)
  const sides: [number, number][] = [[-d[0], a[0] - r.x0], [d[0], r.x1 - a[0]], [-d[1], a[1] - r.y0], [d[1], r.y1 - a[1]]]
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return true
}

function segmentRect(a: Pt, b: Pt, r: Rect) {
  if (crosses(a, b, r)) return 0
  const corners: Pt[] = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]
  return Math.min(pointRect(a, r), pointRect(b, r), ...corners.map((c) => pointSegment(c, a, b)))
}

const rectGap = (a: Rect, b: Rect) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1))

interface Ink {
  pts: Pt[]
  /** Half the line width, or a dot's radius. */
  hw: number
  box: Rect
}

function inkGap(r: Rect, ink: Ink[], stopBelow = -Infinity) {
  let best = Infinity
  for (const line of ink) {
    if (rectGap(r, line.box) - line.hw >= best) continue
    if (line.pts.length === 1) best = Math.min(best, pointRect(line.pts[0], r) - line.hw)
    for (let i = 1; i < line.pts.length; i += 1) {
      best = Math.min(best, segmentRect(line.pts[i - 1], line.pts[i], r) - line.hw)
      if (best < stopBelow) return best
    }
  }
  return best
}

const boxOf = (pts: Pt[]): Rect => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
})

// ---- scene ----------------------------------------------------------------------------------

interface Stroke {
  cmds: Cmd[]
  width: number
  dash: { s: number; phase: number } | null
  clip: boolean
}
interface Fill {
  cmds: Cmd[]
  color: string
  clip: boolean
}
interface Dot {
  at: Pt
  open: boolean
}

type LabelKind = 'axis' | 'tick' | 'label' | 'name' | 'angle'
interface LabelRequest {
  tex: string
  at: Pt
  order: Position[]
  fixed: boolean
  kind: LabelKind
  axis?: 'x' | 'y' | 'O'
  /** Where the axis label's reference point is: the axis tip, or the origin. */
  ref?: Pt
  /** For a fixed label: other places to try, in order, when the asked one touches a line. */
  alternatives?: Pt[]
}

export interface PlacedLabel {
  tex: string
  kind: LabelKind
  axis?: 'x' | 'y' | 'O'
  ref?: Pt
  position: Position
  /** The ink box, mm. */
  box: Rect
  /** The kit's eq_label anchor: horizontal edge or middle, and the middle of the body-size box. */
  anchor: Pt
  align: 'l' | 'c' | 'r'
  gap: number
  moved: boolean
  ok: boolean
  failed: boolean
  draw: TexBox
  left: number
  baseline: number
}

const DIRECTION: Record<Exclude<Position, 'center'>, number> = {
  right: 0, 'above right': 45, above: 90, 'above left': 135, left: 180, 'below left': 225, below: 270, 'below right': 315,
}
const AROUND = Object.keys(DIRECTION) as Exclude<Position, 'center'>[]

function nearestFirst(position: Position): Position[] {
  if (position === 'center') return ['center', 'above', 'below', 'right', 'left', 'above right', 'above left', 'below right', 'below left']
  const angle = DIRECTION[position]
  const distance = (p: Exclude<Position, 'center'>) => {
    const d = Math.abs(DIRECTION[p] - angle) % 360
    return Math.min(d, 360 - d)
  }
  return [...AROUND].sort((a, b) => distance(a) - distance(b))
}

function positionFromAngle(radians: number): Exclude<Position, 'center'> {
  const degrees = ((radians * 180) / Math.PI + 360) % 360
  return AROUND.reduce((best, p) => {
    const d = (q: Exclude<Position, 'center'>) => Math.min(Math.abs(DIRECTION[q] - degrees), 360 - Math.abs(DIRECTION[q] - degrees))
    return d(p) < d(best) ? p : best
  })
}

/** Where a label of this size sits for a position: the gap is between the point and the body-size box. */
function placeAt(box: TexBox, at: Pt, position: Position, gap: number) {
  const diagonal = position.includes(' ')
  const gx = (diagonal ? 0.75 : 1.2) * gap
  const gy = (diagonal ? 0.75 : 1) * gap
  const left = position.includes('left') ? at[0] - gx - box.width : position.includes('right') ? at[0] + gx : at[0] - box.width / 2
  const baseline = position.includes('above') ? at[1] + gy + 0.25 * EM : position.includes('below') ? at[1] - gy - 0.75 * EM : at[1] - 0.25 * EM
  return { left, baseline, box: { x0: left, y0: baseline - box.descent, x1: left + box.width, y1: baseline + box.ascent } }
}

class Scene {
  readonly strokes: Stroke[] = []
  readonly fills: Fill[] = []
  readonly tips: Cmd[][] = []
  readonly dots: Dot[] = []
  readonly ink: Ink[] = []
  readonly requests: LabelRequest[] = []
  readonly clipRect: Rect

  constructor(readonly fr: Frame) {
    this.clipRect = { x0: PAD, y0: PAD, x1: fr.W - PAD, y1: fr.H - PAD }
  }

  private addInk(pts: Pt[], hw: number, clip: boolean) {
    if (!clip) {
      if (pts.length) this.ink.push({ pts, hw, box: boxOf(pts) })
      return
    }
    const r = this.clipRect
    let run: Pt[] = []
    const inside = (p: Pt) => p[0] >= r.x0 - 0.01 && p[0] <= r.x1 + 0.01 && p[1] >= r.y0 - 0.01 && p[1] <= r.y1 + 0.01
    for (const p of [...pts, null]) {
      if (p && inside(p)) {
        run.push(p)
      } else if (run.length) {
        this.ink.push({ pts: run, hw, box: boxOf(run) })
        run = []
      }
    }
  }

  stroke(cmds: Cmd[], style: Style, { closed = false, clip = false, width }: { closed?: boolean; clip?: boolean; width?: number } = {}) {
    const w = width ?? (style === 'main' ? W_MAIN : W_AUX)
    const lines = flatten(cmds)
    const dash = style === 'dashed' ? dashOf(lines.reduce((sum, pts) => sum + polylineLength(pts), 0), closed) : null
    this.strokes.push({ cmds, width: w, dash, clip })
    for (const pts of lines) this.addInk(pts, w / 2, clip)
  }

  line(a: Pt, b: Pt, style: Style) {
    this.stroke([{ k: 'M', p: a }, { k: 'L', p: b }], style)
  }

  /** A Stealth tip whose point is at `tip`, facing `dir`. */
  tip(tip: Pt, dir: Pt) {
    const d = unit(dir)
    const n: Pt = [-d[1], d[0]]
    const back = sub(tip, mul(d, TIP.length))
    const cmds: Cmd[] = [
      { k: 'M', p: tip },
      { k: 'L', p: add(back, mul(n, TIP.width / 2)) },
      { k: 'L', p: sub(tip, mul(d, TIP.length - TIP.inset)) },
      { k: 'L', p: sub(back, mul(n, TIP.width / 2)) },
      { k: 'Z' },
    ]
    this.tips.push(cmds)
    this.addInk(flatten(cmds)[0], 0, false)
  }

  /** A line whose tip touches b; the line stops inside the tip. */
  arrow(a: Pt, b: Pt, style: Style = 'aux') {
    const d = unit(sub(b, a))
    this.line(a, sub(b, mul(d, TIP.length - TIP.inset - 0.05)), style)
    this.tip(b, d)
  }

  /** Every outline runs counterclockwise: the fills of one colour go out as one path, where overlapping pieces must not cancel. */
  fill(cmds: Cmd[], clip: boolean) {
    this.fills.push({ cmds: turning(cmds) < 0 ? reverseOutline(cmds) : cmds, color: GRAY, clip })
  }

  dot(at: Pt, open: boolean) {
    this.dots.push({ at, open })
    this.ink.push({ pts: [at], hw: DOT_D / 2, box: { x0: at[0], y0: at[1], x1: at[0], y1: at[1] } })
  }

  label(request: LabelRequest) {
    this.requests.push(request)
  }
}

// ---- items ----------------------------------------------------------------------------------

type Resolved = ReturnType<typeof resolvePoints>

function build(spec: FigureSpec, checker: Resolved, fr: Frame): Scene {
  const scene = new Scene(fr)
  const num = (v: Num) => checker.number(v, '')
  const math = (p: Pos): Pt => checker.position(p, '')
  const at = (p: Pos): Pt => {
    const [x, y] = math(p)
    return G(fr, x, y)
  }
  const fn = (expr: string) => compileExpr(expr)
  const span = (pair: [Num, Num]): Pt => [num(pair[0]), num(pair[1])]

  for (const item of spec.items) drawItem(item)
  return scene

  function drawItem(item: FigureItem) {
    const style: Style = 'style' in item && item.style ? item.style : 'aux'
    switch (item.type) {
      case 'axes': {
        const [x0, x1] = span(item.x)
        const [y0, y1] = span(item.y)
        const xTip = G(fr, x1, 0)
        const yTip = G(fr, 0, y1)
        scene.arrow(G(fr, x0, 0), xTip)
        scene.arrow(G(fr, 0, y0), yTip)
        if (item.labels !== false) {
          // the kit's place first; when a curve runs through it, the same offset mirrored
          const mirrors: Record<'x' | 'y' | 'O', Pt[]> = { O: [[-1, 1], [1, -1], [-1, -1]], x: [[1, -1]], y: [[-1, 1]] }
          const axis = (kind: 'x' | 'y' | 'O', ref: Pt, tex: string) => {
            const offset = AXIS_LABEL[kind]
            const alternatives = mirrors[kind].map(([mx, my]) => add(ref, [offset[0] * mx, offset[1] * my]))
            scene.label({ tex, at: add(ref, offset), order: ['center'], fixed: true, kind: 'axis', axis: kind, ref, alternatives })
          }
          axis('O', G(fr, 0, 0), '\\mathrm{O}')
          axis('x', xTip, 'x')
          axis('y', yTip, 'y')
        }
        return
      }
      case 'curve': {
        const [a, b] = span(item.domain)
        scene.stroke(cubicCmds(hermite(fr, fn(item.expr), a, b)), item.style ?? 'main', { clip: true })
        return
      }
      case 'piecewise': {
        const cubics = item.pieces.flatMap((piece) => {
          const [a, b] = span(piece.domain)
          return hermite(fr, fn(piece.expr), a, b)
        })
        scene.stroke(cubicCmds(cubics), item.style ?? 'main', { clip: true })
        return
      }
      case 'segment':
        if (item.arrow) scene.arrow(at(item.from), at(item.to), style)
        else scene.line(at(item.from), at(item.to), style)
        return
      case 'polygon': {
        const pts = item.points.map(at)
        const closed = item.closed !== false
        if (style === 'dashed') {
          const edges = closed ? pts.length : pts.length - 1
          for (let i = 0; i < edges; i += 1) scene.line(pts[i], pts[(i + 1) % pts.length], 'dashed')
        } else {
          scene.stroke([{ k: 'M', p: pts[0] }, ...pts.slice(1).map((p) => ({ k: 'L' as const, p })), ...(closed ? [{ k: 'Z' as const }] : [])], style, { closed })
        }
        return
      }
      case 'circle':
      case 'arc': {
        const r = num(item.radius)
        let t0 = 0
        let t1 = 360
        if (item.type === 'arc') {
          t0 = num(item.from_deg)
          t1 = num(item.to_deg)
          while (t1 <= t0) t1 += 360
        }
        const cubics = ellipseCubics(at(item.center), r * fr.ux, r * fr.uy, t0, t1)
        const closed = item.type === 'circle'
        scene.stroke([...cubicCmds(cubics), ...(closed ? [{ k: 'Z' as const }] : [])], style, { closed })
        return
      }
      case 'dot':
        scene.dot(at(item.at), item.open === true)
        return
      case 'guide': {
        const [x, y] = math(item.at)
        if (item.to !== 'y' && y !== 0) scene.line(G(fr, x, y), G(fr, x, 0), 'dashed')
        if (item.to !== 'x' && x !== 0) scene.line(G(fr, x, y), G(fr, 0, y), 'dashed')
        return
      }
      case 'shade': {
        const [a, b] = span(item.domain)
        const upper = hermite(fr, fn(item.upper), a, b)
        const lower = reversed(hermite(fr, fn(item.lower), a, b))
        scene.fill([...cubicCmds(upper), { k: 'L', p: lower[0][0] }, ...cubicCmds(lower, false), { k: 'Z' }], true)
        return
      }
      case 'shade_polygon': {
        const pts = item.points.map(at)
        scene.fill([{ k: 'M', p: pts[0] }, ...pts.slice(1).map((p) => ({ k: 'L' as const, p })), { k: 'Z' }], false)
        return
      }
      case 'label': {
        const position = item.position ?? 'center'
        scene.label({ tex: item.tex, at: at(item.at), order: nearestFirst(position), fixed: false, kind: 'label' })
        return
      }
      case 'tick': {
        const v = num(item.value)
        const side = item.side ?? (item.axis === 'x' ? 'below' : 'left')
        const opposite = { below: 'above', above: 'below', left: 'right', right: 'left' }[side] as Position
        const order = [side, opposite, ...nearestFirst(side).filter((p) => p !== side && p !== opposite)]
        const tex = item.tex ?? fmt(v)
        scene.label({ tex, at: item.axis === 'x' ? G(fr, v, 0) : G(fr, 0, v), order, fixed: false, kind: 'tick' })
        return
      }
      case 'point_names': {
        const named = item.names.map(math)
        const center = item.center !== undefined ? math(item.center) : mul(named.reduce(add, [0, 0] as Pt), 1 / named.length)
        const c = G(fr, ...center)
        item.names.forEach((name, i) => {
          const p = G(fr, ...named[i])
          const away = sub(p, c)
          const position = len(away) < 1e-9 ? 'above right' : positionFromAngle(Math.atan2(away[1], away[0]))
          scene.label({ tex: `\\mathrm{${name}}`, at: p, order: nearestFirst(position), fixed: false, kind: 'name' })
        })
        return
      }
      case 'callout': {
        const a = at(item.from)
        const b = at(item.to)
        const d = sub(b, a)
        const bend = item.bend ?? 1.5
        const n = mul([-d[1], d[0]], bend / len(d))
        const c1 = add(add(a, mul(d, 1 / 3)), n)
        const c2 = add(add(a, mul(d, 2 / 3)), n)
        const dir = unit(sub(b, c2))
        const back = mul(dir, TIP.length - TIP.inset - 0.05)
        scene.stroke([{ k: 'M', p: a }, { k: 'C', c1, c2: sub(c2, back), p: sub(b, back) }], 'aux')
        scene.tip(b, dir)
        return
      }
      case 'same_length': {
        const a = at(item.from)
        const b = at(item.to)
        const d = sub(b, a)
        const bend = item.side === 'right' ? -2.2 : 2.2
        const u = unit([-d[1], d[0]])
        const h = (bend * 4) / 3
        const c1 = add(add(a, mul(d, 1 / 3)), mul(u, h))
        const c2 = add(add(a, mul(d, 2 / 3)), mul(u, h))
        scene.stroke([{ k: 'M', p: a }, { k: 'C', c1, c2, p: b }], 'dashed')
        const top = add(mul(add(a, b), 0.5), mul(u, bend))
        scene.line(sub(top, mul(u, 1.1)), add(top, mul(u, 1.1)), 'aux')
        return
      }
      case 'right_angle': {
        const v = at(item.vertex)
        const u = unit(sub(at(item.a), v))
        const w = unit(sub(at(item.b), v))
        const s = 1.8
        scene.stroke([{ k: 'M', p: add(v, mul(u, s)) }, { k: 'L', p: add(add(v, mul(u, s)), mul(w, s)) }, { k: 'L', p: add(v, mul(w, s)) }], 'aux')
        return
      }
      case 'angle': {
        const v = at(item.vertex)
        const angleTo = (p: Pt) => Math.atan2(p[1] - v[1], p[0] - v[0])
        const ta = angleTo(at(item.a))
        const tb = angleTo(at(item.b))
        let from = ta
        let sweep = (((tb - ta) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        if (sweep > Math.PI) {
          from = tb
          sweep = 2 * Math.PI - sweep
        }
        const r = 3
        const deg = (t: number) => (t * 180) / Math.PI
        scene.stroke(cubicCmds(ellipseCubics(v, r, r, deg(from), deg(from + sweep))), 'aux')
        if (item.tex) {
          const mid = from + sweep / 2
          scene.label({ tex: item.tex, at: add(v, mul([Math.cos(mid), Math.sin(mid)], r + 2.4)), order: nearestFirst('center'), fixed: false, kind: 'angle' })
        }
      }
    }
  }
}

// ---- labels ---------------------------------------------------------------------------------

function placeLabels(scene: Scene): PlacedLabel[] {
  const { fr } = scene
  const board: Rect = { x0: 0, y0: 0, x1: fr.W, y1: fr.H }
  const placed: PlacedLabel[] = []
  const indexed = scene.requests.map((request, index) => ({ request, index }))
  // axis labels sit where the kit puts them; ticks claim their places before free labels
  const rank = (r: LabelRequest) => (r.kind === 'axis' ? 0 : r.kind === 'tick' ? 1 : 2)
  indexed.sort((a, b) => rank(a.request) - rank(b.request) || a.index - b.index)
  const result: PlacedLabel[] = new Array(scene.requests.length)

  for (const { request, index } of indexed) {
    const draw = texBox(request.tex, EM)
    const tries = request.fixed
      ? [request.at, ...(request.alternatives ?? [])].map((at) => ({ position: 'center' as Position, gap: 0, from: at }))
      : [LABEL_GAP, 2 * LABEL_GAP, 3.5 * LABEL_GAP].flatMap((gap) => request.order.map((position) => ({ position, gap, from: request.at })))
    const score = (box: Rect, stop: number) => {
      const inside = box.x0 >= board.x0 && box.y0 >= board.y0 && box.x1 <= board.x1 && box.y1 <= board.y1
      const others = placed.reduce((best, label) => Math.min(best, rectGap(box, label.box)), Infinity)
      return { gap: Math.min(inkGap(box, scene.ink, stop), others), inside }
    }
    type Spot = { position: Position; gap: number; from: Pt; at: ReturnType<typeof placeAt>; measured: number }
    let chosen: Spot | null = null
    // clear of every line but past the board's edge: the kit crops to ink, so this beats touching a line
    let outside: Spot | null = null
    let fallback: Spot | null = null
    for (const { position, gap, from } of tries) {
      const spot = placeAt(draw, from, position, gap)
      const { gap: measured, inside } = score(spot.box, MIN_GAP)
      if (measured >= MIN_GAP && inside) {
        chosen = { position, gap, from, at: spot, measured }
        break
      }
      if (measured >= MIN_GAP && !outside) outside = { position, gap, from, at: spot, measured }
      // nothing clear: keep the asked place unless another is clearly better
      const full = score(spot.box, -Infinity).gap
      if (!fallback || full > fallback.measured + 0.05) fallback = { position, gap, from, at: spot, measured: full }
    }
    const final = chosen ?? outside ?? fallback!
    const measured = score(final.at.box, -Infinity).gap
    const position = final.position
    const align: PlacedLabel['align'] = position.includes('left') ? 'r' : position.includes('right') ? 'l' : 'c'
    const ax = align === 'r' ? final.at.box.x1 : align === 'l' ? final.at.box.x0 : final.at.left + draw.width / 2
    const label: PlacedLabel = {
      tex: request.tex, kind: request.kind, axis: request.axis, ref: request.ref, position, box: final.at.box,
      anchor: [ax, final.at.baseline + 0.25 * EM], align, gap: measured,
      moved: request.fixed ? final.from !== request.at : position !== request.order[0] || final.gap !== LABEL_GAP,
      ok: measured >= MIN_GAP, failed: draw.failed, draw, left: final.at.left, baseline: final.at.baseline,
    }
    placed.push(label)
    result[index] = label
  }
  return result
}

// ---- output ---------------------------------------------------------------------------------

export interface FigureReport {
  ok: boolean
  summary: string
  rows: { tex: string; gap: number; ok: boolean; moved: boolean; failed: boolean }[]
  warnings: string[]
}

export interface RenderedFigure {
  svg: string
  /** The drawing, cropped to its ink like the kit's PNG. */
  width_mm: number
  height_mm: number
  frame: Frame
  labels: PlacedLabel[]
  /** Every fill outline, board mm, counterclockwise and not clipped: the kit script draws them as one path. */
  fills: Cmd[][]
  report: FigureReport
}

const r4 = (v: number) => String(Math.round(v * 10000) / 10000)

function pathData(cmds: Cmd[], H: number) {
  const p = ([x, y]: Pt) => `${r4(x)} ${r4(H - y)}`
  return cmds.map((c) => (c.k === 'Z' ? 'Z' : c.k === 'C' ? `C${p(c.c1)} ${p(c.c2)} ${p(c.p)}` : `${c.k}${p(c.p)}`)).join('')
}

function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface RenderOptions {
  /** Prefix for ids inside the SVG, so several figures can share a page. */
  uid?: string
  title?: string
}

/** Draw a figure that passed validateFigure. Throws on one that did not. */
export function renderFigure(spec: FigureSpec, { uid = 'fig', title = '그림' }: RenderOptions = {}): RenderedFigure {
  const problem = checkFigure(spec)
  if (problem) throw new Error(problem)
  const checker = resolvePoints(spec)
  const view = { x: [checker.number(spec.view.x[0], ''), checker.number(spec.view.x[1], '')] as Pt, y: [checker.number(spec.view.y[0], ''), checker.number(spec.view.y[1], '')] as Pt }
  const fr = frameOf(spec, view)
  const scene = build(spec, checker, fr)
  const labels = placeLabels(scene)
  const H = fr.H

  // crop to the ink, as the kit's PNG export does
  const fillPts = scene.fills.flatMap((f) => flatten(f.cmds).flat()).map((p): Pt => {
    const r = scene.clipRect
    return [Math.min(Math.max(p[0], r.x0), r.x1), Math.min(Math.max(p[1], r.y0), r.y1)]
  })
  const boxes: Rect[] = [
    ...scene.ink.map((i) => ({ x0: i.box.x0 - i.hw, y0: i.box.y0 - i.hw, x1: i.box.x1 + i.hw, y1: i.box.y1 + i.hw })),
    ...labels.map((l) => l.box),
    ...(fillPts.length ? [boxOf(fillPts)] : []),
  ]
  const m = 0.6
  const x0 = Math.min(...boxes.map((b) => b.x0)) - m
  const x1 = Math.max(...boxes.map((b) => b.x1)) + m
  const y0 = Math.min(...boxes.map((b) => b.y0)) - m
  const y1 = Math.max(...boxes.map((b) => b.y1)) + m
  const width = x1 - x0
  const height = y1 - y0

  const clipId = `${uid}-view`
  const cr = scene.clipRect
  const clipAttr = (clip: boolean) => (clip ? ` clip-path="url(#${clipId})"` : '')
  const parts: string[] = []
  parts.push(`<defs><clipPath id="${clipId}"><rect x="${r4(cr.x0)}" y="${r4(H - cr.y1)}" width="${r4(cr.x1 - cr.x0)}" height="${r4(cr.y1 - cr.y0)}"/></clipPath></defs>`)
  // one path per colour: pieces drawn separately leave a light anti-aliasing seam where they meet
  const fillGroups = new Map<string, Fill[]>()
  for (const f of scene.fills) fillGroups.set(`${f.color}|${f.clip}`, [...(fillGroups.get(`${f.color}|${f.clip}`) ?? []), f])
  for (const group of fillGroups.values()) {
    parts.push(`<path d="${group.map((f) => pathData(f.cmds, H)).join('')}" fill="${group[0].color}" stroke="none"${clipAttr(group[0].clip)}/>`)
  }
  parts.push('<g fill="none" stroke="#000" stroke-linecap="butt" stroke-linejoin="round">')
  for (const s of scene.strokes) {
    const dash = s.dash ? ` stroke-dasharray="${r4(s.dash.s)} ${r4(s.dash.s)}" stroke-dashoffset="${r4(s.dash.phase)}"` : ''
    parts.push(`<path d="${pathData(s.cmds, H)}" stroke-width="${r4(s.width)}"${dash}${clipAttr(s.clip)}/>`)
  }
  parts.push('</g>')
  for (const t of scene.tips) parts.push(`<path d="${pathData(t, H)}" fill="#000" stroke="none"/>`)
  for (const d of scene.dots) {
    if (d.open) parts.push(`<circle cx="${r4(d.at[0])}" cy="${r4(H - d.at[1])}" r="${r4((DOT_D - W_AUX) / 2)}" fill="#fff" stroke="#000" stroke-width="${r4(W_AUX)}"/>`)
    else parts.push(`<circle cx="${r4(d.at[0])}" cy="${r4(H - d.at[1])}" r="${r4(DOT_D / 2)}" fill="#000"/>`)
  }
  for (const l of labels) {
    const [vx, vy, vw, vh] = l.draw.viewBox
    parts.push(
      `<svg x="${r4(l.left)}" y="${r4(H - (l.baseline + l.draw.ascent))}" width="${r4(l.draw.width)}" height="${r4(l.draw.ascent + l.draw.descent)}" ` +
        `viewBox="${vx} ${vy} ${vw} ${vh}" overflow="visible" color="#000" style="color:#000">${l.draw.body}</svg>`,
    )
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${r4(x0)} ${r4(H - y1)} ${r4(width)} ${r4(height)}" ` +
    `width="${r4(width)}mm" height="${r4(height)}mm" role="img" aria-label="${escapeXml(title)}">${parts.join('')}</svg>`

  const bad = labels.filter((l) => !l.ok).length
  const failed = labels.filter((l) => l.failed).length
  const warnings = [...fr.warnings]
  if (width > SIZE_W[1] + 0.05 || height > SIZE_H + 0.05) warnings.push(`글자까지 넣은 그림이 ${fmt(width)} x ${fmt(height)}mm로 규격(너비 ${SIZE_W[1]}mm, 높이 ${SIZE_H}mm 이하)을 넘습니다`)
  const summary = [
    labels.length ? (bad ? `글자-선 간격: ${bad}개가 ${MIN_GAP}mm 미만` : '글자-선 간격: 모두 통과') : '글자-선 간격: 글자 없음',
    ...(failed ? [`읽지 못한 글자 ${failed}개`] : []),
  ].join(' · ')
  return {
    svg, width_mm: width, height_mm: height, frame: fr, labels, fills: scene.fills.map((f) => f.cmds),
    report: {
      ok: !bad && !failed && !warnings.length, summary,
      rows: labels.map((l) => ({ tex: l.tex, gap: l.gap, ok: l.ok, moved: l.moved, failed: l.failed })),
      warnings,
    },
  }
}
