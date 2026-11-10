import type { JobStage, QuestionError, SolutionIdea } from '../../api/types'

// The job as a wired graph. Every node and branch here is a real part of the
// pipeline in docs/SPEC.md: three readings of the source, the four parts of
// a SolutionIdea, the six ordered checks of validate_solution_idea, the requested
// number of candidates generated in parallel (one per design plan, src/aleph/pipeline.py),
// two review axes, and the review items each candidate gets. Nothing is
// invented for the picture.

export type Kind = 'pill' | 'hub' | 'card' | 'chip' | 'ring' | 'person'
export type Role = 'AI' | '코드' | '사람'
export type NodeState = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

export interface GNode {
  id: string
  kind: Kind
  x: number
  y: number
  w: number
  h: number
  name: string
  role?: Role
  engine?: string
  sub?: string
  group?: string
  /** The stage whose events drive this node. */
  stage?: JobStage
  /** For extraction cards: the SolutionIdea field whose arrival completes it. */
  ideaKey?: 'concept' | 'e1' | 'e2' | 'mechanism'
  /** Chips and the ring complete when their wires arrive, not on a stage. */
  arrival?: boolean
}

export interface Group {
  id: string
  name: string
  color: string
  x: number
  y: number
  w: number
  h: number
}

export interface Edge {
  id: string
  from: string
  to: string
  /** Extra start delay in ms, for fans. */
  delay: number
}

const WORLD_W = 1480
const WORLD_H = 600
const CARD_W = 168
const CARD_H = 78
const CARD_GAP = 14
/** The candidate column is drawn for three; more cards make the panel taller. */
const BASE_SLOTS = 3
const CANDIDATE_NOTES = ['메커니즘을 응용한 문항과 풀이', '다른 응용의 문항과 풀이', '또 다른 응용의 문항과 풀이']

function card(id: string, x: number, y: number, name: string, role: Role, engine: string, sub: string, group: string, extra: Partial<GNode> = {}): GNode {
  return { id, kind: 'card', x, y, w: CARD_W, h: CARD_H, name, role, engine, sub, group, ...extra }
}

