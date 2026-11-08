// Browser port of src/aleph/validation.py, generation.py, review.py and pipeline.py checks.
// Prompts and schemas are read from the same files the Python code uses, so the two
// implementations share one contract. Messages and error codes match the Python ones.

import Ajv from 'ajv'
import parseQueryMd from '../../../../src/aleph/prompts/parse_query.md?raw'
import designMd from '../../../../src/aleph/prompts/design_candidates.md?raw'
import generateMd from '../../../../src/aleph/prompts/generate_candidate.md?raw'
import solveMd from '../../../../src/aleph/prompts/solve_candidate.md?raw'
import reviewMd from '../../../../src/aleph/prompts/review_candidate.md?raw'
import ideaSchema from '../../../../src/aleph/schemas/solution_idea.schema.json?raw'
import candidateSchema from '../../../../src/aleph/schemas/candidate_question.schema.json?raw'
import blindSchema from '../../../../src/aleph/schemas/blind_solution.schema.json?raw'
import reviewSchema from '../../../../src/aleph/schemas/review_output.schema.json?raw'
import designSchema from '../../../../src/aleph/schemas/candidate_design.schema.json?raw'

const START = '<!-- prompt:start -->'
const END = '<!-- prompt:end -->'

export function promptOf(markdown: string, name: string): string {
  const text = markdown.replace(/\r\n/g, '\n')
  if (text.split(START).length !== 2 || text.split(END).length !== 2) throw new Error(`${name}: prompt markers must appear exactly once`)
  return text.split(START)[1].split(END)[0].trim()
}

export const PROMPTS = {
  parse_query: promptOf(parseQueryMd, 'parse_query'),
  design_candidates: promptOf(designMd, 'design_candidates'),
  generate_candidate: promptOf(generateMd, 'generate_candidate'),
  solve_candidate: promptOf(solveMd, 'solve_candidate'),
  review_candidate: promptOf(reviewMd, 'review_candidate'),
}

const ajv = new Ajv({ strict: false, allErrors: false })
const compile = (raw: string) => ajv.compile(JSON.parse(raw))
const IDEA = compile(ideaSchema)
const CANDIDATE = compile(candidateSchema)
const BLIND = compile(blindSchema)
const REVIEW = compile(reviewSchema)
const DESIGN = compile(designSchema)

export type Status = 'OK' | 'QUESTION_ERROR' | 'OUTPUT_ERROR'
export interface Checked<T> {
  status: Status
  error_code: string | null
  reason: string | null
  value: T | null
}

const ok = <T>(value: T): Checked<T> => ({ status: 'OK', error_code: null, reason: null, value })
const fail = <T>(code: string, reason: string, status: Status = 'OUTPUT_ERROR'): Checked<T> => ({ status, error_code: code, reason, value: null })
const JSON_REASON = '중복 키와 비표준 값이 없는 JSON 객체 하나가 필요합니다.'

/** JSON.parse that also rejects a repeated key in any object, like the Python object_pairs_hook. */
export function strictJson(raw: unknown): unknown {
  if (typeof raw !== 'string') throw new TypeError('raw_output must be a string')
  const value = JSON.parse(raw)
  // The text is valid JSON here, so a flat scan with a container stack is enough.
  const stack: { object: boolean; keys: Set<string>; expectKey: boolean }[] = []
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    const top = stack[stack.length - 1]
    if (c === '"') {
      let j = i + 1
      while (raw[j] !== '"') j += raw[j] === '\\' ? 2 : 1
      if (top?.object && top.expectKey) {
        const key = JSON.parse(raw.slice(i, j + 1)) as string
        if (top.keys.has(key)) throw new SyntaxError('Duplicate JSON key')
        top.keys.add(key)
        top.expectKey = false
      }
      i = j + 1
      continue
    }
    if (c === '{') stack.push({ object: true, keys: new Set(), expectKey: true })
    else if (c === '[') stack.push({ object: false, keys: new Set(), expectKey: false })
    else if (c === '}' || c === ']') stack.pop()
    else if (c === ',' && top?.object) top.expectKey = true
    i += 1
  }
  return value
}

function parsed(raw: unknown): { value?: unknown; error?: true } {
  try {
    return { value: strictJson(raw) }
  } catch (error) {
    if (error instanceof TypeError) throw error
    return { error: true }
  }
}

const blank = (value: unknown) => typeof value === 'string' && !value.trim()

export interface SolutionIdea {
  concept: string | null
  key_elements: [string, string] | null
  mechanism: string | null
  transferable?: boolean
}

