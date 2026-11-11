// Progress estimate for the job screen. A request is five steps in a row; candidates run in
// parallel inside a step, so each step counts once. Finished calls set the bar; a running call
// creeps toward its expected time and stops short until it really ends.

import type { CallKind, JobEvent, JobStage } from '../api/types'

/** Seconds per step in real runs (2026-11-07, gpt-6-astra, 3 candidates). */
export const EXPECTED: Record<CallKind, number> = { extract: 8, design: 125, generate: 14, solve: 12, review: 18 }
const KINDS = Object.keys(EXPECTED) as CallKind[]
/** Candidates run three at a time, so more than three means another round of a step. */
const WORKERS = 3
/** One design call covers every plan: 75 s for one, about 125 s for three, about 170 s for five (2026-11-10). */
const designSeconds = (candidates: number) => 50 + 25 * candidates

/** Without call events (server mode) each stage covers the steps inside it. */
const STAGE_KINDS: Partial<Record<JobStage, CallKind[]>> = { extract: ['extract'], generate: ['design', 'generate'], review: ['solve', 'review'] }
const STAGE_ORDER: JobStage[] = ['read', 'extract', 'validate', 'generate', 'review']

export interface Mark {
  at: number
  event: JobEvent
}

export interface Progress {
  /** 0..1 */
  fraction: number
  /** What is running now, in words. */
  label: string
  elapsedSeconds: number
  /** Rough seconds left; null once the estimate is spent. */
  remainingSeconds: number | null
}

/** Linear up to 90% at the expected time, then a slow creep toward 98%. */
export function creep(elapsed: number, expected: number) {
  const f = Math.max(0, elapsed) / expected
  return f <= 0.9 ? f : 0.9 + 0.08 * (1 - Math.exp(-(f - 0.9) * 2))
}

const LABEL: Record<CallKind, string> = {
  extract: '풀이 요소 찾는 중',
  design: '후보 방향 설계 중 · 가장 오래 걸리는 단계입니다',
  generate: '후보 문항 쓰는 중',
  solve: '후보를 독립적으로 풀어 보는 중',
  review: '후보 검토 중',
}

function byCalls(marks: Mark[], now: number, candidates: number) {
  const done = new Map<CallKind, number>()
  const running = new Map<CallKind, number[]>()
  for (const { at, event } of marks) {
    if (!event.call) continue
    const { kind, phase } = event.call
    const starts = running.get(kind) ?? []
    if (phase === 'start') starts.push(at)
    else {
      starts.shift()
      done.set(kind, (done.get(kind) ?? 0) + 1)
    }
    running.set(kind, starts)
  }
  let worth = 0
  let left = 0
  let current: CallKind | null = null
  for (const kind of KINDS) {
    const single = kind === 'extract' || kind === 'design'
    const needed = single ? 1 : candidates
    const oneCall = kind === 'design' ? designSeconds(candidates) : EXPECTED[kind]
    const seconds = oneCall * (single ? 1 : Math.ceil(candidates / WORKERS))
    const starts = running.get(kind) ?? []
    const share = Math.min(1, ((done.get(kind) ?? 0) + starts.reduce((sum, at) => sum + creep((now - at) / 1000, oneCall), 0)) / needed)
    worth += seconds * share
    left += seconds * (1 - share)
    if (starts.length) current = kind
  }
  const finished = current ? Math.min(done.get(current) ?? 0, candidates) : 0
  const many = current !== null && current !== 'extract' && current !== 'design'
  const label = current ? `${LABEL[current]}${many ? ` · ${finished}/${candidates} 완료` : ''}` : '준비 중'
  return { worth, left, label }
}

function byStages(marks: Mark[], now: number) {
  const started = new Map<JobStage, number>()
  for (const { at, event } of marks) if (!started.has(event.stage)) started.set(event.stage, at)
  const reached = STAGE_ORDER.filter((stage) => started.has(stage))
  const current = reached[reached.length - 1] ?? 'read'
  let worth = 0
  let left = 0
  for (const stage of STAGE_ORDER) {
    const weight = (STAGE_KINDS[stage] ?? []).reduce((sum, kind) => sum + EXPECTED[kind], 0)
    if (!weight) continue
    const share = STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(current) ? 1
      : stage === current ? creep((now - started.get(stage)!) / 1000, weight) : 0
    worth += weight * share
    left += weight * (1 - share)
  }
  const label = current === 'read' ? '준비 중' : current === 'extract' ? LABEL.extract : current === 'validate' ? '구조 검증 중' : current === 'generate' ? '후보 설계·작성 중' : '후보 풀이·검토 중'
  return { worth, left, label }
}

export function estimate(marks: Mark[], now: number): Progress {
  const start = marks[0]?.at ?? now
  const elapsedSeconds = Math.max(0, Math.round((now - start) / 1000))
  const last = marks[marks.length - 1]?.event.stage
  if (last === 'done') return { fraction: 1, label: '완료', elapsedSeconds, remainingSeconds: 0 }
  const candidates = marks.find((m) => m.event.candidates)?.event.candidates ?? 3
  const { worth, left, label } = marks.some((m) => m.event.call) ? byCalls(marks, now, candidates) : byStages(marks, now)
  // a retry or a slow model can outrun the estimate; never claim more than 99% before done
  const fraction = Math.min(0.99, worth / (worth + left))
  return { fraction, label, elapsedSeconds, remainingSeconds: left >= 5 ? Math.round(left) : null }
}
