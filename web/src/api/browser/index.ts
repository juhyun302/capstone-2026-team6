// The same four functions as ../client.ts, but the pipeline runs in this browser. Model calls go
// to OpenAI with the viewer's key, or through the team worker with a password (see ../settings.ts).

import { accessMode, getSettings } from '../settings'
import type { CallKind, GenerationRequest, GenerationResult, JobEvent, JobStage, QuestionError, ReviewResult, SourcePart, Verdict } from '../types'
import { ModelCallError, checkPassword, modelComplete } from './openai'
import { PROMPTS } from './rules'
import { checkGenerationRequest, generateLinkedQuestions, type CandidateOutcome, type Complete, type LinkedQuestions } from './pipeline'

const RESULTS_KEY = 'aleph.browser.results.v1'
const STAGES: JobStage[] = ['read', 'extract', 'validate', 'generate', 'review']
const VERDICTS: Verdict[] = ['USE', 'REVISE', 'HOLD', 'REJECT']
const CANDIDATES = 3

interface Job {
  events: JobEvent[]
  stage: JobStage
  done: boolean
  wake: (() => void) | null
}
const jobs = new Map<string, Job>()

function loadResults(): Record<string, GenerationResult> {
  try {
    return JSON.parse(sessionStorage.getItem(RESULTS_KEY) ?? '{}') as Record<string, GenerationResult>
  } catch {
    return {}
  }
}
const results = loadResults()
function saveResults() {
  try {
    sessionStorage.setItem(RESULTS_KEY, JSON.stringify(results))
  } catch {
    /* results stay in memory */
  }
}

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

function push(job: Job, event: JobEvent) {
  job.events.push({ ...event, at: Date.now() })
  job.wake?.()
}

const CALL_BY_PROMPT: Record<string, { stage: JobStage; kind: CallKind }> = {
  [PROMPTS.parse_query]: { stage: 'extract', kind: 'extract' },
  [PROMPTS.design_candidates]: { stage: 'generate', kind: 'design' },
  [PROMPTS.generate_candidate]: { stage: 'generate', kind: 'generate' },
  [PROMPTS.solve_candidate]: { stage: 'review', kind: 'solve' },
  [PROMPTS.review_candidate]: { stage: 'review', kind: 'review' },
}

/** Turn model calls into progress events; candidates run in parallel, so stages only move forward. */
function reporting(complete: Complete, job: Job): Complete {
  return async (system, user) => {
    const { stage, kind } = CALL_BY_PROMPT[system]
    // the design call starts only after the extracted idea passed the code checks
    if (stage === 'generate' && STAGES.indexOf(job.stage) < STAGES.indexOf('validate')) {
      job.stage = 'validate'
      push(job, { stage: 'validate' })
    }
    if (STAGES.indexOf(stage) > STAGES.indexOf(job.stage)) {
      job.stage = stage
      push(job, { stage })
    }
    push(job, { stage: job.stage, call: { kind, phase: 'start' } })
    let output: string
    try {
      output = await complete(system, user)
    } finally {
      push(job, { stage: job.stage, call: { kind, phase: 'end' } })
    }
    if (stage === 'extract') {
      try {
        const idea = JSON.parse(output)
        if (idea && Array.isArray(idea.key_elements) && idea.mechanism) push(job, { stage, solution_idea: idea })
      } catch {
        /* validation reports malformed output */
      }
    }
    return output
  }
}

const textPart = (part: SourcePart) => ({ text: part.text?.trim() || undefined, image: part.image?.name })

function shown(candidate: CandidateOutcome) {
  return {
    id: candidate.id, ...candidate.candidate_question!,
    plan: { changed_axes: candidate.plan.changed_axes, added_judgment: candidate.plan.added_judgment },
    surface_check: candidate.surface_check ?? undefined, transferable: candidate.transferable,
    review_result: candidate.review_result as ReviewResult, ai_review_result: candidate.review_result as ReviewResult,
  }
}

