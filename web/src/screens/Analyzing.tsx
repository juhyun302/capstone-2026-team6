import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import { jobEvents } from '../api/mock'
import type { JobEvent, JobStage, QuestionError, SolutionIdea } from '../api/types'
import { MathText } from '../components/Math'
import { NodeGraph } from '../components/graph/NodeGraph'
import { failedIds } from '../components/graph/model'
import { SAMPLE_SOURCE } from '../api/fixtures'

// The waiting screen. A node graph shows where the job is and who is working
// (AI, code, a person); ink light travels the wires as real stage events
// arrive. Below it, the source and what has been found so far, plus the
// measured time each stage took. Nothing here guesses how long is left.

const NOW_SENTENCE: Record<JobStage, string> = {
  read: '이미지 속 문항과 수식을 읽고 텍스트와 대조하고 있습니다.',
  extract: '해설에서 핵심 개념, 서로 다른 핵심 풀이 요소 두 개, 두 요소의 연결을 찾고 있습니다.',
  validate: '파서 출력이 SolutionIdea 스키마와 필수 값 규칙을 지키는지 확인하고 있습니다.',
  generate: '정해진 교육과정 범위 안에서 두 요소의 메커니즘을 응용한 후보 문항과 풀이를 만들고 있습니다.',
  review: '조건 누락, 경계값, 정의역, 교육과정 이탈을 검토하고 근거를 적고 있습니다.',
  done: '잠정 검토까지 끝났습니다. 검토 결과를 엽니다.',
  error: '',
}

export function Analyzing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [stage, setStage] = useState<JobStage>('read')
  const [idea, setIdea] = useState<Partial<SolutionIdea>>({})
  const [error, setError] = useState<QuestionError | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [durations, setDurations] = useState<Partial<Record<string, number>>>({})
  const startedAt = useRef(performance.now())
  const stageStarted = useRef<{ stage: JobStage; at: number }>({ stage: 'read', at: performance.now() })

  useEffect(() => {
    const t = setInterval(() => setElapsed(performance.now() - startedAt.current), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    let done = false
    ;(async () => {
      try {
        for await (const ev of jobEvents(id, ctrl.signal)) {
          if (ctrl.signal.aborted) return
          apply(ev)
          if (ev.stage === 'done' && ev.result_id) {
            done = true
            setTimeout(() => navigate(`/results/${ev.result_id}`, { replace: true }), 1400)
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError({ status: 'QUESTION_ERROR', error_code: 'UNREADABLE_INPUT', reason: '진행 상태를 받지 못했습니다. 다시 시도해 주세요.' })
      }
    })()
    function apply(ev: JobEvent) {
      setStage((prev) => {
        if (ev.stage !== prev) {
          const now = performance.now()
          const { stage: s, at } = stageStarted.current
          setDurations((d) => ({ ...d, [s]: now - at }))
          stageStarted.current = { stage: ev.stage, at: now }
        }
        return ev.stage
      })
      if (ev.solution_idea) setIdea((prev) => ({ ...prev, ...ev.solution_idea }))
      if (ev.error) setError(ev.error)
    }
    return () => {
      if (!done) ctrl.abort()
    }
  }, [id, navigate])

  const busy = !error && (stage === 'generate' || stage === 'review')
  const mm = Math.floor(elapsed / 60000)
  const ss = Math.floor((elapsed % 60000) / 1000)
  const failedAt = error ? (failedIds(error)[0].startsWith('rd_') ? '읽기' : '풀이 요소 추출') : null

  return (
    <div className="screen">
      <div className="container" style={{ paddingBlock: 'var(--space-xl) var(--section-gap)' }}>
        <div className="page-head">
          <div>
            <h1>{error ? '후보를 만들지 않았습니다.' : stage === 'done' ? '검토 결과를 엽니다.' : '풀이 요소를 찾는 중입니다.'}</h1>
            <p className="lead" style={{ marginTop: 'var(--space-sm)' }} aria-live="polite">
              {error ? `${failedAt} 단계에서 멈췄습니다. ${error.reason}` : NOW_SENTENCE[stage]}
            </p>
          </div>
          <p className="elapsed num" aria-label="경과 시간">
            <span className="elapsed__v">
              {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </span>
            <span className="elapsed__k">{error ? '중단까지' : stage === 'done' ? '걸린 시간' : '경과'}</span>
          </p>
        </div>

        <NodeGraph stage={stage} idea={idea} error={error} durations={durations} />

        <div className="job">
          <aside className="job__source" aria-label="원문" data-busy={busy}>
            <span className="job__ring" aria-hidden="true" />
            <span className="job__sheen" aria-hidden="true" />
            <h2>원문</h2>
            <MathText text={SAMPLE_SOURCE.statement} className="math--statement" />
          </aside>

          <div className="job__found">
            {error ? (
              <div className="job__error" role="alert">
                <h2>
                  <CircleAlert aria-hidden="true" style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6, width: 18, height: 18 }} />
                  {error.error_code === 'MISSING_ELEMENTS' || error.error_code === 'MISSING_MECHANISM' ? '문항 오류로 처리했습니다' : '확인이 필요합니다'}
                </h2>
                <p>{error.reason}</p>
                {error.needs_confirmation && (
                  <ul>
                    {error.needs_confirmation.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                <div className="job__error-actions">
                  <Link to="/new" className="btn btn--sm">
                    원문 다시 올리기
                  </Link>
                  <Link to="/" className="btn btn--secondary btn--sm">
                    처음으로
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <h2>지금까지 찾은 것</h2>
                <IdeaLines idea={idea} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function IdeaLines({ idea }: { idea: Partial<SolutionIdea> }) {
  const e = idea.key_elements
  return (
    <dl className="step__idea">
      <div className="idea-line" data-pending={!idea.concept}>
        <dt>개념</dt>
        <dd>{idea.concept ?? '찾는 중'}</dd>
      </div>
      <div className="idea-line" data-pending={!e?.[0]}>
        <dt>요소 1</dt>
        <dd>{e?.[0] || '찾는 중'}</dd>
      </div>
      <div className="idea-line" data-pending={!e?.[1]}>
        <dt>요소 2</dt>
        <dd>{e?.[1] || '찾는 중'}</dd>
      </div>
      <div className="idea-line" data-pending={!idea.mechanism}>
        <dt>메커니즘</dt>
        <dd>{idea.mechanism || '두 요소의 연결 확인 중'}</dd>
      </div>
    </dl>
  )
}
