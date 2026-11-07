// Domain types, named after docs/ontology.yaml and docs/SPEC.md § 5 of the Aleph repository.
// The web client speaks only these shapes; the mock in ./mock.ts and a future
// FastAPI/Next route both implement `generate_linked_question` and `review_candidate`.

export type Role = '수학 문항 제작자' | '학원 수학 강사'

/** One side of the source: an image, text with formulas, or both. */
export interface SourcePart {
  image?: File | null
  imageName?: string
  text?: string
}

export interface SourceQuestion {
  problem: SourcePart
  explanation: SourcePart
}

export type IntendedUse = '보충지' | '모의고사 회차' | '수업'
export type TargetLevel = '상위권' | '준킬러' | '킬러'

export interface GenerationRequest {
  source_question: SourceQuestion
  intended_use: IntendedUse
  target_level: TargetLevel
  curriculum_scope: string
}

export interface SolutionIdea {
  concept: string | null
  key_elements: [string, string] | null
  mechanism: string | null
  transferable?: boolean
}

export type Verdict = 'USE' | 'REVISE' | 'HOLD' | 'REJECT'
export type ReviewerType = 'SELF' | 'PEER' | 'AI'
export type ApprovalStatus = 'PROVISIONAL' | 'APPROVED'

export interface ReviewResult {
  validity_issue: boolean
  curriculum_issue: boolean
  verdict: Verdict
  reason: string
  reviewer_type: ReviewerType
  approval_status: ApprovalStatus
}

export interface CandidateQuestion {
  id: string
  statement: string
  solution: string
  /** Where each key element of the source is applied. The server writes this in `reason` (AC3). */
  element_trace?: [string, string]
  /** The two formulas in the statement that carry the key elements, as they appear in `statement` (for the ink marks). */
  element_marks?: [string, string]
  review_result: ReviewResult
  /** The AI's verdict, kept after a human decides. */
  ai_review_result?: ReviewResult
  /** What the design stage changed from the source and the judgment it added. */
  plan?: { changed_axes: string[]; added_judgment: string }
  /** String similarity to the source and to earlier candidates. */
  surface_check?: { source_similarity: number; max_sibling_similarity: number; copy_suspected: boolean }
}

export interface SourceSummary {
  statement: string
  solution: string
  topic: string
  label: string
}

export interface GenerationResult {
  id: string
  created_at: string
  request: Omit<GenerationRequest, 'source_question'> & { source: SourceSummary }
  solution_idea: SolutionIdea
  candidates: CandidateQuestion[]
}

export interface QuestionError {
  status: 'QUESTION_ERROR' | 'OUTPUT_ERROR' | 'SERVER_ERROR'
  error_code: string
  reason: string
  /** What the user has to confirm before the parser will continue (AC9). */
  needs_confirmation?: string[]
}

/** Pipeline stages the job streams while it runs. */
export type JobStage = 'read' | 'extract' | 'generate' | 'review' | 'done' | 'error'

export interface JobEvent {
  stage: JobStage
  /** The problem text the user sent, shown while the job runs. */
  source_statement?: string
  /** Filled once the parser has an idea; partial while it streams. */
  solution_idea?: Partial<SolutionIdea>
  result_id?: string
  error?: QuestionError
}
