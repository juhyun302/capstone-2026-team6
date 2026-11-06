import { Check, CircleAlert, CircleCheck, PauseCircle, XCircle } from 'lucide-react'
import type { ReviewResult, Verdict } from '../api/types'

export const VERDICT_LABEL: Record<Verdict, string> = {
  USE: '사용 가능',
  REVISE: '수정 필요',
  HOLD: '보류',
  REJECT: '폐기',
}

const ICON: Record<Verdict, typeof Check> = { USE: CircleCheck, REVISE: CircleAlert, HOLD: PauseCircle, REJECT: XCircle }

export function VerdictBadge({ verdict, size }: { verdict: Verdict; size?: 'lg' }) {
  const Icon = ICON[verdict]
  return (
    <span className={`verdict${size === 'lg' ? ' verdict--lg' : ''}`} data-verdict={verdict}>
      <Icon aria-hidden="true" />
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

export function ApprovalLine({ review }: { review: ReviewResult }) {
  const who = review.reviewer_type === 'AI' ? 'AI 잠정 판정' : review.reviewer_type === 'SELF' ? '내가 판정' : '동료가 판정'
  const status = review.approval_status === 'APPROVED' ? '사용 승인됨' : '최종 승인 전'
  return (
    <span className="approval" data-status={review.approval_status}>
      {who}, {status}
    </span>
  )
}

export function IssueFlags({ review }: { review: ReviewResult }) {
  return (
    <div className="flags" role="list" aria-label="검토 항목">
      <div className="flag" role="listitem" data-issue={review.validity_issue}>
        {review.validity_issue ? <CircleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
        <span>{review.validity_issue ? '수학적 성립에 문제가 있습니다' : '조건과 풀이가 성립합니다'}</span>
      </div>
      <div className="flag" role="listitem" data-issue={review.curriculum_issue}>
        {review.curriculum_issue ? <CircleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
        <span>{review.curriculum_issue ? '교육과정 범위를 벗어납니다' : '요청한 교육과정 범위 안입니다'}</span>
      </div>
    </div>
  )
}
