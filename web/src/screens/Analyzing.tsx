import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import { api, apiMode } from '../api'
import type { JobEvent, JobStage, QuestionError, SolutionIdea } from '../api/types'
import { MathText } from '../components/Math'
import { NodeGraph } from '../components/graph/NodeGraph'
import { STAGE_NAME, failedStage } from '../components/graph/model'
import { estimate, type Mark } from './progress'

// The waiting screen. A node graph shows where the job is and who is working
// (AI, code, a person); ink light travels the wires as real stage events
// arrive. Under it, a bar from finished model calls and expected step times.
// Below that, the source and what has been found so far.

const HEADING: Record<JobStage, string> = {
  read: '풀이 요소를 찾는 중입니다.',
  extract: '풀이 요소를 찾는 중입니다.',
  validate: '풀이 요소를 확인하는 중입니다.',
  generate: '후보 문항을 만드는 중입니다.',
  review: '후보를 검토하는 중입니다.',
  done: '검토 결과를 엽니다.',
  error: '후보를 만들지 않았습니다.',
}

const NOW_SENTENCE: Record<JobStage, string> = {
  read: '이미지 속 문항과 수식을 읽고 텍스트와 대조하고 있습니다.',
  extract: '해설에서 핵심 개념, 서로 다른 핵심 풀이 요소 두 개, 두 요소의 연결을 찾고 있습니다.',
  validate: '파서 출력이 SolutionIdea 스키마와 필수 값 규칙을 지키는지 확인하고 있습니다.',
  generate: '정해진 교육과정 범위 안에서 두 요소의 메커니즘을 응용한 후보 문항과 풀이를 만들고 있습니다.',
  review: '조건 누락, 경계값, 정의역, 교육과정 이탈을 검토하고 근거를 적고 있습니다.',
  done: '잠정 검토까지 끝났습니다. 검토 결과를 엽니다.',
  error: '',
}

const STAGE_ORDER: JobStage[] = ['read', 'extract', 'validate', 'generate', 'review', 'done']

/** How long each stage took, from the first event of one stage to the first of the next. */
function stageDurations(marks: Mark[]) {
  const starts: { stage: JobStage; at: number }[] = []
  for (const { at, event } of marks) {
    if (STAGE_ORDER.includes(event.stage) && !starts.some((s) => s.stage === event.stage)) starts.push({ stage: event.stage, at })
  }
  const durations: Partial<Record<string, number>> = {}
  starts.forEach((s, i) => {
    if (starts[i + 1]) durations[s.stage] = starts[i + 1].at - s.at
  })
  return durations
}

