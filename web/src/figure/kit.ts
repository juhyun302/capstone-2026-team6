// A figure as a drawing-kit script: figlib_tikz.py calls plus the label list run_tikz.py reads
// (name<TAB>$LaTeX$). Run in the kit, the labels become Hancom equations and the figure is the
// print original (PDF + 600dpi PNG). Label places come from this app's layout, made with
// MathJax widths; Hancom glyphs are a little different, so the kit's gap check is the last word.

import { resolvePoints } from './check'
import { compileExpr, toPython } from './expr'
import { G, curveCubics, pieceCount, type Cmd, type Cubic, type Frame, type Pt, type RenderedFigure } from './render'
import type { FigureItem, FigureSpec, Num, Pos, Style } from './types'

const n4 = (v: number) => String(Math.round(v * 10000) / 10000)
const p = ([x, y]: Pt) => `P(${n4(x)}, ${n4(y)})`

// ---- TikZ for fig.raw, in the kit's units (mm coordinates, bp widths) and styles ----
const MM = 72 / 25.4
const KIT_DASH = 1.5
const c4 = ([x, y]: Pt) => `(${x.toFixed(4)},${y.toFixed(4)})`
const stroke = (w: number) => `line width=${w}bp, line cap=butt, line join=round`
const GRAY_FILL = 'fill={rgb,255:red,188;green,188;blue,188}'
const bezier = ([a, b, c, d]: Cubic, t: number): Pt => {
  const u = 1 - t
  return [0, 1].map((i) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]) as Pt
}
const cubicsPath = (cubics: Cubic[]) => c4(cubics[0][0]) + cubics.map(([, c1, c2, q]) => ` .. controls ${c4(c1)} and ${c4(c2)} .. ${c4(q)}`).join('')
const cmdsPath = (cmds: Cmd[]) =>
  cmds.map((cmd) => (cmd.k === 'M' ? ` ${c4(cmd.p)}` : cmd.k === 'L' ? ` -- ${c4(cmd.p)}` : cmd.k === 'C' ? ` .. controls ${c4(cmd.c1)} and ${c4(cmd.c2)} .. ${c4(cmd.p)}` : ' -- cycle')).join('').trim()
/** The kit's dash fit (_dash_opts): whole dashes, half dashes at both ends. */
function dashFit(cubics: Cubic[]) {
  let length = 0
  for (const cubic of cubics) {
    let prev = cubic[0]
    for (let i = 1; i <= 64; i += 1) {
      const q = bezier(cubic, i / 64)
      length += Math.hypot(q[0] - prev[0], q[1] - prev[1])
      prev = q
    }
  }
  const L = length * MM
  const s = L / (2 * Math.max(1, Math.round(L / (2 * KIT_DASH))))
  return `dash pattern=on ${s.toFixed(4)}bp off ${s.toFixed(4)}bp, dash phase=${(s / 2).toFixed(4)}bp`
}
/** A long TikZ string as adjacent Python raw strings, one piece per line. */
function rawCall(tikz: string, note: string) {
  const chunks = tikz.match(/.{1,180}(\s|$)|.{1,180}/g) ?? [tikz]
  return `fig.raw(  # ${note}\n${chunks.map((chunk) => `    r'${chunk}'`).join('\n')}\n)`
}

/**
 * Would the kit's own curve stray from y=f(x)? The kit draws n equal Hermite pieces with the
 * script's numeric slope and no limit on the tangent, so a slope that blows up (a square root at
 * the end of its domain) overshoots; a value Python cannot compute stops the script.
 */
