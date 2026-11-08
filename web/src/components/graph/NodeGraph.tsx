import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JobStage, QuestionError, SolutionIdea } from '../../api/types'
import { buildGraph, stageStates, WORLD, type Edge, type GNode, type NodeState } from './model'
import './graph.css'

// A control-room panel: dark ground, unlit wires laid thin, and light that
// travels a wire only when the stage it belongs to really finished. A node
// sends light on only after every wire into it has arrived.

type Pt = { x: number; y: number }
type Wire = { pts: number[]; cum: number[]; len: number; d: string }

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
  return { pts, cum, len, d: `M${p0.x} ${p0.y} C${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}` }
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

function portOut(n: GNode): Pt {
  return { x: n.x + n.w, y: n.y + n.h / 2 }
}
function portIn(n: GNode): Pt {
  return { x: n.x, y: n.y + n.h / 2 }
}

const GRAPH = buildGraph()
const BY_ID = Object.fromEntries(GRAPH.nodes.map((n) => [n.id, n]))
const WIRES: Record<string, Wire> = Object.fromEntries(GRAPH.edges.map((e) => [e.id, wire(portOut(BY_ID[e.from]), portIn(BY_ID[e.to]))]))
const IN_EDGES: Record<string, Edge[]> = {}
const OUT_EDGES: Record<string, Edge[]> = {}
for (const e of GRAPH.edges) {
  ;(IN_EDGES[e.to] ??= []).push(e)
  ;(OUT_EDGES[e.from] ??= []).push(e)
}