export function buildGraph(count: number) {
  const slots = Math.max(BASE_SLOTS, count)
  const extra = (slots - BASE_SLOTS) * (CARD_H + CARD_GAP)
  // the columns left of the candidates stay centred on the taller panel
  const dy = extra / 2
  const nodes: GNode[] = []
  const groups: Group[] = []
  const edges: Edge[] = []
  let e = 0
  const link = (from: string, to: string, delay = 0) => edges.push({ id: `e${e++}`, from, to, delay })

  // sources: what the request can carry (SPEC § 5 source_question)
  const sources = [
    ['src_pimg', '문항 이미지'],
    ['src_ptxt', '문항 텍스트'],
    ['src_eimg', '해설 이미지'],
    ['src_etxt', '해설 텍스트'],
    ['src_scope', '교육과정 범위'],
  ]
  sources.forEach(([id, name], i) => nodes.push({ id, kind: 'pill', x: 16, y: 150 + dy + i * 60, w: 104, h: 30, name }))

  // hub
  nodes.push({ id: 'hub', kind: 'hub', x: 176, y: 262 + dy, w: 96, h: 96, name: '원문' })
  sources.forEach(([id]) => link(id, 'hub'))

  // group: 읽기 (code)
  const gRead = { id: 'read', name: '읽기', color: 'var(--g-teal)', x: 316, y: 128 + dy, w: CARD_W + 32, h: 3 * CARD_H + 2 * 14 + 52 }
  groups.push(gRead)
  const readCards = [
    card('rd_formula', gRead.x + 16, gRead.y + 40, '수식 판독', '코드', 'OCR·KaTeX', '이미지 속 수식을 텍스트로', 'read', { stage: 'read' }),
    card('rd_match', gRead.x + 16, gRead.y + 40 + CARD_H + 14, '텍스트 대조', '코드', '코드', '이미지와 텍스트의 조건 충돌 확인', 'read', { stage: 'read' }),
    card('rd_cond', gRead.x + 16, gRead.y + 40 + 2 * (CARD_H + 14), '조건 분리', '코드', '코드', '문항과 해설의 조건 추리기', 'read', { stage: 'read' }),
  ]
  nodes.push(...readCards)
  readCards.forEach((c, i) => link('hub', c.id, i * 90))

  // group: 풀이 요소 추출 (AI) — the four fields of SolutionIdea
  const gEx = { id: 'extract', name: '풀이 요소 추출', color: 'var(--g-violet)', x: 548, y: 60 + dy, w: CARD_W + 32, h: 4 * CARD_H + 3 * 14 + 52 }
  groups.push(gEx)
  const exCards = [
    card('ex_concept', gEx.x + 16, gEx.y + 40, '개념', 'AI', 'LLM 파서', '중심 수학 개념 하나', 'extract', { stage: 'extract', ideaKey: 'concept' }),
    card('ex_e1', gEx.x + 16, gEx.y + 40 + (CARD_H + 14), '요소 1', 'AI', 'LLM 파서', '해설에 근거한 첫 풀이 요소', 'extract', { stage: 'extract', ideaKey: 'e1' }),
    card('ex_e2', gEx.x + 16, gEx.y + 40 + 2 * (CARD_H + 14), '요소 2', 'AI', 'LLM 파서', '첫 요소와 구별되는 둘째 요소', 'extract', { stage: 'extract', ideaKey: 'e2' }),
    card('ex_mech', gEx.x + 16, gEx.y + 40 + 3 * (CARD_H + 14), '메커니즘', 'AI', 'LLM 파서', '두 요소가 결론에 이르는 방식', 'extract', { stage: 'extract', ideaKey: 'mechanism' }),
  ]
  nodes.push(...exCards)
  link('rd_formula', 'ex_concept')
  link('rd_match', 'ex_e1', 60)
  link('rd_match', 'ex_e2', 120)
  link('rd_cond', 'ex_mech', 60)
  link('rd_cond', 'ex_e2', 180)

  // group: 구조 검증 (code) — validate_solution_idea, six ordered checks
  const gVal = { id: 'validate', name: '구조 검증', color: 'var(--g-gold)', x: 780, y: 230 + dy, w: CARD_W + 32, h: CARD_H + 52 + 28 }
  groups.push(gVal)
  nodes.push(card('val', gVal.x + 16, gVal.y + 40, 'validate_solution_idea', '코드', 'aleph.validation', 'JSON, 스키마, 빈 문자열, 비교 근거, 요소 2개, 메커니즘', 'validate', { stage: 'validate', h: CARD_H + 28 }))
  exCards.forEach((c, i) => link(c.id, 'val', i * 70))

  // group: 후보 생성 (AI), one card per candidate, in parallel; fewer than three sit centred
  const gGen = { id: 'generate', name: '후보 생성', color: 'var(--g-pink)', x: 1012, y: 40, w: CARD_W + 32, h: slots * CARD_H + (slots - 1) * CARD_GAP + 52 }
  groups.push(gGen)
  const firstCard = gGen.y + 40 + ((slots - count) * (CARD_H + CARD_GAP)) / 2
  const genCards = Array.from({ length: count }, (_, i) =>
    card(`gen_${i + 1}`, gGen.x + 16, firstCard + i * (CARD_H + CARD_GAP), `후보 ${i + 1}`, 'AI', 'LLM 생성', CANDIDATE_NOTES[Math.min(i, CANDIDATE_NOTES.length - 1)], 'generate', { stage: 'generate' }),
  )
  nodes.push(...genCards)
  genCards.forEach((c, i) => link('val', c.id, i * 120))
  link('src_scope', 'gen_1', 200)

  // group: 잠정 검토 (AI), two axes
  const gRev = { id: 'review', name: '잠정 검토', color: 'var(--g-orange)', x: 1012, y: 372 + extra, w: CARD_W + 32, h: 2 * CARD_H + 14 + 52 }
  groups.push(gRev)
  const revCards = [
    card('rev_valid', gRev.x + 16, gRev.y + 40, '수학적 성립', 'AI', 'LLM 검토', '조건 누락, 경계값, 정의역', 'review', { stage: 'review' }),
    card('rev_curr', gRev.x + 16, gRev.y + 40 + CARD_H + 14, '교육과정', 'AI', 'LLM 검토', '허용 범위 안인지', 'review', { stage: 'review' }),
  ]
  nodes.push(...revCards)
  genCards.forEach((g, i) => revCards.forEach((r, j) => link(g.id, r.id, i * 80 + j * 40)))

  // chips: the review items each candidate receives (AC3, AC4, AC5)
  const items = ['조건 누락', '경계값', '정의역', '수학적 성립', '교육과정', '메커니즘 응용']
  const chipX = 1244
  const chipW = 68
  const chipH = 22
  let k = 0
  genCards.forEach((_, index) => {
    const cand = index + 1
    items.forEach((it, j) => {
      const col = k % 3
      const row = Math.floor(k / 3)
      nodes.push({ id: `chip_${cand}_${j}`, kind: 'chip', x: chipX + col * (chipW + 6), y: 60 + row * (chipH + 8), w: chipW, h: chipH, name: `${cand}·${it}`, sub: `후보 ${cand}`, arrival: true })
      const from = j === 4 ? 'rev_curr' : 'rev_valid'
      link(from, `chip_${cand}_${j}`, k * 70)
      k++
    })
  })

  // completion ring and the person
  nodes.push({ id: 'ring', kind: 'ring', x: 1294, y: 420 + extra, w: 120, h: 120, name: '잠정 검토', arrival: true })
  nodes.filter((n) => n.kind === 'chip').forEach((c, i) => link(c.id, 'ring', i * 40))
  nodes.push({ id: 'person', kind: 'person', x: 1244, y: 556 + extra, w: 220, h: 30, name: '사용 승인은 강사가, 다음 화면에서', role: '사람', arrival: true })
  link('ring', 'person')

  return { nodes, groups, edges, world: { w: WORLD_W, h: WORLD_H + extra } }
}

