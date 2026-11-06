import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, createTimeline, svg, utils } from 'animejs'
import { RotateCcw } from 'lucide-react'
import { MathText } from './Math'

// The problem as the picture. One typeset problem at display size; the two
// key elements get a drawn underline, an arc ties them (the mechanism), the
// candidate appears beneath, and the provisional verdict is pressed on like a
// reviewer's seal. One orchestrated moment on load, then it holds.

type Geo = {
  u1: string
  u2: string
  arc: string
  arcMid: { x: number; y: number }
  w: number
  h: number
}

function wobble(x1: number, x2: number, y: number) {
  // A slightly hand-drawn underline: two gentle bends across the span
  const third = (x2 - x1) / 3
  return `M${x1} ${y} C${x1 + third} ${y + 1.5}, ${x1 + third} ${y - 1}, ${x1 + 2 * third} ${y + 0.5} S${x2 - 4} ${y - 1.2}, ${x2} ${y}`
}

export function ProblemArt() {
  const root = useRef<HTMLDivElement>(null)
  const e1 = useRef<HTMLSpanElement>(null)
  const e2 = useRef<HTMLSpanElement>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  const [run, setRun] = useState(0)
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const measure = useCallback(() => {
    const r = root.current
    const a = e1.current
    const b = e2.current
    if (!r || !a || !b) return
    const R = r.getBoundingClientRect()
    const rects = (el: HTMLElement) => Array.from(el.getClientRects())
    const A = rects(a)
    const B = rects(b)
    if (!A.length || !B.length) return
    // underline the last line box of each element (they are short, one line each)
    const la = A[A.length - 1]
    const lb = B[B.length - 1]
    const y1 = la.bottom - R.top + 3
    const y2 = lb.bottom - R.top + 3
    const x1a = la.left - R.left
    const x1b = la.right - R.left
    const x2a = lb.left - R.left
    const x2b = lb.right - R.left
    // the mechanism: a bracket in the left margin from the first underline to the second
    const bulge = 26
    const p1 = { x: x1a - 4, y: y1 }
    const p2 = { x: x2a - 4, y: y2 }
    const arc = `M${p1.x} ${p1.y} C${p1.x - bulge} ${p1.y}, ${p2.x - bulge} ${p2.y}, ${p2.x} ${p2.y}`
    setGeo({ u1: wobble(x1a, x1b, y1), u2: wobble(x2a, x2b, y2), arc, arcMid: { x: Math.min(p1.x, p2.x) - bulge, y: (p1.y + p2.y) / 2 }, w: R.width, h: R.height })
  }, [])

  useLayoutEffect(() => {
    let alive = true
    const go = () => alive && measure()
    if (document.fonts?.ready) document.fonts.ready.then(go)
    else go()
    const ro = new ResizeObserver(go)
    if (root.current) ro.observe(root.current)
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [measure])

  // Play once the geometry exists; a later re-measure (resize) redraws the
  // paths without restarting the moment. Replay is explicit.
  const ready = geo !== null
  useEffect(() => {
    const r = root.current
    if (!r || !ready) return
    const lines = r.querySelectorAll<SVGPathElement>('[data-draw]')
    const labels = r.querySelectorAll<HTMLElement>('[data-step]')
    const stamp = r.querySelector<HTMLElement>('.art__stamp')
    if (!lines.length || !stamp) return
    if (reduce) {
      utils.set(lines, { opacity: 1 })
      utils.set(labels, { opacity: 1, translateY: 0 })
      utils.set(stamp, { opacity: 0.92, scale: 1, rotate: -9 })
      return
    }
    utils.set(lines, { opacity: 1 })
    utils.set(labels, { opacity: 0, translateY: 6 })
    utils.set(stamp, { opacity: 0, scale: 1.45, rotate: -14 })
    const [u1, u2, arc] = Array.from(lines)
    const drawable = (p: SVGPathElement) => svg.createDrawable(p)
    const tl = createTimeline({ defaults: { ease: 'outQuart' } })
    tl.add(drawable(u1), { draw: ['0 0', '0 1'], duration: 520 }, 500)
      .add(labels[0], { opacity: [0, 1], translateY: [6, 0], duration: 420 }, 700)
      .add(drawable(u2), { draw: ['0 0', '0 1'], duration: 520 }, 1050)
      .add(labels[1], { opacity: [0, 1], translateY: [6, 0], duration: 420 }, 1250)
      .add(drawable(arc), { draw: ['0 0', '0 1'], duration: 760, ease: 'inOutSine' }, 1550)
      .add(labels[2], { opacity: [0, 1], translateY: [6, 0], duration: 420 }, 2000)
      .add(labels[3], { opacity: [0, 1], translateY: [8, 0], duration: 520 }, 2450)
      .add(stamp, { opacity: [0, 0.92], scale: [1.45, 1], rotate: [-14, -9], duration: 480, ease: 'outExpo' }, 2950)
    return () => {
      tl.pause()
    }
  }, [ready, run, reduce])

  return (
    <div className="art" ref={root} aria-label="원문 한 문항에서 두 풀이 요소와 메커니즘을 찾아 후보 문항을 만든 모습">
      <p className="art__statement">
        함수 <MathText as="span" text="$f(x)$" />의 도함수가{' '}
        <span className="art__el" ref={e1}>
          <MathText as="span" text="$f'(x) = 3 - 3x^2$" />
        </span>{' '}
        이고{' '}
        <span className="art__el" ref={e2}>
          <MathText as="span" text="$f(0) = 2$" />
        </span>{' '}
        일 때, 함수 <MathText as="span" text="$f(x)$" />의 극댓값을 구하시오.
      </p>

      {geo && (
        <svg className="art__svg" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
          <path data-draw d={geo.u1} />
          <path data-draw d={geo.u2} />
          <path data-draw d={geo.arc} className="art__arc" />
        </svg>
      )}

      <div className="art__notes">
        <span data-step="0">요소 1. 도함수의 부호 변화로 극대 위치를 정한다</span>
        <span data-step="1">요소 2. 적분과 초기값으로 원함수를 복원한다</span>
        <span data-step="2" className="art__mech">메커니즘. 부호 변화로 위치를 정한 뒤, 적분으로 그 값을 구한다</span>
      </div>

      <div className="art__candidate" data-step="3">
        <span className="art__candidate-k">후보</span>
        <MathText as="span" text="함수 $f(x)$에 대하여 $f'(x) = x^2 - 4x + 3$ 이고 $f(1) = 5$ 일 때, 함수 $f(x)$의 극솟값을 구하시오." />
        <span className="art__stamp" role="img" aria-label="AI 잠정 판정: 사용 가능. 최종 승인은 강사가 합니다.">
          <span>사용 가능</span>
          <small>AI 잠정 판정</small>
        </span>
      </div>

      {!reduce && (
        <button type="button" className="art__replay" onClick={() => setRun((n) => n + 1)} aria-label="다시 보기">
          <RotateCcw aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
