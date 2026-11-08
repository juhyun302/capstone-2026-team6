import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JobStage, QuestionError } from '../api/types'

// The job as a node graph. Seven nodes across, zigzagged, wired left to right.
// Each node names who does the work (AI, code, a person). When a stage ends,
// ink light travels the wire to the next node and that node lights up; wires
// already travelled stay lit. A failure turns its node red, switches the wires
// after it off and dims what they fed. Nothing advances without a real event.

export type Role = 'AI' | '코드' | '사람'
export type NodeState = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

export interface GraphNode {
  id: string
  name: string
  role: Role
  detail: string
  stage?: JobStage
}

export const JOB_NODES: GraphNode[] = [
  { id: 'input', name: '입력', role: '코드', detail: '이미지 또는 수식·텍스트' },
  { id: 'read', name: '읽기', role: '코드', detail: '문항·수식 판독, 텍스트와 대조', stage: 'read' },
  { id: 'extract', name: '풀이 요소 추출', role: 'AI', detail: '개념, 요소 2개, 메커니즘', stage: 'extract' },
  { id: 'validate', name: '구조 검증', role: '코드', detail: '스키마와 필수 값 검사', stage: 'validate' },
  { id: 'generate', name: '후보 생성', role: 'AI', detail: '메커니즘을 응용한 새 문항', stage: 'generate' },
  { id: 'review', name: '잠정 검토', role: 'AI', detail: '성립·경계·교육과정', stage: 'review' },
  { id: 'approve', name: '사용 승인', role: '사람', detail: '검토 결과 화면에서' },
]

const ORDER: JobStage[] = ['read', 'extract', 'validate', 'generate', 'review', 'done']

/** The node that stopped: reading for unreadable input, else the stage the job was in when it failed. */
export function failedNodeIndex(error: QuestionError, at?: JobStage) {
  if (error.error_code === 'UNREADABLE_INPUT' || error.error_code === 'INPUT_CONFLICT') return 1
  const i = JOB_NODES.findIndex((node) => node.stage === at)
  return i >= 2 ? i : 2
}

export function nodeStates(stage: JobStage, error: QuestionError | null, failedAt?: JobStage): NodeState[] {
  const n = JOB_NODES.length
  if (error) {
    const f = failedNodeIndex(error, failedAt)
    return JOB_NODES.map((_, i) => (i < f ? 'done' : i === f ? 'failed' : 'blocked'))
  }
  const idx = ORDER.indexOf(stage)
  return JOB_NODES.map((node, i) => {
    if (i === 0) return 'done'
    if (i === n - 1) return stage === 'done' ? 'running' : 'pending'
    const k = ORDER.indexOf(node.stage!)
    return k < idx ? 'done' : k === idx ? 'running' : 'pending'
  })
}

type Pt = { x: number; y: number }
type Wire = { p0: Pt; c1: Pt; c2: Pt; p3: Pt; pts: number[]; cum: number[]; len: number }

const bez = (a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  }
}
function wire(p0: Pt, p3: Pt): Wire {
  const d = Math.max(40, Math.abs(p3.x - p0.x) * 0.5)
  const c1 = { x: p0.x + d, y: p0.y }
  const c2 = { x: p3.x - d, y: p3.y }
  const pts: number[] = []
  const cum: number[] = []
  let len = 0
  for (let i = 0; i <= 48; i++) {
    const p = bez(p0, c1, c2, p3, i / 48)
    if (i) len += Math.hypot(p.x - pts[pts.length - 2], p.y - pts[pts.length - 1])
    pts.push(p.x, p.y)
    cum.push(len)
  }
  return { p0, c1, c2, p3, pts, cum, len }
}
function pointAt(g: Wire, s: number): Pt {
  if (s <= 0) return { x: g.pts[0], y: g.pts[1] }
  if (s >= g.len) return { x: g.pts[g.pts.length - 2], y: g.pts[g.pts.length - 1] }
  let lo = 0
  let hi = g.cum.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (g.cum[m] < s) lo = m
    else hi = m
  }
  const f = (s - g.cum[lo]) / (g.cum[hi] - g.cum[lo] || 1)
  return { x: g.pts[lo * 2] + (g.pts[hi * 2] - g.pts[lo * 2]) * f, y: g.pts[lo * 2 + 1] + (g.pts[hi * 2 + 1] - g.pts[lo * 2 + 1]) * f }
}
function tracePart(ctx: CanvasRenderingContext2D, g: Wire, s0: number, s1: number) {
  const a = pointAt(g, s0)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  for (let i = 0; i < g.cum.length; i++) if (g.cum[i] > s0 && g.cum[i] < s1) ctx.lineTo(g.pts[i * 2], g.pts[i * 2 + 1])
  const b = pointAt(g, s1)
  ctx.lineTo(b.x, b.y)
}
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

