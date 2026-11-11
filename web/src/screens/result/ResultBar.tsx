import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, apiMode } from '../../api'
import { CANDIDATE_COUNTS, MAX_TOTAL_CANDIDATES, MORE_CANDIDATES } from '../../api/config'
import { accessMode, getSettings, setSettings } from '../../api/settings'
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
  const navigate = useNavigate()
  const [copy, setCopy] = useState<keyof typeof COPY_LABEL>('idle')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wanted, setWanted] = useState<number>(MORE_CANDIDATES)
  // a reload clears a secret the viewer did not ask to remember; the result survives it
  const [secret, setSecret] = useState('')
  const secretMissing = apiMode === 'browser' && !getSettings().secret.trim()
  const approved = approvedOf(candidates)
  const decided = candidates.filter((c) => c.review_result.reviewer_type !== 'AI')
  const tally = VERDICTS.flatMap((v) => {
    const count = decided.filter((c) => c.review_result.verdict === v).length
    return count ? [`${DECIDE_LABEL[v]} ${count}`] : []
  })
  const choices = CANDIDATE_COUNTS.filter((n) => candidates.length + n <= MAX_TOTAL_CANDIDATES)
  const more = Math.min(wanted, choices.length)

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

  async function askMore() {
    setAsking(true)
    setError(null)
    try {
      if (secretMissing) setSettings({ ...getSettings(), secret: secret.trim() })
      const { jobId } = await api.createMoreJob(result.id, more)
      navigate(`/jobs/${jobId}`)
    } catch (err) {
      setAsking(false)
      setError(err instanceof Error ? err.message : '요청을 보내지 못했습니다. 다시 시도해 주세요.')
    }
  }

  return (
    <section className="sheet__bar" aria-label="판정 현황과 다음 할 일">
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
        {secretMissing && more > 0 && (
          <input
            type="password"
            className="input sheet__bar-secret"
            placeholder={accessMode === 'password' ? '접속 비밀번호' : 'OpenAI API 키'}
            aria-label={accessMode === 'password' ? '접속 비밀번호' : 'OpenAI API 키'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        )}
        {more > 0 && (
          <select name="more_count" className="select sheet__bar-count" aria-label="더 뽑을 문항 수" value={more} onChange={(e) => setWanted(Number(e.target.value))}>
            {choices.map((n) => (
              <option key={n} value={n}>
                {n}개
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn--sm" onClick={askMore} disabled={asking || more === 0 || (secretMissing && !secret.trim())}>
          {asking ? '보내는 중…' : '같은 유형으로 더 뽑기'}
        </button>
        <Link to="/new" className="btn btn--secondary btn--sm">
          다른 유형으로 처음부터
        </Link>
      </div>
      {error && (
        <p className="field__error sheet__bar-hint" role="alert">
          {error}
        </p>
      )}
      <p className="field__hint sheet__bar-hint">
        사용 승인한 후보를 복사하거나 파일로 받을 수 있습니다. 탭을 닫으면 이 결과는 사라집니다.
        {more === 0 && ` 한 결과의 후보는 ${MAX_TOTAL_CANDIDATES}개까지입니다.`}
      </p>
    </section>
  )
}