export function validateSolutionIdea(raw: unknown, comparisonAvailable = false): Checked<SolutionIdea> {
  if (typeof raw !== 'string') throw new TypeError('raw_output must be a string')
  if (typeof comparisonAvailable !== 'boolean') throw new TypeError('comparison_available must be a boolean')
  const { value, error } = parsed(raw)
  if (error) return fail('JSON_INVALID', JSON_REASON)
  if (!IDEA(value)) return fail('SCHEMA_INVALID', '출력이 SolutionIdea 스키마의 키, 타입 또는 값 제약을 위반했습니다.')
  const idea = value as SolutionIdea
  if ([idea.concept, idea.mechanism, ...(idea.key_elements ?? [])].some(blank)) return fail('EMPTY_TEXT', '공백만 있는 문자열을 풀이 정보로 사용할 수 없습니다.')
  if ('transferable' in idea && !comparisonAvailable) return fail('COMPARISON_REQUIRED', '전이 여부를 판단하려면 원문과 후보의 풀이 비교 근거가 필요합니다.')
  if (idea.key_elements === null) return fail('MISSING_ELEMENTS', '근거 있는 핵심 풀이 요소 두 개가 필요합니다.', 'QUESTION_ERROR')
  if (idea.mechanism === null) return fail('MISSING_MECHANISM', '두 핵심 풀이 요소의 연결 메커니즘이 필요합니다.', 'QUESTION_ERROR')
  return ok(idea)
}

export interface CandidateQuestion {
  statement: string
  solution: string
}

export function validateCandidateQuestion(raw: unknown): Checked<CandidateQuestion> {
  const { value, error } = parsed(raw)
  if (error) return fail('JSON_INVALID', JSON_REASON)
  if (!CANDIDATE(value)) return fail('SCHEMA_INVALID', '출력이 후보 문항 스키마의 키, 타입 또는 값 제약을 위반했습니다.')
  const candidate = value as CandidateQuestion
  if (Object.values(candidate).some(blank)) return fail('EMPTY_TEXT', '공백만 있는 문자열을 문항이나 풀이로 사용할 수 없습니다.')
  return ok(candidate)
}

export interface BlindSolution {
  status: 'solved' | 'ambiguous' | 'inconsistent' | 'unsolved'
  answer: string
  solution: string
  issues: string[]
}

export function validateBlindSolution(raw: unknown): Checked<BlindSolution> {
  const { value, error } = parsed(raw)
  if (error) return fail('JSON_INVALID', JSON_REASON)
  if (!BLIND(value)) return fail('SCHEMA_INVALID', '출력이 독립 풀이 스키마의 키, 타입 또는 값 제약을 위반했습니다.')
  const blind = value as BlindSolution
  if (!blind.solution.trim()) return fail('EMPTY_TEXT', '공백만 있는 문자열을 풀이로 사용할 수 없습니다.')
  return ok(blind)
}

export interface ReviewOutput {
  validity_issue: boolean
  curriculum_issue: boolean
  transferable: boolean
  verdict: 'USE' | 'REVISE' | 'HOLD' | 'REJECT'
  reason: string
}

export function validateReviewOutput(raw: unknown, blindClean: boolean, copySuspected = false): Checked<ReviewOutput> {
  if (typeof blindClean !== 'boolean' || typeof copySuspected !== 'boolean') throw new TypeError('blind_clean and copy_suspected must be booleans')
  const { value, error } = parsed(raw)
  if (error) return fail('JSON_INVALID', JSON_REASON)
  if (!REVIEW(value)) return fail('SCHEMA_INVALID', '출력이 검토 스키마의 키, 타입 또는 값 제약을 위반했습니다.')
  const review = value as ReviewOutput
  if (!review.reason.trim()) return fail('EMPTY_TEXT', '공백만 있는 문자열을 검토 이유로 사용할 수 없습니다.')
  const blocked = review.validity_issue || review.curriculum_issue || !review.transferable || !blindClean || copySuspected
  if (review.verdict === 'USE' && blocked) return fail('VERDICT_CONFLICT', '확인된 문제가 있는 후보를 USE로 판정할 수 없습니다.')
  return ok(review)
}

export interface Plan {
  id: string
  object: string
  condition_form: string
  target: string
  representation: string
  solution_route: string | string[]
  changed_axes: string[]
  added_judgment: string
}

export function validateCandidateDesign(raw: unknown, count: number): Checked<{ plans: Plan[] }> {
  if (!Number.isInteger(count)) throw new TypeError('count must be an integer')
  const { value, error } = parsed(raw)
  if (error) return fail('JSON_INVALID', JSON_REASON)
  if (!DESIGN(value)) return fail('SCHEMA_INVALID', '설계안이 스키마의 키, 타입, 변화 축 수 또는 언어 제약을 위반했습니다.')
  const design = value as { plans: Plan[] }
  const texts = design.plans.flatMap((plan) => Object.values(plan).flatMap((v) => (Array.isArray(v) ? v : [v])))
  if (texts.some(blank)) return fail('EMPTY_TEXT', '공백만 있는 문자열을 설계로 사용할 수 없습니다.')
  if (design.plans.length !== count || new Set(design.plans.map((p) => p.id)).size !== design.plans.length) return fail('DESIGN_INVALID', '설계안의 수나 ID가 요청과 다릅니다.')
  return ok(design)
}