const CARD_W = 124
const CARD_H = 92
const PAD = 24
const MIN_GAP = 30
const ZIG = 18

export function NodeGraph({ stage, error, failedAt, durations }: { stage: JobStage; error: QuestionError | null; failedAt?: JobStage; durations: Partial<Record<string, number>> }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [flash, setFlash] = useState<Record<number, number>>({})
  const states = useMemo(() => nodeStates(stage, error, failedAt), [stage, error, failedAt])
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Node rects from the container width
  const layout = useMemo(() => {
    const n = JOB_NODES.length
    const w = Math.max(size.w, PAD * 2 + n * CARD_W + (n - 1) * MIN_GAP)
    const gap = (w - PAD * 2 - n * CARD_W) / (n - 1)
    const h = CARD_H + ZIG * 2 + PAD * 2
    const rects = JOB_NODES.map((_, i) => ({ x: PAD + i * (CARD_W + gap), y: PAD + ZIG + (i % 2 ? ZIG : -ZIG), w: CARD_W, h: CARD_H }))
    const wires = rects.slice(0, -1).map((r, i) => wire({ x: r.x + r.w, y: r.y + r.h / 2 }, { x: rects[i + 1].x, y: rects[i + 1].y + rects[i + 1].h / 2 }))
    return { w, h, rects, wires }
  }, [size.w])

  // Light: which wires are lit, which are travelling
  const lit = useRef<boolean[]>([])
  const travel = useRef<Map<number, { start: number; dur: number }>>(new Map())
  const arrived = useRef<Map<number, number>>(new Map())
  const lastStates = useRef<NodeState[]>([])

  useEffect(() => {
    const now = performance.now()
    const prev = lastStates.current
    states.forEach((s, i) => {
      const wasDone = prev[i] === 'done'
      const onLeft = i < layout.wires.length
      if (s === 'done' && !wasDone && onLeft && !lit.current[i] && !travel.current.has(i)) {
        if (reduce) {
          lit.current[i] = true
          arrived.current.set(i, now)
        } else {
          const w = layout.wires[i]
          const dur = Math.min(950, Math.max(380, (w?.len ?? 300) / 760) * 1000)
          travel.current.set(i, { start: now + 60, dur })
        }
      }
      if (s === 'failed' || s === 'blocked') {
        if (onLeft) {
          lit.current[i] = false
          travel.current.delete(i)
        }
      }
    })
    lastStates.current = states
  }, [states, layout.wires, reduce])

  // Draw loop
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let raf = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const colorOf = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#005BAC'
    let lastPulse = performance.now()
    const draw = () => {
      const now = performance.now()
      const W = layout.w
      const H = layout.h
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr)
        cv.height = Math.round(H * dpr)
        cv.style.width = `${W}px`
        cv.style.height = `${H}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const accent = colorOf('--color-accent')
      const paper = colorOf('--color-paper')
      ctx.lineCap = 'round'
      ctx.globalCompositeOperation = 'source-over'

      // steady glow on lit wires, cooling from arrival
      layout.wires.forEach((g, i) => {
        if (!lit.current[i]) return
        const at = arrived.current.get(i) ?? now
        const cool = 0.5 + 0.5 * Math.exp(-((now - at) / 1900))
        ctx.globalAlpha = 0.16 * cool + 0.1
        ctx.strokeStyle = accent
        ctx.lineWidth = 7
        tracePart(ctx, g, 0, g.len)
        ctx.stroke()
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 1.6
        tracePart(ctx, g, 0, g.len)
        ctx.stroke()
      })

      // travelling heads
      const flashes: number[] = []
      travel.current.forEach((t, i) => {
        const g = layout.wires[i]
        if (!g) return
        const p = (now - t.start) / t.dur
        if (p < 0) return
        const s = g.len * easeInOut(Math.min(1, p))
        ctx.globalAlpha = 0.22
        ctx.strokeStyle = accent
        ctx.lineWidth = 7
        tracePart(ctx, g, 0, s)
        ctx.stroke()
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 1.6
        tracePart(ctx, g, 0, s)
        ctx.stroke()
        // tail
        const tail = Math.max(0, s - 120)
        const grad = ctx.createLinearGradient(pointAt(g, tail).x, pointAt(g, tail).y, pointAt(g, s).x, pointAt(g, s).y)
        grad.addColorStop(0, 'rgba(0,0,0,0)')
        grad.addColorStop(1, accent)
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = grad
        ctx.lineWidth = 3.2
        tracePart(ctx, g, tail, s)
        ctx.stroke()
        // head
        const hp = pointAt(g, s)
        ctx.globalAlpha = 1
        const rg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 10)
        rg.addColorStop(0, paper)
        rg.addColorStop(0.35, accent)
        rg.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(hp.x, hp.y, 10, 0, Math.PI * 2)
        ctx.fill()
        if (p >= 1) {
          travel.current.delete(i)
          lit.current[i] = true
          arrived.current.set(i, now)
          flashes.push(i + 1)
        }
      })
      if (flashes.length) setFlash((f) => ({ ...f, ...Object.fromEntries(flashes.map((i) => [i, now])) }))

      // a quiet pulse along lit wires every few seconds, so the connection reads as alive
      if (!reduce && now - lastPulse > 3800) {
        lastPulse = now
        layout.wires.forEach((g, i) => {
          if (lit.current[i] && !travel.current.has(i)) {
            const t0 = now + i * 120
            pulses.push({ i, start: t0, dur: Math.min(900, Math.max(400, (g.len / 760) * 1000)) })
          }
        })
      }
      for (let k = pulses.length - 1; k >= 0; k--) {
        const pu = pulses[k]
        const g = layout.wires[pu.i]
        const p = (now - pu.start) / pu.dur
        if (!g || p >= 1) {
          pulses.splice(k, 1)
          continue
        }
        if (p < 0) continue
        const s = g.len * easeInOut(p)
        const hp = pointAt(g, s)
        ctx.globalAlpha = 0.55
        const rg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 6)
        rg.addColorStop(0, paper)
        rg.addColorStop(0.5, accent)
        rg.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    const pulses: { i: number; start: number; dur: number }[] = []
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [layout, reduce])

  const fmt = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}초`)

  return (
    <div className="graph" ref={root} role="img" aria-label="입력부터 사용 승인까지 일곱 단계의 진행 그래프">
      <div className="graph__scroll">
        <div className="graph__world" style={{ width: layout.w, height: layout.h }}>
          <svg className="graph__wires" width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true">
            {layout.wires.map((g, i) => (
              <path key={i} d={`M${g.p0.x} ${g.p0.y} C${g.c1.x} ${g.c1.y}, ${g.c2.x} ${g.c2.y}, ${g.p3.x} ${g.p3.y}`} data-off={states[i + 1] === 'blocked' || states[i] === 'failed' || undefined} />
            ))}
          </svg>
          <canvas ref={canvas} className="graph__light" aria-hidden="true" />
          {JOB_NODES.map((node, i) => {
            const r = layout.rects[i]
            const s = states[i]
            const dur = node.stage ? durations[node.stage] : undefined
            return (
              <div key={node.id} className="gnode" data-state={s} data-flash={flash[i] ? flash[i] : undefined} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                <span className="gnode__port gnode__port--in" aria-hidden="true" />
                <span className="gnode__port gnode__port--out" aria-hidden="true" />
                <div className="gnode__top">
                  <span className="gnode__name">{node.name}</span>
                  <span className="gnode__role" data-role={node.role}>
                    {node.role}
                  </span>
                </div>
                <span className="gnode__detail">{node.detail}</span>
                <span className="gnode__status">
                  {s === 'pending' && '대기'}
                  {s === 'running' && (i === JOB_NODES.length - 1 ? '다음 화면에서' : '진행 중')}
                  {s === 'done' && (dur !== undefined ? `완료, ${fmt(dur)}` : '완료')}
                  {s === 'failed' && '중단'}
                  {s === 'blocked' && '막힘'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