export function NodeGraph({ stage, idea, error, failedAt, durations }: { stage: JobStage; idea: Partial<SolutionIdea>; error: QuestionError | null; failedAt?: JobStage; durations: Partial<Record<string, number>> }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(1)
  const [arrivedAt, setArrivedAt] = useState<Record<string, number>>({})
  const [flash, setFlash] = useState<Record<string, number>>({})
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const fit = () => setScale(Math.max(0.58, Math.min(1, el.clientWidth / WORLD.w)))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  const stageSt = useMemo(() => stageStates(GRAPH.nodes, GRAPH.edges, stage, idea, error, failedAt), [stage, idea, error, failedAt])

  // Arrival-driven nodes: a chip is done when its wire arrived; the ring when every chip's wire arrived; the person when the ring's wire arrived.
  const states = useMemo(() => {
    const st: Record<string, NodeState> = { ...stageSt }
    for (const n of GRAPH.nodes) {
      if (!n.arrival || st[n.id] === 'blocked') continue
      const ins = IN_EDGES[n.id] ?? []
      const all = ins.length > 0 && ins.every((e) => arrivedAt[e.id] !== undefined)
      const some = ins.some((e) => arrivedAt[e.id] !== undefined)
      st[n.id] = all ? 'done' : some ? 'running' : 'pending'
    }
    return st
  }, [stageSt, arrivedAt])

  // Light bookkeeping lives in refs; the draw loop reads them every frame.
  const lit = useRef<Record<string, number>>({})
  const travel = useRef<Map<string, { start: number; dur: number }>>(new Map())
  const started = useRef<Set<string>>(new Set())
  const arrivedRef = useRef<Record<string, number>>({})
  const statesRef = useRef(states)
  statesRef.current = states

  // Start wires whose source is done and fully fed.
  useEffect(() => {
    const now = performance.now()
    for (const e of GRAPH.edges) {
      if (started.current.has(e.id)) continue
      const from = states[e.from]
      if (from !== 'done') continue
      const fed = (IN_EDGES[e.from] ?? []).every((x) => arrivedRef.current[x.id] !== undefined)
      if (!fed) continue
      if (states[e.to] === 'blocked' || states[e.to] === 'failed') continue
      started.current.add(e.id)
      const g = WIRES[e.id]
      if (reduce) {
        lit.current[e.id] = now
        arrivedRef.current[e.id] = now
        setArrivedAt((a) => ({ ...a, [e.id]: now }))
      } else {
        travel.current.set(e.id, { start: now + 60 + e.delay, dur: Math.min(950, Math.max(380, (g.len / 760) * 1000)) })
      }
    }
  }, [states, reduce])

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = WORLD.w * dpr
    cv.height = WORLD.h * dpr
    const css = (name: string) => getComputedStyle(root.current ?? document.documentElement).getPropertyValue(name).trim()
    let raf = 0
    let lastPulse = performance.now()
    const pulses: { id: string; start: number; dur: number }[] = []
    const draw = () => {
      const now = performance.now()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, WORLD.w, WORLD.h)
      const light = css('--g-light') || '#8ab8ff'
      const white = css('--g-white') || '#f4f3fa'
      ctx.lineCap = 'round'
      ctx.globalCompositeOperation = 'lighter'

      // lit wires cool into afterglow
      for (const [id, at] of Object.entries(lit.current)) {
        const g = WIRES[id]
        const k = 0.16 + 0.84 * Math.exp(-((now - at) / 1900))
        ctx.strokeStyle = light
        ctx.globalAlpha = 0.22 * k + 0.06
        ctx.lineWidth = 6
        tracePart(ctx, g, 0, g.len)
        ctx.stroke()
        ctx.globalAlpha = 0.35 + 0.55 * k
        ctx.lineWidth = 1.6
        tracePart(ctx, g, 0, g.len)
        ctx.stroke()
      }

      // travelling light
      const newly: string[] = []
      travel.current.forEach((t, id) => {
        const g = WIRES[id]
        const p = (now - t.start) / t.dur
        if (p < 0) return
        const s = g.len * easeInOut(Math.min(1, p))
        ctx.strokeStyle = light
        ctx.globalAlpha = 0.22
        ctx.lineWidth = 6
        tracePart(ctx, g, 0, s)
        ctx.stroke()
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 1.6
        tracePart(ctx, g, 0, s)
        ctx.stroke()
        const tail = Math.max(0, s - 120)
        const a = pointAt(g, tail)
        const b = pointAt(g, s)
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        grad.addColorStop(0, 'rgba(0,0,0,0)')
        grad.addColorStop(1, light)
        ctx.strokeStyle = grad
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 3
        tracePart(ctx, g, tail, s)
        ctx.stroke()
        const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 10)
        rg.addColorStop(0, white)
        rg.addColorStop(0.4, light)
        rg.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 1
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(b.x, b.y, 10, 0, Math.PI * 2)
        ctx.fill()
        if (p >= 1) {
          travel.current.delete(id)
          lit.current[id] = now
          arrivedRef.current[id] = now
          newly.push(id)
        }
      })
      if (newly.length) {
        setArrivedAt((a) => ({ ...a, ...Object.fromEntries(newly.map((id) => [id, now])) }))
        setFlash((f) => ({ ...f, ...Object.fromEntries(newly.map((id) => [GRAPH.edges.find((e) => e.id === id)!.to, now])) }))
      }

      // a quiet pulse every few seconds along lit wires: the connection is alive, nothing more
      if (!reduce && now - lastPulse > 4200 && Object.keys(lit.current).length) {
        lastPulse = now
        Object.keys(lit.current).forEach((id, i) => {
          if (!travel.current.has(id)) pulses.push({ id, start: now + (i % 7) * 90, dur: Math.min(900, Math.max(400, (WIRES[id].len / 760) * 1000)) })
        })
      }
      for (let k = pulses.length - 1; k >= 0; k--) {
        const pu = pulses[k]
        const g = WIRES[pu.id]
        const p = (now - pu.start) / pu.dur
        if (p >= 1) {
          pulses.splice(k, 1)
          continue
        }
        if (p < 0) continue
        const hp = pointAt(g, g.len * easeInOut(p))
        const rg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 5)
        rg.addColorStop(0, white)
        rg.addColorStop(0.5, light)
        rg.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 0.45
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [reduce])

  const chips = GRAPH.nodes.filter((n) => n.kind === 'chip')
  const chipsDone = chips.filter((c) => states[c.id] === 'done').length
  const fmt = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}초`)
  const ideaText = (n: GNode) =>
    n.ideaKey === 'concept' ? idea.concept : n.ideaKey === 'e1' ? idea.key_elements?.[0] : n.ideaKey === 'e2' ? idea.key_elements?.[1] : n.ideaKey === 'mechanism' ? idea.mechanism : undefined

  return (
    <div className="g" ref={root} role="img" aria-label="입력에서 사용 승인까지의 작업 그래프. 빛은 실제로 끝난 단계의 전선만 따라 흐릅니다.">
      <div className="g__fit" style={{ height: WORLD.h * scale }}>
        <div className="g__world" style={{ width: WORLD.w, height: WORLD.h, transform: `scale(${scale})` }}>
          <svg className="g__wires" width={WORLD.w} height={WORLD.h} viewBox={`0 0 ${WORLD.w} ${WORLD.h}`} aria-hidden="true">
            {GRAPH.edges.map((e) => (
              <path key={e.id} d={WIRES[e.id].d} data-off={states[e.to] === 'blocked' || states[e.from] === 'failed' || states[e.from] === 'blocked' || undefined} />
            ))}
          </svg>
          <canvas ref={canvas} className="g__light" style={{ width: WORLD.w, height: WORLD.h }} aria-hidden="true" />

          {GRAPH.groups.map((g) => (
            <div key={g.id} className="g__group" style={{ left: g.x, top: g.y, width: g.w, height: g.h, ['--gc' as string]: g.color }}>
              <span className="g__group-name">{g.name}</span>
              <span className="g__group-n">{GRAPH.nodes.filter((n) => n.group === g.id).length}노드</span>
            </div>
          ))}

          {GRAPH.nodes.map((n) => {
            const s = states[n.id]
            const style = { left: n.x, top: n.y, width: n.w, height: n.h }
            const fl = flash[n.id]
            if (n.kind === 'pill') return <span key={n.id} className="g__pill" data-state={s} style={style}>{n.name}</span>
            if (n.kind === 'hub')
              return (
                <span key={n.id} className="g__hub" data-state={s} style={style}>
                  {n.name}
                </span>
              )
            if (n.kind === 'chip')
              return (
                <span key={n.id} className="g__chip" data-state={s} data-flash={fl} style={style} title={`후보 ${n.sub?.slice(-1)} ${n.name.split('·')[1]}`}>
                  {n.name}
                </span>
              )
            if (n.kind === 'ring')
              return (
                <span key={n.id} className="g__ring" data-state={s} data-flash={fl} style={style}>
                  <span className="g__ring-n num">
                    {chipsDone}/{chips.length}
                  </span>
                  <span className="g__ring-k">검토 항목</span>
                </span>
              )
            if (n.kind === 'person')
              return (
                <span key={n.id} className="g__person" data-state={s} style={style}>
                  <span className="g__role" data-role="사람">
                    사람
                  </span>
                  {n.name}
                </span>
              )
            const gc = GRAPH.groups.find((g) => g.id === n.group)?.color
            const found = ideaText(n)
            const dur = n.stage ? durations[n.stage] : undefined
            return (
              <div key={n.id} className="g__card" data-state={s} data-flash={fl} style={{ ...style, ['--gc' as string]: gc }}>
                <span className="g__port g__port--in" aria-hidden="true" />
                <span className="g__port g__port--out" aria-hidden="true" />
                <div className="g__card-top">
                  <span className="g__sq" aria-hidden="true" />
                  <span className="g__card-name">{n.name}</span>
                  <span className="g__role" data-role={n.role}>
                    {n.role}
                  </span>
                </div>
                <div className="g__card-mid">
                  <span className="g__engine">{n.engine}</span>
                  <span className="g__status" data-state={s}>
                    {s === 'pending' && '대기'}
                    {s === 'running' && '실행 중'}
                    {s === 'done' && (dur !== undefined && !n.ideaKey ? `통과 ${fmt(dur)}` : '통과')}
                    {s === 'failed' && '실패'}
                    {s === 'blocked' && '막힘'}
                  </span>
                </div>
                <span className="g__card-sub" data-found={found ? '' : undefined}>
                  {found ?? n.sub}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
