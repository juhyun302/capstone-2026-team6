// Port of generate_linked_questions (src/aleph/pipeline.py) and its parts for the browser.
// `complete(system, user)` sends one model call and returns the raw text.

import { THRESHOLD, similarity } from './similarity'
import {
  PROMPTS,
  validateBlindSolution,
  validateCandidateDesign,
  validateCandidateQuestion,
  validateReviewOutput,
  validateSolutionIdea,
  type CandidateQuestion,
  type Checked,
  type Plan,
  type SolutionIdea,
  type Status,
} from './rules'

export type Complete = (system: string, user: string) => Promise<string>

export interface SourcePart {
  text?: string
  image?: unknown
}
export interface GenerationRequest {
  source_question: { problem?: SourcePart; explanation?: SourcePart }
  intended_use?: string
  target_level?: string
  curriculum_scope?: string
}
export interface ReviewResult {
  validity_issue: boolean
  curriculum_issue: boolean
  verdict: 'USE' | 'REVISE' | 'HOLD' | 'REJECT'
  reason: string
  reviewer_type: 'AI'
  approval_status: 'PROVISIONAL'
}
export interface SurfaceCheck {
  source_similarity: number
  max_sibling_similarity: number
  copy_suspected: boolean
}
export interface CandidateOutcome {
  id: string
  plan: Plan
  surface_check: SurfaceCheck | null
  status: Status
  error_code: string | null
  reason: string | null
  candidate_question: CandidateQuestion | null
  review_result: ReviewResult | null
  transferable: boolean | null
}
export interface LinkedQuestions {
  status: Status
  error_code: string | null
  reason: string | null
  solution_idea: SolutionIdea | null
  candidates: CandidateOutcome[]
}

const CONDITIONS = ['intended_use', 'target_level', 'curriculum_scope'] as const
export const MAX_CANDIDATES = 5

function sourceText(sourceQuestion: GenerationRequest['source_question']) {
  const source: Record<'problem' | 'explanation', string> = { problem: '', explanation: '' }
  for (const name of ['problem', 'explanation'] as const) {
    const part = sourceQuestion?.[name] ?? {}
    if (part.image) throw new Error(`${name}: image input is not supported yet`)
    if (typeof part.text !== 'string' || !part.text.trim()) throw new Error(`${name}: text is required`)
    source[name] = part.text
  }
  return source
}

/** Return the source text and conditions; a bad request fails before any model call. */
export function checkGenerationRequest(request: GenerationRequest) {
  const conditions: Record<string, string> = {}
  for (const name of CONDITIONS) {
    const value = request[name]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
    conditions[name] = value
  }
  return { source: sourceText(request.source_question ?? {}), conditions }
}

/** Retry a malformed output once; a missing-information result is final. */
async function firstValid<T>(complete: Complete, system: string, user: string, validate: (raw: string) => Checked<T>) {
  let result = validate(await complete(system, user))
  if (result.status === 'OUTPUT_ERROR') result = validate(await complete(system, user))
  return result
}

export async function extractSolutionIdea(sourceQuestion: GenerationRequest['source_question'], complete: Complete) {
  const user = JSON.stringify(sourceText(sourceQuestion))
  return firstValid(complete, PROMPTS.parse_query, user, (raw) => validateSolutionIdea(raw))
}

export async function reviewCandidate(source: Record<string, string>, candidate: CandidateQuestion, scope: string, idea: SolutionIdea,
  surfaceCheck: SurfaceCheck, complete: Complete) {
  const solved = await firstValid(complete, PROMPTS.solve_candidate, JSON.stringify({ statement: candidate.statement, curriculum_scope: scope }), validateBlindSolution)
  if (solved.status !== 'OK' || !solved.value) return { ...solved, review: null, transferable: null }
  const blind = solved.value
  const blindClean = blind.status === 'solved' && blind.issues.length === 0
  const user = JSON.stringify({ source_question: source, solution_idea: idea, candidate_question: candidate, blind_solution: blind,
    curriculum_scope: scope, surface_check: surfaceCheck })
  const reviewed = await firstValid(complete, PROMPTS.review_candidate, user, (raw) => validateReviewOutput(raw, blindClean, surfaceCheck.copy_suspected))
  if (reviewed.status !== 'OK' || !reviewed.value) return { ...reviewed, review: null, transferable: null }
  const output = reviewed.value
  const review: ReviewResult = { validity_issue: output.validity_issue, curriculum_issue: output.curriculum_issue, verdict: output.verdict,
    reason: output.reason, reviewer_type: 'AI', approval_status: 'PROVISIONAL' }
  return { ...reviewed, review, transferable: output.transferable }
}

