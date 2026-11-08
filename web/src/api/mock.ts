// A mock of the two logical calls in docs/SPEC.md § 5, with the progress
// events a server would stream (SSE/WebSocket). Swap this module for a real
// client; the screens only import the functions below.

import { sampleResult, SAMPLE_SOURCE } from './fixtures'
import { CURRICULUM_SCOPE } from './config'
import type { GenerationRequest, GenerationResult, JobEvent, QuestionError, ReviewResult, Verdict } from './types'

const STORE_KEY = 'aleph.mock.v1'

interface Store {
  jobs: Record<string, { request: SerializedRequest; result_id?: string; error?: QuestionError }>
  results: Record<string, GenerationResult>
}

type SerializedRequest = Omit<GenerationRequest, 'source_question'> & {
  source_question: {
    problem: { text?: string; imageName?: string }
    explanation: { text?: string; imageName?: string }
  }
}

function load(): Store {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    /* storage can be empty or blocked; start fresh */
  }
  return { jobs: {}, results: {} }
}

function save(store: Store) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    /* ignore */
  }
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

function serialize(req: GenerationRequest): SerializedRequest {
  const part = (p: GenerationRequest['source_question']['problem']) => ({
    text: p.text?.trim() || undefined,
    imageName: p.image?.name ?? p.imageName,
  })
  return {
    intended_use: req.intended_use,
    target_level: req.target_level,
    curriculum_scope: req.curriculum_scope,
    source_question: { problem: part(req.source_question.problem), explanation: part(req.source_question.explanation) },
  }
}

/** POST /api/requests → { jobId } */
export async function createJob(req: GenerationRequest): Promise<{ jobId: string }> {
  const store = load()
  const jobId = id('job')
  store.jobs[jobId] = { request: serialize(req) }
  save(store)
  await delay(240)
  return { jobId }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
const delay = (ms: number) => sleep(ms)

/**
 * GET /api/jobs/:id/events — the mock decides the outcome from the input the
 * way the real parser would: an explanation that shows only one solution
 * action yields QUESTION_ERROR (AC2); an unreadable image yields a request to
 * confirm (AC9). Everything else runs the recorded golden case.
 */
export async function* jobEvents(jobId: string, signal?: AbortSignal): AsyncGenerator<JobEvent> {
  const store = load()
  const job = store.jobs[jobId]
  if (!job) {
    yield { stage: 'error', error: { status: 'QUESTION_ERROR', error_code: 'UNREADABLE_INPUT', reason: '요청을 찾을 수 없습니다. 원문을 다시 올려 주세요.' } }
    return
  }
  if (job.result_id) {
    yield { stage: 'done', result_id: job.result_id }
    return
  }
  if (job.error) {
    yield { stage: 'error', error: job.error }
    return
  }

  const expl = job.request.source_question.explanation
  const prob = job.request.source_question.problem
  const unreadable = [prob.imageName, expl.imageName].some((n) => n && /blur|흐림|low/i.test(n))
  const thin = !expl.imageName && (expl.text?.length ?? 0) > 0 && (expl.text?.length ?? 0) < 40

  yield { stage: 'read' }
  await sleep(900, signal)

  if (unreadable) {
    const error: QuestionError = {
      status: 'QUESTION_ERROR',
      error_code: 'UNREADABLE_INPUT',
      reason: '올린 이미지의 수식을 읽을 수 없습니다. 수식을 추측하지 않고 멈췄습니다.',
      needs_confirmation: ['도함수 식의 둘째 항 계수', '초기값 조건의 좌변이 f(0)인지 f(1)인지'],
    }
    job.error = error
    save(store)
    yield { stage: 'error', error }
    return
  }

  yield { stage: 'extract', solution_idea: { concept: '도함수 부호 변화와 극값' } }
  await sleep(700, signal)

  if (thin) {
    const error: QuestionError = {
      status: 'QUESTION_ERROR',
      error_code: 'MISSING_ELEMENTS',
      reason: '해설에서 근거 있는 핵심 풀이 요소를 하나만 확인했습니다. 서로 다른 두 요소가 없어 후보를 만들지 않았습니다.',
    }
    job.error = error
    save(store)
    yield { stage: 'error', error }
    return
  }

  const idea = sampleResult('tmp').solution_idea
  yield { stage: 'extract', solution_idea: { concept: idea.concept, key_elements: [idea.key_elements![0], ''] as [string, string] } }
  await sleep(700, signal)
  yield { stage: 'extract', solution_idea: { concept: idea.concept, key_elements: idea.key_elements } }
  await sleep(600, signal)
  yield { stage: 'extract', solution_idea: idea }
  await sleep(500, signal)
  yield { stage: 'validate', solution_idea: idea }
  await sleep(700, signal)
  yield { stage: 'generate', solution_idea: idea }
  await sleep(2600, signal)
  yield { stage: 'review', solution_idea: idea }
  await sleep(1800, signal)

  const resultId = id('res')
  const result = sampleResult(resultId, {
    intended_use: job.request.intended_use,
    target_level: job.request.target_level,
    curriculum_scope: job.request.curriculum_scope || CURRICULUM_SCOPE,
    source: {
      ...SAMPLE_SOURCE,
      label: prob.imageName ? `업로드한 원문 (${prob.imageName})` : '입력한 원문',
      statement: prob.text && prob.text.length > 10 ? prob.text : SAMPLE_SOURCE.statement,
      solution: expl.text && expl.text.length > 40 ? expl.text : SAMPLE_SOURCE.solution,
    },
  })
  store.results[resultId] = result
  job.result_id = resultId
  save(store)
  yield { stage: 'done', result_id: resultId, solution_idea: idea }
}

/** GET /api/results/:id */
export async function getResult(resultId: string): Promise<GenerationResult | null> {
  await delay(650)
  const store = load()
  return store.results[resultId] ?? null
}

/** A human's decision on a candidate: the only path to APPROVED (SPEC § 5). */
export async function recordHumanReview(resultId: string, candidateId: string, verdict: Verdict, reason: string): Promise<ReviewResult> {
  await delay(200)
  const store = load()
  const result = store.results[resultId]
  const candidate = result?.candidates.find((c) => c.id === candidateId)
  if (!result || !candidate) throw new Error('후보를 찾을 수 없습니다.')
  const next: ReviewResult = {
    ...candidate.review_result,
    verdict,
    reason,
    reviewer_type: 'SELF',
    approval_status: verdict === 'USE' ? 'APPROVED' : 'PROVISIONAL',
  }
  candidate.review_result = next
  save(store)
  return next
}

export function resetMock() {
  try {
    sessionStorage.removeItem(STORE_KEY)
  } catch {
    /* ignore */
  }
}