function kitStrays(fr: Frame, f: (x: number) => number, a: number, b: number, n: number) {
  const slope = (x: number) => {
    const h = 1e-6 * Math.max(1, Math.abs(x))
    const lo = Math.max(a, x - h)
    const hi = Math.min(b, x + h)
    return (f(hi) - f(lo)) / (hi - lo)
  }
  const h = (b - a) / n
  for (let i = 0; i < n; i += 1) {
    const [xa, xb] = [a + h * i, a + h * (i + 1)]
    const [ya, yb, sa, sb] = [f(xa), f(xb), slope(xa), slope(xb)]
    if (![ya, yb, sa, sb].every(Number.isFinite)) return true
    const [A, B] = [G(fr, xa, ya), G(fr, xb, yb)]
    const cubic: Cubic = [A, [A[0] + (h / 3) * fr.ux, A[1] + (h / 3) * sa * fr.uy], [B[0] - (h / 3) * fr.ux, B[1] - (h / 3) * sb * fr.uy], B]
    for (let k = 1; k < 10; k += 1) {
      const q = bezier(cubic, k / 10)
      const x = (q[0] - fr.ox) / fr.ux
      const y = f(x)
      if (!Number.isFinite(y)) return true
      const steep = (slope(x) * fr.uy) / fr.ux
      if (Math.abs(q[1] - G(fr, x, y)[1]) / Math.hypot(1, Number.isFinite(steep) ? steep : 0) > 0.05) return true
    }
  }
  return false
}

export interface KitFiles {
  script: string
  labels: string
}