export function Analyzing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [stage, setStage] = useState<JobStage>('read')
  const [failedAt, setFailedAt] = useState<JobStage | undefined>()
  const [idea, setIdea] = useState<Partial<SolutionIdea>>({})
  const [error, setError] = useState<QuestionError | null>(null)
  const [statement, setStatement] = useState('')
  const [marks, setMarks] = useState<Mark[]>([])
  const [now, setNow] = useState(() => Date.now())
  const lastStage = useRef<JobStage>('read')
  const running = !error && stage !== 'done'

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    let done = false
    // the stream replays from the first event, so a remount starts the timeline over
    setMarks([])
    lastStage.current = 'read'
    ;(async () => {
      try {
        for await (const ev of api.jobEvents(id, ctrl.signal)) {
          if (ctrl.signal.aborted) return
          apply(ev)
          if (ev.stage === 'done' && ev.result_id) {
            done = true
            setTimeout(() => navigate(`/results/${ev.result_id}`, { replace: true }), 1400)
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError({ status: 'SERVER_ERROR', error_code: 'STREAM_FAILED', reason: '진행 상태를 받지 못했습니다. 다시 시도해 주세요.' })
      }
    })()
    function apply(ev: JobEvent) {
      setMarks((prev) => [...prev, { at: ev.at ?? Date.now(), event: ev }])
      if (ev.stage === 'error') setFailedAt(lastStage.current)
      else lastStage.current = ev.stage
      setStage(ev.stage)
      if (ev.source_statement) setStatement(ev.source_statement)
      if (ev.solution_idea) setIdea((prev) => ({ ...prev, ...ev.solution_idea }))
      if (ev.error) setError(ev.error)
    }
    return () => {
      if (!done) ctrl.abort()
    }
  }, [id, navigate])

  // In the browser build the job lives in this tab; leaving it mid-run throws the work away.
  useEffect(() => {
    if (apiMode !== 'browser' || !running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const durations = useMemo(() => stageDurations(marks), [marks])
  const started = marks[0]?.at
  const ended = marks.length && !running ? marks[marks.length - 1].at : now
  const elapsed = started ? Math.max(0, ended - started) : 0
  const mm = Math.floor(elapsed / 60000)
  const ss = Math.floor((elapsed % 60000) / 1000)
  const busy = !error && (stage === 'generate' || stage === 'review')
  const failedName = error ? STAGE_NAME[failedStage(error, failedAt)] : null

  return (
    <div className="screen">
      <div className="container" style={{ paddingBlock: 'var(--space-xl) var(--section-gap)' }}>
        <div className="page-head">
          <div>
            <h1>{error ? HEADING.error : HEADING[stage]}</h1>
            <p className="lead" style={{ marginTop: 'var(--space-sm)' }} aria-live="polite">
              {error ? `${failedName} 단계에서 멈췄습니다. ${error.reason}` : NOW_SENTENCE[stage]}
            </p>
          </div>
          <p className="elapsed num" aria-label="경과 시간">
            <span className="elapsed__v">
              {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </span>
            <span className="elapsed__k">{error ? '중단까지' : stage === 'done' ? '걸린 시간' : '경과'}</span>
          </p>
        </div>

        {/* after a failure the graph keeps the stage it failed in, so the stages before it stay done */}
        <NodeGraph stage={error && failedAt ? failedAt : stage} idea={idea} error={error} failedAt={failedAt} durations={durations} />
        {!error && <JobProgress marks={marks} running={running} now={now} />}

        <div className="job">
          <aside className="job__source" aria-label="원문" data-busy={busy}>
            <span className="job__ring" aria-hidden="true" />
            <span className="job__sheen" aria-hidden="true" />
            <h2>원문</h2>
            <MathText text={statement} className="math--statement" />
          </aside>

          <div className="job__found">
            {error ? (
              <div className="job__error" role="alert">
                <h2>
                  <CircleAlert aria-hidden="true" style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6, width: 18, height: 18 }} />
                  {error.status === 'SERVER_ERROR'
                    ? '모델을 호출하지 못했습니다'
                    : error.status === 'OUTPUT_ERROR'
                      ? '모델 출력을 쓸 수 없습니다'
                      : error.error_code === 'MISSING_ELEMENTS' || error.error_code === 'MISSING_MECHANISM'
                        ? '문항 오류로 처리했습니다'
                        : '확인이 필요합니다'}
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

function remainingText(seconds: number | null) {
  if (seconds === null) return '거의 끝났습니다'
  if (seconds < 60) return '1분 안쪽 남음'
  return `약 ${Math.round(seconds / 60)}분 남음`
}

/** A bar from finished model calls and expected step times; it never moves back. */
function JobProgress({ marks, running, now }: { marks: Mark[]; running: boolean; now: number }) {
  const shown = useRef(0)
  const progress = estimate(marks, running ? now : Date.now())
  shown.current = Math.max(shown.current, progress.fraction)
  const percent = Math.floor(shown.current * 100)
  return (
    <div className="jobbar">
      <div className="jobbar__head">
        <span className="jobbar__label">{progress.label}</span>
        <span className="jobbar__pct">{percent}%</span>
      </div>
      <div
        className="jobbar__track"
        role="progressbar"
        aria-label="진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%, ${progress.label}`}
      >
        <div className="jobbar__fill" style={{ transform: `scaleX(${shown.current})` }} />
      </div>
      <div className="jobbar__meta">
        <span>{running ? remainingText(progress.remainingSeconds) : '완료'}</span>
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
