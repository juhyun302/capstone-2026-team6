// The same four functions as ../client.ts, but the pipeline runs in this browser. Model calls go
// to OpenAI with the viewer's key, or through the team worker with a password (see ../settings.ts).

import { accessMode, getSettings } from '../settings'
import type { CallKind, GenerationRequest, GenerationResult, JobEvent, JobStage, QuestionError, ReviewResult, SourcePart, Verdict } from '../types'
import { ModelCallError, checkPassword, modelComplete } from './openai'
import { PROMPTS } from './rules'
import { checkGenerationRequest, generateLinkedQuestions, generateMoreQuestions, type CandidateOutcome, type Complete, type LinkedQuestions } from './pipeline'

const RESULTS_KEY = 'aleph.browser.results.v1'
const STAGES: JobStage[] = ['read', 'extract', 'validate', 'generate', 'review']
const VERDICTS: Verdict[] = ['USE', 'REVISE', 'HOLD', 'REJECT']

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
  const complete = await connect()
  const events: JobEvent[] = [{ stage: 'read', at: Date.now(), source_statement: request.source_question.problem.text, candidates: req.count }]
  return start(events, 'read', complete, (reported) => generateLinkedQuestions(request, reported, { count: req.count }), (output) => {
    const result = record(req, output)
    results[result.id] = result
    return result.id
  })
}

/** More candidates on the same SolutionIdea; they join the same result. */
export async function createMoreJob(resultId: string, count: number): Promise<{ jobId: string }> {
  const result = results[resultId]
  if (!result) throw new Error('이 검토 결과를 찾을 수 없습니다. 원문을 다시 올려 주세요.')
  const complete = await connect()
  const { source, intended_use, target_level, curriculum_scope } = result.request
  const request = { intended_use, target_level, curriculum_scope, source_question: { problem: { text: source.statement }, explanation: { text: source.solution } } }
  const idea = result.solution_idea
  const existing = result.candidates.map((candidate) => candidate.statement)
  const at = Date.now()
  // the idea is already extracted; its step counts as finished so the progress bar adds up
  const events: JobEvent[] = [
    { stage: 'read', at, source_statement: source.statement, candidates: count, back_to: resultId },
    { stage: 'extract', at, solution_idea: idea, call: { kind: 'extract', phase: 'start' } },
    { stage: 'extract', at, call: { kind: 'extract', phase: 'end' } },
  ]
  return start(events, 'extract', complete, (reported) => generateMoreQuestions(request, idea, existing, reported, { count }), (output) => {
    // a candidate can be dropped in review, so the next id comes from the largest one
    let number = Math.max(...result.candidates.map((c) => Number(c.id.slice(1))))
    for (const candidate of output.candidates.filter((c) => c.review_result)) {
      number += 1
      result.candidates.push({ ...shown(candidate), id: `p${number}` })
    }
    return resultId
  })
}

async function connect(): Promise<Complete> {
  const settings = getSettings()
  // a wrong password should stop here, with the form still filled in
  if (accessMode === 'password') await checkPassword(settings.secret)
  return modelComplete(accessMode, settings)
}

/** Run the pipeline in the background; `keep` stores a good output and returns its result id. */
function start(events: JobEvent[], stage: JobStage, complete: Complete, generate: (reported: Complete) => Promise<LinkedQuestions>, keep: (output: LinkedQuestions) => string) {
  const jobId = id('job')
  const job: Job = { events, stage, done: false, wake: null }
  jobs.set(jobId, job)
  void (async () => {
    let event: JobEvent
    try {
      const output = await generate(reporting(complete, job))
      if (output.status === 'OK') {
        const resultId = keep(output)
        saveResults()
        event = { stage: 'done', result_id: resultId, solution_idea: output.solution_idea ?? undefined }
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

/** The only path to APPROVED; a person can change their decision, and the AI's verdict stays in ai_review_result. */
export async function recordHumanReview(resultId: string, candidateId: string, verdict: Verdict, reason: string): Promise<ReviewResult> {
  const candidate = results[resultId]?.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error('후보를 찾을 수 없습니다.')
  if (!VERDICTS.includes(verdict) || !reason.trim()) throw new Error('판정과 이유를 넣어 주세요.')
  const ai = candidate.ai_review_result ?? candidate.review_result
  if (verdict === 'USE' && (ai.validity_issue || ai.curriculum_issue)) throw new Error('결함이나 교육과정 이탈이 표시된 후보는 사용 승인할 수 없습니다.')
  candidate.review_result = { ...ai, verdict, reason, reviewer_type: 'SELF', approval_status: verdict === 'USE' ? 'APPROVED' : 'PROVISIONAL' }
  saveResults()
  return candidate.review_result
}