/** `name` is the kit's file name, e.g. 12회_21_1; labels are named name_O, name_L01, ... */
export function kitFiles(spec: FigureSpec, drawn: RenderedFigure, name: string): KitFiles {
  const checker = resolvePoints(spec)
  const fr = drawn.frame
  const num = (v: Num) => checker.number(v, '')
  const at = (pos: Pos): Pt => G(fr, ...checker.position(pos, ''))
  const lines: string[] = []
  const functions: string[] = []
  let count = 0

  const pieceN = (f: (x: number) => number, a: number, b: number) => Math.max(8, Math.min(200, pieceCount(fr, f, a, b)))
  const define = (expr: string, a: number, b: number) => {
    count += 1
    const f = `f${count}`
    functions.push(`def ${f}(x):\n    return ${toPython(compileExpr(expr).tree)}\n\n\ndef d${f}(x):\n    return slope(${f}, x, ${n4(a)}, ${n4(b)})\n`)
    return { f, df: `d${f}`, n: pieceN(compileExpr(expr), a, b) }
  }
  const width = (style: Style | undefined, main: boolean) => ((style ?? (main ? 'main' : 'aux')) === 'main' ? 'W_MAIN' : 'W_AUX')

  const item = (it: FigureItem) => {
    const style = 'style' in it ? it.style : undefined
    switch (it.type) {
      case 'axes': {
        const [x0, x1] = [num(it.x[0]), num(it.x[1])]
        const [y0, y1] = [num(it.y[0]), num(it.y[1])]
        lines.push(`fig.axis(G(${n4(x0)}, 0), G(${n4(x1)}, 0))`, `fig.axis(G(0, ${n4(y0)}), G(0, ${n4(y1)}))`)
        return
      }
      case 'curve':
      case 'piecewise': {
        const pieces = (it.type === 'curve' ? [{ expr: it.expr, domain: it.domain }] : it.pieces).map((piece) => {
          const [a, b] = [num(piece.domain[0]), num(piece.domain[1])]
          const f = compileExpr(piece.expr)
          return { expr: piece.expr, a, b, f, n: pieceN(f, a, b) }
        })
        if (pieces.some((c) => kitStrays(fr, c.f, c.a, c.b, c.n))) {
          // the same pieces this app draws, so the print matches the screen
          const cubics = pieces.flatMap((c) => curveCubics(fr, c.f, c.a, c.b))
          const look = style === 'dashed' ? `${stroke(0.35)}, ${dashFit(cubics)}` : stroke(style === 'aux' ? 0.35 : 0.8)
          lines.push(rawCall(`\\draw[${look}] ${cubicsPath(cubics)};`, '키트 곡선은 끝점 기울기가 너무 커서 어긋나므로 Aleph 화면의 곡선 조각을 그대로 씁니다'))
          return
        }
        const defined = pieces.map((c) => ({ ...define(c.expr, c.a, c.b), a: c.a, b: c.b }))
        if (style === 'dashed') {
          for (const c of defined) lines.push(`fig.dashed_curve(${c.f}, ${c.df}, ${n4(c.a)}, ${n4(c.b)}, ${c.n})`)
        } else if (it.type === 'curve') {
          const c = defined[0]
          lines.push(`fig.curve(${c.f}, ${c.df}, ${n4(c.a)}, ${n4(c.b)}, ${c.n}, ${width(style, true)})`)
        } else {
          lines.push(`fig.piecewise([${defined.map((c) => `[${c.f}, ${c.df}, ${n4(c.a)}, ${n4(c.b)}, ${c.n}]`).join(', ')}], ${width(style, true)})`)
        }
        return
      }
      case 'segment': {
        const [a, b] = [at(it.from), at(it.to)]
        if (it.arrow) lines.push(`fig.axis(${p(a)}, ${p(b)})${style === 'main' ? '  # 키트의 화살표는 0.35pt' : ''}`)
        else if (style === 'dashed') lines.push(`fig.dashed(${p(a)}, ${p(b)})`)
        else lines.push(`fig.line(${p(a)}, ${p(b)}, ${width(style, false)})`)
        return
      }
      case 'polygon': {
        const closed = it.closed !== false ? 'True' : 'False'
        lines.push(`fig.poly([${it.points.map((q) => p(at(q))).join(', ')}], ${width(style === 'dashed' ? 'aux' : style, false)}, closed=${closed}, dashed=${style === 'dashed' ? 'True' : 'False'})`)
        return
      }
      case 'circle':
      case 'arc': {
        const c = at(it.center)
        const r = num(it.radius)
        const [rx, ry] = [r * fr.ux, r * fr.uy]
        const dashed = style === 'dashed' ? 'True' : 'False'
        const w = width(style === 'dashed' ? 'aux' : style, false)
        if (it.type === 'circle' && Math.abs(rx - ry) < 1e-9) lines.push(`fig.circle(${p(c)}, ${n4(rx)}, ${w}, dashed=${dashed})`)
        else {
          let [t0, t1] = it.type === 'arc' ? [num(it.from_deg), num(it.to_deg)] : [0, 360]
          while (t1 <= t0) t1 += 360
          lines.push(`fig.ellipse(${p(c)}, ${n4(rx)}, ${n4(ry)}, ${w}, dashed=${dashed}, start=${n4(t0)}, end=${n4(t1)})`)
        }
        return
      }
      case 'dot':
        lines.push(`fig.dot(${p(at(it.at))}, ${it.open ? 'True' : 'False'})`)
        return
      case 'guide': {
        const [x, y] = checker.position(it.at, '')
        if (it.to !== 'y' && y !== 0) lines.push(`fig.dashed(G(${n4(x)}, ${n4(y)}), G(${n4(x)}, 0))`)
        if (it.to !== 'x' && x !== 0) lines.push(`fig.dashed(G(${n4(x)}, ${n4(y)}), G(0, ${n4(y)}))`)
        return
      }
      case 'shade':
      case 'shade_polygon':
        // every fill goes out once, as one path, below (see drawn.fills)
        return
      case 'callout':
        lines.push(`fig.callout(${p(at(it.from))}, ${p(at(it.to))}, ${n4(it.bend ?? 1.5)})`)
        return
      case 'same_length':
        lines.push(`fig.same_len(${p(at(it.from))}, ${p(at(it.to))}, ${it.side === 'right' ? -2.2 : 2.2})`)
        return
      case 'right_angle': {
        const v = at(it.vertex)
        const unit = (q: Pt): Pt => {
          const d: Pt = [q[0] - v[0], q[1] - v[1]]
          const l = Math.hypot(...d)
          return [d[0] / l, d[1] / l]
        }
        const [u, w] = [unit(at(it.a)), unit(at(it.b))]
        const s = 1.8
        lines.push(`fig.poly([${p([v[0] + u[0] * s, v[1] + u[1] * s])}, ${p([v[0] + (u[0] + w[0]) * s, v[1] + (u[1] + w[1]) * s])}, ${p([v[0] + w[0] * s, v[1] + w[1] * s])}])`)
        return
      }
      case 'angle': {
        const v = at(it.vertex)
        const angleTo = (q: Pt) => Math.atan2(q[1] - v[1], q[0] - v[0])
        const [ta, tb] = [angleTo(at(it.a)), angleTo(at(it.b))]
        let from = ta
        let sweep = (((tb - ta) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        if (sweep > Math.PI) {
          from = tb
          sweep = 2 * Math.PI - sweep
        }
        const deg = (t: number) => n4((t * 180) / Math.PI)
        lines.push(`fig.ellipse(${p(v)}, 3, 3, start=${deg(from)}, end=${deg(from + sweep)})`)
        return
      }
      default:
        // label, tick, point_names: placed below with the other labels
        return
    }
  }
  // All fills as one path, first so it lies under every line. fig.shade loses the lower curve's
  // first point (its right edge is not straight when the curves end apart), and separate fills
  // leave a seam where they meet.
  if (drawn.fills.length) {
    lines.push(rawCall(`\\fill[${GRAY_FILL}] ${drawn.fills.map(cmdsPath).join(' ')};`, '색칠 전체를 한 경로로(Aleph 화면과 같은 모양, 조각 사이 틈 없음)'))
  }
  spec.items.forEach(item)

  const labelLines: string[] = []
  const eq: string[] = [`# ${name} 그림 글자 (이름<TAB>수식). Aleph에서 만든 목록`]
  let free = 0
  for (const label of drawn.labels) {
    // an axis label moved off a curve is no longer at the kit's place, so it goes out as a free label
    if (label.kind === 'axis' && label.axis && label.ref && !label.moved) {
      const id = `${name}_${label.axis}`
      eq.push(`${id}\t$${label.tex}$`)
      labelLines.push(`fig.axis_label('${label.axis}', ${p(label.ref)}, '${id}')`)
    } else {
      free += 1
      const id = `${name}_L${String(free).padStart(2, '0')}`
      eq.push(`${id}\t$${label.tex}$`)
      labelLines.push(`fig.eq_label('${id}', ${p(label.anchor)}, '${label.align}')`)
    }
  }

  const script = [
    `# ${name}: Aleph에서 만든 그림 명세를 figlib_tikz.py 함수로 옮긴 그림 스크립트.`,
    '# 키트 폴더의 temp\\ 에 같은 이름의 .eq.txt 와 함께 두고 실행한다.',
    `#   py -3.12 scripts\\tikz\\run_tikz.py temp\\${name}.py --preview`,
    '# 글자 자리는 Aleph 화면(MathJax 글꼴)에서 정했다. 한컴 수식은 폭이 조금 달라 겹침 검사 결과를 다시 본다.',
    '# Aleph 화면은 곡선과 색칠을 view 범위에서 자르지만 키트는 자르지 않는다. 넘치면 구간을 줄인다.',
    'import math',
    '',
    'from figlib_tikz import W_AUX, W_MAIN, Fig',
    '',
    `fig = Fig(${n4(fr.W)}, ${n4(fr.H)})`,
    `fig.set_axes(${n4(fr.ox)}, ${n4(fr.oy)}, ${n4(fr.ux)}, ${n4(fr.uy)})`,
    'G, P = fig.G, fig.P',
    '',
    '',
    'def slope(f, x, a, b):',
    '    """도함수 대신 쓰는 수치 기울기. 구간 밖은 쓰지 않는다."""',
    '    h = 1e-6 * max(1.0, abs(x))',
    '    lo, hi = max(a, x - h), min(b, x + h)',
    '    return (f(hi) - f(lo)) / (hi - lo)',
    '',
    '',
    ...functions,
    '',
    ...lines,
    '',
    ...labelLines,
    '',
    `fig.save('${name}')`,
    '',
  ].join('\n')
  return { script, labels: `${eq.join('\n')}\n` }
}