function record(request: GenerationRequest, output: LinkedQuestions): GenerationResult {
  return {
    id: id('res'),
    created_at: new Date().toISOString(),
    request: {
      intended_use: request.intended_use, target_level: request.target_level, curriculum_scope: request.curriculum_scope,
      source: { label: '입력한 원문', topic: request.curriculum_scope, statement: request.source_question.problem.text ?? '',
        solution: request.source_question.explanation.text ?? '' },
    },
    solution_idea: output.solution_idea!,
    candidates: output.candidates.filter((c) => c.review_result).map(shown),
  }
}

export async function createJob(req: GenerationRequest): Promise<{ jobId: string }> {
  const request = {
    ...req,
    source_question: { problem: textPart(req.source_question.problem), explanation: textPart(req.source_question.explanation) },
  }
  try {
    checkGenerationRequest(request)
  } catch (error) {
    throw new Error(String(error).includes('image') ? '이미지 입력은 아직 지원하지 않습니다. 수식·텍스트로 넣어 주세요.' : '원문, 해설, 교육과정 범위를 모두 넣어 주세요.')
  }
  const settings = getSettings()
  // a wrong password should stop here, with the form still filled in
  if (accessMode === 'password') await checkPassword(settings.secret)
  const complete = modelComplete(accessMode, settings)

  const jobId = id('job')
  const job: Job = {
    events: [{ stage: 'read', at: Date.now(), source_statement: request.source_question.problem.text, candidates: CANDIDATES }],
    stage: 'read', done: false, wake: null,
  }
  jobs.set(jobId, job)
  void (async () => {
    let event: JobEvent
    try {
      const output = await generateLinkedQuestions(request, reporting(complete, job), { count: CANDIDATES })
      if (output.status === 'OK') {
        const result = record(req, output)
        results[result.id] = result
        saveResults()
        event = { stage: 'done', result_id: result.id, solution_idea: output.solution_idea ?? undefined }
      } else {
        event = { stage: 'error', error: { status: output.status, error_code: output.error_code ?? '', reason: output.reason ?? '' } as QuestionError }
      }
    } catch (error) {
      const reason = error instanceof ModelCallError ? error.message : '모델 호출에 실패했습니다. 잠시 뒤 다시 시도해 주세요.'
      event = { stage: 'error', error: { status: 'SERVER_ERROR', error_code: 'MODEL_CALL_FAILED', reason } }
    }
    job.done = true
    push(job, event)
  })()
  return { jobId }
}

export async function* jobEvents(jobId: string, signal?: AbortSignal): AsyncGenerator<JobEvent> {
  const job = jobs.get(jobId)
  if (!job) {
    yield { stage: 'error', error: { status: 'SERVER_ERROR', error_code: 'JOB_NOT_FOUND', reason: '요청을 찾을 수 없습니다. 페이지를 새로 고치면 진행 중인 작업이 사라집니다. 원문을 다시 올려 주세요.' } }
    return
  }
  let sent = 0
  while (!signal?.aborted) {
    while (sent < job.events.length) {
      yield job.events[sent]
      sent += 1
    }
    if (job.done) return
    await new Promise<void>((resolve) => {
      job.wake = resolve
    })
    job.wake = null
  }
}

export async function getResult(resultId: string): Promise<GenerationResult | null> {
  return results[resultId] ?? null
}

/** The only path to APPROVED; the AI's verdict stays in ai_review_result. */
export async function recordHumanReview(resultId: string, candidateId: string, verdict: Verdict, reason: string): Promise<ReviewResult> {
  const candidate = results[resultId]?.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error('후보를 찾을 수 없습니다.')
  if (!VERDICTS.includes(verdict) || !reason.trim()) throw new Error('판정과 이유를 넣어 주세요.')
  const ai = candidate.ai_review_result ?? candidate.review_result
  if (candidate.review_result.reviewer_type !== 'AI') throw new Error('이미 사람이 판정한 후보입니다.')
  if (verdict === 'USE' && (ai.validity_issue || ai.curriculum_issue)) throw new Error('결함이나 교육과정 이탈이 표시된 후보는 사용 승인할 수 없습니다.')
  candidate.review_result = { ...ai, verdict, reason, reviewer_type: 'SELF', approval_status: verdict === 'USE' ? 'APPROVED' : 'PROVISIONAL' }
  saveResults()
  return candidate.review_result
}
