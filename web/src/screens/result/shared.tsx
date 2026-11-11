import { useEffect, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api'
import type { CandidateQuestion, GenerationResult, ReviewResult, Verdict } from '../../api/types'
import { MathText } from '../../components/Math'

export const DECIDE_LABEL: Record<Verdict, string> = { USE: '사용 승인', REVISE: '수정 필요', HOLD: '보류', REJECT: '폐기' }

const REASON_BY_VERDICT: Record<Verdict, string> = {
  USE: '독립적으로 풀어 수학적 성립과 수업 범위를 확인했습니다.',
  REVISE: '조건이나 풀이를 고친 뒤 다시 검토합니다.',
  HOLD: '지금 회차에는 맞지 않아 보관합니다.',
  REJECT: '풀이 의도가 훼손되어 사용하지 않습니다.',
}

export function approvalSentence(r: ReviewResult) {
  if (r.reviewer_type === 'AI') return 'AI의 잠정 판정입니다. 최종 승인 전입니다.'
  if (r.approval_status === 'APPROVED') return '내가 독립적으로 풀어 보고 사용을 승인했습니다.'
  return '내가 판정했습니다. 승인 전 AI 판정은 기록에 남습니다.'
}

export function sealNote(r: ReviewResult) {
  return r.reviewer_type === 'AI' ? 'AI 잠정 판정' : r.approval_status === 'APPROVED' ? '강사 승인' : '강사 판정'
}

export function checksSentence(r: ReviewResult) {
  return `${r.validity_issue ? '수학적 성립에 문제가 있습니다.' : '조건과 풀이가 성립합니다.'} ${r.curriculum_issue ? '교육과정 범위를 벗어납니다.' : '요청한 교육과정 범위 안입니다.'}`
}

/** The human's decision per candidate; the only path to APPROVED. */
export function useDecisions(result: GenerationResult) {
  const [candidates, setCandidates] = useState(result.candidates)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => setCandidates(result.candidates), [result])
  async function record(candidate: CandidateQuestion, action: string, call: () => Promise<ReviewResult>) {
    setBusy(`${candidate.id}:${action}`)
    try {
      const next = await call()
      setCandidates((list) => list.map((x) => (x.id === candidate.id ? { ...x, review_result: next } : x)))
    } finally {
      setBusy(null)
    }
  }
  const decide = (candidate: CandidateQuestion, verdict: Verdict) => record(candidate, verdict, () => api.recordHumanReview(result.id, candidate.id, verdict, REASON_BY_VERDICT[verdict]))
  const undo = (candidate: CandidateQuestion) => record(candidate, 'undo', () => api.undoHumanReview(result.id, candidate.id))
  return { candidates, decide, undo, busy }
}

export function DecideRow({ candidate, busy, onDecide }: { candidate: CandidateQuestion; busy: string | null; onDecide: (v: Verdict) => void }) {
  const review = candidate.review_result
  if (review.reviewer_type !== 'AI') return null
  const flagged = review.validity_issue || review.curriculum_issue
  return (
    <div className="cand__decide" role="group" aria-label="내 판정">
      {(['USE', 'REVISE', 'HOLD', 'REJECT'] as Verdict[]).map((v) => (
        <button
          key={v}
          type="button"
          className="btn btn--secondary btn--sm decide"
          data-verdict={v}
          onClick={() => onDecide(v)}
          disabled={busy !== null || (v === 'USE' && flagged)}
          title={v === 'USE' && flagged ? '결함이나 교육과정 이탈이 표시된 후보는 사용 승인할 수 없습니다.' : undefined}
        >
          {busy === `${candidate.id}:${v}` ? '기록 중…' : DECIDE_LABEL[v]}
        </button>
      ))}
    </div>
  )
}

export function ResultHead({ onOpenSource }: { onOpenSource: () => void }) {
  return (
    <header className="sheet__head">
      <h1>검토 결과</h1>
      <div className="sheet__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onOpenSource}>
          원문 보기
        </button>
      </div>
    </header>
  )
}

export function SourceDialog({ ref, result }: { ref: RefObject<HTMLDialogElement | null>; result: GenerationResult }) {
  const idea = result.solution_idea
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="source-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
    >
      <div className="modal__body">
        <div className="modal__head">
          <h2 id="source-title">원문</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={() => ref.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        <MathText statement text={result.request.source.statement} className="sheet__statement" />
        <MathText text={result.request.source.solution} className="sheet__solution" />
        <div className="sheet__idea">
          <h3>풀이 아이디어</h3>
          <p>
            중심 개념은 <strong>{idea.concept}</strong>이고, 해설에서 확인한 핵심 풀이 요소는 두 가지입니다.
          </p>
          <ol>
            {idea.key_elements?.map((e, i) => (
              <li key={i}>{e}.</li>
            ))}
          </ol>
          <p>{idea.mechanism}.</p>
        </div>
      </div>
    </dialog>
  )
}