/** Run `task` for every item with at most `limit` running at once; results keep the input order. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

/** Flag a later candidate, never the earlier one, when two are nearly the same. */
function surfaceChecks(problem: string, statements: (string | null)[]): (SurfaceCheck | null)[] {
  const seen: string[] = []
  return statements.map((statement) => {
    if (statement === null) return null
    const toSource = similarity(problem, statement)
    const toSibling = seen.reduce((best, other) => Math.max(best, similarity(other, statement)), 0)
    seen.push(statement)
    return { source_similarity: toSource, max_sibling_similarity: toSibling, copy_suspected: Math.max(toSource, toSibling) >= THRESHOLD }
  })
}

export async function generateLinkedQuestions(request: GenerationRequest, complete: Complete, { count = 3, workers = 3 } = {}): Promise<LinkedQuestions> {
  if (!Number.isInteger(count)) throw new TypeError('count must be an integer')
  if (count < 1 || count > MAX_CANDIDATES) throw new RangeError(`count must be between 1 and ${MAX_CANDIDATES}`)
  const { source, conditions } = checkGenerationRequest(request)

  const extraction = await extractSolutionIdea(request.source_question, complete)
  if (extraction.status !== 'OK' || !extraction.value) {
    return { status: extraction.status, error_code: extraction.error_code, reason: extraction.reason, solution_idea: null, candidates: [] }
  }
  const idea = extraction.value

  const designUser = JSON.stringify({ source_question: source, solution_idea: idea, count, ...conditions })
  const designed = await firstValid(complete, PROMPTS.design_candidates, designUser, (raw) => validateCandidateDesign(raw, count))
  if (designed.status !== 'OK' || !designed.value) {
    return { status: designed.status, error_code: designed.error_code, reason: designed.reason, solution_idea: idea, candidates: [] }
  }
  const plans = designed.value.plans

  const drafts = await mapLimit(plans, workers, (plan) => {
    const siblings = plans.filter((other) => other.id !== plan.id)
    const user = JSON.stringify({ source_question: source, solution_idea: idea, plan, sibling_plans: siblings, ...conditions })
    return firstValid(complete, PROMPTS.generate_candidate, user, validateCandidateQuestion)
  })
  const checks = surfaceChecks(source.problem, drafts.map((d) => (d.status === 'OK' && d.value ? d.value.statement : null)))
  const reviews = await mapLimit(plans, workers, (_plan, index) => {
    const draft = drafts[index]
    if (draft.status !== 'OK' || !draft.value) return Promise.resolve(null)
    return reviewCandidate(source, draft.value, conditions.curriculum_scope, idea, checks[index]!, complete)
  })

  const candidates: CandidateOutcome[] = plans.map((plan, index) => {
    const draft = drafts[index]
    const reviewed = reviews[index]
    const failed = draft.status !== 'OK' ? draft : reviewed && reviewed.status !== 'OK' ? reviewed : null
    const outcome = failed ?? reviewed!
    return {
      id: plan.id, plan, surface_check: checks[index], status: outcome.status, error_code: outcome.error_code, reason: outcome.reason,
      candidate_question: failed ? null : draft.value, review_result: failed ? null : reviewed!.review,
      transferable: failed ? null : reviewed!.transferable,
    }
  })
  if (!candidates.some((c) => c.review_result)) {
    return { status: 'OUTPUT_ERROR', error_code: candidates[0].error_code, reason: '검토까지 마친 후보가 하나도 없습니다.', solution_idea: idea, candidates }
  }
  return { status: 'OK', error_code: null, reason: null, solution_idea: idea, candidates }
}
