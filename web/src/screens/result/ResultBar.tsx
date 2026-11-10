import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draft } from '../../api/draft'
import type { CandidateQuestion, GenerationResult, Verdict } from '../../api/types'
import { approvedFile, approvedFileName, approvedOf, approvedText } from './approved'
import { DECIDE_LABEL } from './shared'

const VERDICTS: Verdict[] = ['USE', 'REVISE', 'HOLD', 'REJECT']
const COPY_LABEL = { idle: '승인 문항 복사', done: '복사했습니다', failed: '복사하지 못했습니다' }

function saveFile(name: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** What a person can do once candidates are judged: see the tally, keep the approved ones, ask for more. */
export function ResultBar({ result, candidates }: { result: GenerationResult; candidates: CandidateQuestion[] }) {
  const [copy, setCopy] = useState<keyof typeof COPY_LABEL>('idle')
  const approved = approvedOf(candidates)
  const decided = candidates.filter((c) => c.review_result.reviewer_type !== 'AI')
  const tally = VERDICTS.flatMap((v) => {
    const count = decided.filter((c) => c.review_result.verdict === v).length
    return count ? [`${DECIDE_LABEL[v]} ${count}`] : []
  })
  const { statement, solution } = result.request.source
  const again: Draft = { statement, solution, scope: result.request.curriculum_scope }

  async function copyApproved() {
    try {
      await navigator.clipboard.writeText(approvedText(approved))
      setCopy('done')
    } catch {
      setCopy('failed')
    }
    setTimeout(() => setCopy('idle'), 2500)
  }

  function downloadApproved() {
    const now = new Date()
    saveFile(approvedFileName(now), approvedFile(result, approved, now))
  }

  return (
    <section className="sheet__bar" aria-label="판정 현황과 저장">
      <p className="sheet__tally" aria-live="polite">
        <strong>{decided.length === candidates.length ? `${candidates.length}개 모두 판정했습니다` : `${candidates.length}개 중 ${decided.length}개 판정`}</strong>
        {tally.length > 0 && <span> · {tally.join(' · ')}</span>}
      </p>
      <div className="sheet__bar-actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={copyApproved} disabled={!approved.length}>
          {COPY_LABEL[copy]}
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={downloadApproved} disabled={!approved.length}>
          승인 문항 파일로 받기
        </button>
        <Link to="/new" state={again} className="btn btn--sm">
          같은 원문으로 다시 만들기
        </Link>
      </div>
      <p className="field__hint sheet__bar-hint">사용 승인한 후보를 복사하거나 파일로 받을 수 있습니다. 탭을 닫으면 이 결과는 사라집니다.</p>
    </section>
  )
}