const ORDER: JobStage[] = ['read', 'extract', 'validate', 'generate', 'review', 'done']

export const STAGE_NAME: Partial<Record<JobStage, string>> = { read: '읽기', extract: '풀이 요소 추출', validate: '구조 검증', generate: '후보 생성', review: '잠정 검토' }

/** Where the job stopped: reading for unreadable input, else the stage it was in when it failed. */
export function failedStage(error: QuestionError, at?: JobStage): JobStage {
  if (error.error_code === 'UNREADABLE_INPUT' || error.error_code === 'INPUT_CONFLICT') return 'read'
  return at === 'validate' || at === 'generate' || at === 'review' ? at : 'extract'
}

export function failedIds(error: QuestionError, nodes: GNode[], at?: JobStage): string[] {
  const stage = failedStage(error, at)
  if (stage === 'read') return ['rd_formula', 'rd_match']
  if (stage === 'validate') return ['val']
  if (stage === 'generate') return nodes.filter((n) => n.group === 'generate').map((n) => n.id)
  if (stage === 'review') return ['rev_valid', 'rev_curr']
  if (error.error_code === 'MISSING_MECHANISM') return ['ex_mech']
  if (error.error_code === 'MISSING_ELEMENTS') return ['ex_e2']
  return ['ex_concept', 'ex_e1', 'ex_e2', 'ex_mech']
}

/** Stage-driven states. Arrival-driven nodes (chips, ring, person) are decided by the renderer. */
export function stageStates(nodes: GNode[], edges: Edge[], stage: JobStage, idea: Partial<SolutionIdea>, error: QuestionError | null, failedAt?: JobStage): Record<string, NodeState> {
  const st: Record<string, NodeState> = {}
  const idx = ORDER.indexOf(stage)
  for (const n of nodes) {
    if (n.kind === 'pill' || n.kind === 'hub') st[n.id] = 'done'
    else if (n.arrival) st[n.id] = 'pending'
    else if (n.stage) {
      const k = ORDER.indexOf(n.stage)
      if (k < idx) st[n.id] = 'done'
      else if (k === idx) {
        st[n.id] = 'running'
        if (n.ideaKey) {
          const have =
            n.ideaKey === 'concept' ? !!idea.concept : n.ideaKey === 'e1' ? !!idea.key_elements?.[0] : n.ideaKey === 'e2' ? !!idea.key_elements?.[1] : !!idea.mechanism
          if (have) st[n.id] = 'done'
        }
      } else st[n.id] = 'pending'
    } else st[n.id] = 'pending'
  }
  if (error) {
    const failed = new Set(failedIds(error, nodes, failedAt))
    // everything downstream of a failed node is blocked
    const down = new Set<string>()
    const walk = (id: string) => edges.filter((e) => e.from === id).forEach((e) => (down.has(e.to) ? null : (down.add(e.to), walk(e.to))))
    failed.forEach(walk)
    for (const n of nodes) {
      if (failed.has(n.id)) st[n.id] = 'failed'
      else if (down.has(n.id)) st[n.id] = 'blocked'
      else if (st[n.id] === 'running') st[n.id] = 'done'
    }
  }
  return st
}
