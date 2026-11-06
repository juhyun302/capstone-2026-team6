import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, CircleAlert } from 'lucide-react'
import { animate, svg, stagger, utils } from 'animejs'
import { jobEvents } from '../api/mock'
import type { JobEvent, JobStage, QuestionError, SolutionIdea } from '../api/types'
import { MathText } from '../components/Math'
import { SAMPLE_SOURCE } from '../api/fixtures'

const STAGES: { id: JobStage; title: string; detail: string }[] = [
  { id: 'read', title: '원문과 해설 읽기', detail: '이미지 속 문항과 수식을 읽고 텍스트와 대조합니다.' },
  { id: 'extract', title: '풀이 요소 추출', detail: '핵심 개념, 서로 다른 핵심 풀이 요소 두 개, 두 요소의 연결을 찾습니다.' },
  { id: 'generate', title: '후보 문항 생성', detail: '정해진 교육과정 범위 안에서 두 요소의 메커니즘을 응용합니다.' },
  { id: 'review', title: '잠정 검토', detail: '조건 누락, 경계값, 정의역, 교육과정 이탈을 검토합니다.' },
]
const ORDER: JobStage[] = ['read', 'extract', 'generate', 'review', 'done']

export function Analyzing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [stage, setStage] = useState<JobStage>('read')
  const [idea, setIdea] = useState<Partial<SolutionIdea>>({})
  const [error, setError] = useState<QuestionError | null>(null)

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
            setTimeout(() => navigate(`/results/${ev.result_id}`, { replace: true }), 700)
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError({ status: 'QUESTION_ERROR', error_code: 'UNREADABLE_INPUT', reason: '진행 상태를 받지 못했습니다. 다시 시도해 주세요.' })
      }
    })()
    function apply(ev: JobEvent) {
      setStage(ev.stage)
      if (ev.solution_idea) setIdea((prev) => ({ ...prev, ...ev.solution_idea }))
      if (ev.error) setError(ev.error)
    }
    return () => {
      if (!done) ctrl.abort()
    }
  }, [id, navigate])

  const idx = ORDER.indexOf(stage)
  const stateOf = (s: JobStage): 'done' | 'active' | 'pending' | 'error' => {
    const i = ORDER.indexOf(s)
    if (error) return i < errorIndex(error) ? 'done' : i === errorIndex(error) ? 'error' : 'pending'
    if (i < idx) return 'done'
    if (i === idx) return 'active'
    return 'pending'
  }

  return (
    <div className="screen">
      <div className="container" style={{ paddingBlock: 'var(--space-xl) var(--section-gap)' }}>
        <div className="page-head">
          <div>
            <h1>{error ? '후보를 만들지 않았습니다.' : stage === 'done' ? '검토 결과를 엽니다.' : '풀이 요소를 찾는 중입니다.'}</h1>
            <p className="lead" style={{ marginTop: 'var(--space-sm)' }} aria-live="polite">
              {error ? error.reason : stage === 'done' ? '잠정 검토까지 끝났습니다.' : '두 요소와 연결이 확인되면 후보를 만들고 잠정 검토까지 이어서 합니다.'}
            </p>
          </div>
        </div>

        <div className="job">
          <aside className="job__source" aria-label="원문" data-busy={!error && (stage === 'generate' || stage === 'review')}>
            <span className="job__ring" aria-hidden="true" />
            <span className="job__sheen" aria-hidden="true" />
            <h2>원문</h2>
            <MathText text={SAMPLE_SOURCE.statement} className="math--statement" />
            <ElementDiagram idea={idea} stage={stage} errored={!!error} />
          </aside>

          <div>
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
            ) : null}

            <ol className="steps" aria-label="진행 단계" style={{ marginTop: error ? 'var(--space-xl)' : 0 }}>
              {STAGES.map((s) => {
                const state = stateOf(s.id)
                return (
                  <li key={s.id} className="step" data-state={state}>
                    <span className="step__mark" aria-hidden="true">
                      {state === 'done' ? <Check /> : state === 'error' ? <CircleAlert /> : ORDER.indexOf(s.id) + 1}
                    </span>
                    <div className="step__body">
                      <span className="step__title">
                        {s.title}
                        <span className="visually-hidden">{state === 'done' ? ', 완료' : state === 'active' ? ', 진행 중' : state === 'error' ? ', 중단' : ''}</span>
                      </span>
                      <span className="step__detail">{s.detail}</span>
                      {s.id === 'extract' && (state === 'active' || state === 'done' || state === 'error') && <IdeaLines idea={idea} />}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function errorIndex(error: QuestionError) {
  return error.error_code === 'UNREADABLE_INPUT' || error.error_code === 'INPUT_CONFLICT' ? 0 : 1
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

/**
 * Two element nodes, a mechanism line between them, a candidate node they
 * feed: drawn on by anime.js as the parser reports each part. Named as a
 * diagram of the real system (SolutionIdea → Question CANDIDATE).
 */
function ElementDiagram({ idea, stage, errored }: { idea: Partial<SolutionIdea>; stage: JobStage; errored: boolean }) {
  const ref = useRef<SVGSVGElement>(null)
  const drawn = useRef<Set<string>>(new Set())
  const e1 = !!idea.key_elements?.[0]
  const e2 = !!idea.key_elements?.[1]
  const mech = !!idea.mechanism
  const cand = ['generate', 'review', 'done'].includes(stage)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (selector: string, duration = 700) => {
      if (drawn.current.has(selector)) return
      drawn.current.add(selector)
      const paths = root.querySelectorAll<SVGPathElement>(selector)
      if (!paths.length) return
      if (reduce) {
        utils.set(paths, { opacity: 1 })
        return
      }
      animate(svg.createDrawable(paths), { draw: ['0 0', '0 1'], duration, delay: stagger(120), ease: 'inOutSine' })
      utils.set(paths, { opacity: 1 })
    }
    const pop = (selector: string) => {
      if (drawn.current.has(selector)) return
      drawn.current.add(selector)
      const nodes = root.querySelectorAll(selector)
      if (!nodes.length) return
      if (reduce) {
        utils.set(nodes, { opacity: 1 })
        return
      }
      animate(nodes, { opacity: [0, 1], scale: [0.96, 1], duration: 360, ease: 'outQuad', delay: stagger(80) })
    }
    if (e1) pop('[data-node="e1"]')
    if (e2) pop('[data-node="e2"]')
    if (mech) {
      draw('[data-path="mech"]', 800)
      pop('[data-node="mech-label"]')
    }
    if (cand) {
      draw('[data-path="to-cand"]', 600)
      pop('[data-node="cand"]')
    }
  }, [e1, e2, mech, cand])

  return (
    <svg ref={ref} className="diagram" viewBox="0 0 360 150" role="img" aria-label="풀이 요소 두 개와 메커니즘, 후보 문항으로 이어지는 흐름도">
      <g data-node="e1" style={{ opacity: e1 ? undefined : 0, transformOrigin: '60px 40px' }}>
        <rect className="diagram__node" x="8" y="22" width="104" height="36" rx="8" data-on={e1} />
        <text x="60" y="45" textAnchor="middle">
          요소 1
        </text>
      </g>
      <g data-node="e2" style={{ opacity: e2 ? undefined : 0, transformOrigin: '60px 112px' }}>
        <rect className="diagram__node" x="8" y="94" width="104" height="36" rx="8" data-on={e2} />
        <text x="60" y="117" textAnchor="middle">
          요소 2
        </text>
      </g>
      <path className="diagram__path" data-path="mech" d="M60 58 V94" style={{ opacity: mech ? undefined : 0 }} />
      <text className="diagram__label" x="72" y="80" data-node="mech-label" style={{ opacity: mech ? undefined : 0 }}>
        메커니즘
      </text>
      <path className="diagram__path" data-path="to-cand" d="M112 40 H150 Q170 40 170 60 V76 H236" style={{ opacity: cand ? undefined : 0 }} />
      <path className="diagram__path" data-path="to-cand" d="M112 112 H150 Q170 112 170 92 V76" style={{ opacity: cand ? undefined : 0 }} />
      <g data-node="cand" style={{ opacity: cand ? undefined : 0, transformOrigin: '296px 76px' }}>
        <rect className="diagram__node" x="236" y="58" width="116" height="36" rx="8" data-on={cand} />
        <text x="294" y="81" textAnchor="middle">
          {errored ? '후보 없음' : '후보 문항'}
        </text>
      </g>
    </svg>
  )
}
