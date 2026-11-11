import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check, Circle, CircleAlert, ImageUp, Sigma, X } from 'lucide-react'
import { MathText } from '../components/Math'
import { api } from '../api'
import { SAMPLE_SOURCE } from '../api/fixtures'
import { CURRICULUM_OPTIONS, DEFAULT_INTENDED_USE, DEFAULT_TARGET_LEVEL } from '../api/config'
import type { GenerationRequest } from '../api/types'

type Mode = 'text' | 'image'
interface PartState {
  mode: Mode
  text: string
  file: File | null
  preview: string | null
}

const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT = ['image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp']

const empty = (): PartState => ({ mode: 'text', text: '', file: null, preview: null })
const hasContent = (p: PartState) => (p.mode === 'text' ? p.text.trim().length > 0 : !!p.file)

export function NewRequest() {
  const navigate = useNavigate()
  const [problem, setProblem] = useState<PartState>(empty)
  const [explanation, setExplanation] = useState<PartState>(empty)
  const [scope, setScope] = useState<string>(CURRICULUM_OPTIONS[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const problemRef = useRef<HTMLDivElement>(null)

  const problemOk = hasContent(problem)
  const explanationOk = hasContent(explanation)
  const ready = problemOk && explanationOk

  useEffect(() => {
    const dirty = problem.text || explanation.text || problem.file || explanation.file
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [problem, explanation])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!ready) {
      setError(!problemOk ? '원문 문항을 이미지나 텍스트로 넣어 주세요.' : '원문 해설이 있어야 풀이 요소를 찾을 수 있습니다.')
      problemRef.current?.querySelector<HTMLElement>('textarea, input')?.focus()
      return
    }
    setError(null)
    setSubmitting(true)
    const req: GenerationRequest = {
      source_question: {
        problem: { text: problem.mode === 'text' ? problem.text : undefined, image: problem.mode === 'image' ? problem.file : null },
        explanation: { text: explanation.mode === 'text' ? explanation.text : undefined, image: explanation.mode === 'image' ? explanation.file : null },
      },
      intended_use: DEFAULT_INTENDED_USE,
      target_level: DEFAULT_TARGET_LEVEL,
      curriculum_scope: scope,
    }
    try {
      const { jobId } = await api.createJob(req)
      navigate(`/jobs/${jobId}`)
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof Error ? err.message : '요청을 보내지 못했습니다. 다시 시도해 주세요.')
    }
  }

  function fillSample() {
    setProblem({ mode: 'text', text: SAMPLE_SOURCE.statement, file: null, preview: null })
    setExplanation({ mode: 'text', text: SAMPLE_SOURCE.solution, file: null, preview: null })
    setScope('수학Ⅱ')
  }

  return (
    <div className="screen">
      <div className="container section--tight" style={{ paddingBlock: 'var(--space-xl) var(--section-gap)' }}>
        <div className="page-head">
          <div>
            <h1>원문과 해설을 올려 주세요.</h1>
            <p className="lead" style={{ marginTop: 'var(--space-sm)' }}>
              지금은 수식·텍스트 입력만 쓸 수 있습니다. 이미지 입력은 준비 중입니다.
            </p>
          </div>
          <div className="page-head__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={fillSample}>
              예시 원문 채우기
            </button>
          </div>
        </div>

        <form className="compose" onSubmit={onSubmit} noValidate>
          <div className="compose__main">
            <div ref={problemRef}>
              <SourcePartEditor
                title="원문 문항"
                hint="문항 본문. 수식은 $ … $ 안에 LaTeX로 적으면 미리보기에 렌더링됩니다."
                placeholder="예) 함수 $f(x)$의 도함수가 $f'(x) = 3 - 3x^2$ 이고 $f(0) = 2$ 일 때, 함수 $f(x)$의 극댓값을 구하시오…"
                value={problem}
                onChange={setProblem}
                invalid={touched && !problemOk}
                name="problem"
              />
            </div>
            <SourcePartEditor
              title="원문 해설"
              hint="풀이 요소는 해설에서 찾습니다. 도함수 계산처럼 한 가지 행동만 적힌 해설이면 후보를 만들지 않습니다."
              placeholder="예) $f'(x)$의 부호가 $x=1$에서 양에서 음으로 바뀌므로 극대이다. 적분하여 $f(x)$를 구하고…"
              value={explanation}
              onChange={setExplanation}
              invalid={touched && !explanationOk}
              name="explanation"
            />
          </div>

          <aside className="compose__aside">
            <ul className="checklist" aria-label="제출 전 확인">
              <CheckItem ok={problemOk}>원문 문항이 있습니다</CheckItem>
              <CheckItem ok={explanationOk}>원문 해설이 있습니다</CheckItem>
            </ul>

            <label className="field">
              <span className="field__label">교육과정 범위</span>
              <select name="curriculum_scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                {CURRICULUM_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="submit-row">
              {error && (
                <div className="form-error" role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
              <button type="submit" className="btn btn--lg btn--block" disabled={submitting} aria-disabled={submitting}>
                {submitting ? '보내는 중…' : '풀이 요소 추출하고 후보 만들기'}
                {!submitting && <ArrowRight aria-hidden="true" />}
              </button>
              <span className="field__hint">몇 분 걸릴 수 있습니다. 두 요소를 찾지 못하면 후보 없이 이유만 돌려줍니다.</span>
            </div>
          </aside>
        </form>
      </div>
    </div>
  )
}

function CheckItem({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li data-ok={ok}>
      {ok ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
      <span>{children}</span>
      <span className="visually-hidden">{ok ? ' 완료' : ' 미완료'}</span>
    </li>
  )
}

function SourcePartEditor({
  title,
  hint,
  placeholder,
  value,
  onChange,
  invalid,
  name,
}: {
  title: string
  hint: string
  placeholder: string
  value: PartState
  onChange: (v: PartState) => void
  invalid: boolean
  name: string
}) {
  const id = useId()
  const [over, setOver] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => () => {
    if (value.preview) URL.revokeObjectURL(value.preview)
  }, [value.preview])

  function takeFile(file: File | undefined) {
    if (!file) return
    if (!ACCEPT.includes(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
      setFileError('PNG, JPG, HEIC, WebP 이미지만 받습니다.')
      return
    }
    if (file.size > MAX_BYTES) {
      setFileError('20 MB 이하 이미지만 받습니다. 한 문항만 담은 이미지로 줄여 주세요.')
      return
    }
    setFileError(null)
    if (value.preview) URL.revokeObjectURL(value.preview)
    onChange({ ...value, file, preview: file.type.startsWith('image/') && !/heic|heif/.test(file.type) ? URL.createObjectURL(file) : null })
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setOver(false)
    takeFile(e.dataTransfer.files?.[0])
  }
  function onPick(e: ChangeEvent<HTMLInputElement>) {
    takeFile(e.target.files?.[0])
    e.target.value = ''
  }

  const previewText = value.text.trim()
  const tabs: { id: Mode; label: string; icon: typeof Sigma }[] = useMemo(
    () => [
      { id: 'text', label: '수식·텍스트', icon: Sigma },
      { id: 'image', label: '이미지', icon: ImageUp },
    ],
    [],
  )

  return (
    <section className="part" aria-labelledby={`${id}-title`}>
      <div className="part__head">
        <h2 id={`${id}-title`}>{title}</h2>
      </div>
      <div className="tabs" role="tablist" aria-label={`${title} 입력 방식`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-tab-${t.id}`}
            className="tabs__btn"
            aria-selected={value.mode === t.id}
            aria-controls={`${id}-panel`}
            onClick={() => onChange({ ...value, mode: t.id })}
          >
            <t.icon aria-hidden="true" />
            {t.label}
            {value.mode === t.id && (
              <motion.span layoutId={`${id}-line`} className="tabs__line" style={{ left: 0, right: 0 }} transition={reduce ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0 }} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <div className="part__body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${value.mode}`}>
        {value.mode === 'text' ? (
          <div className="field">
            <label className="visually-hidden" htmlFor={`${id}-text`}>
              {title} 텍스트
            </label>
            <textarea
              id={`${id}-text`}
              name={`${name}_text`}
              className="textarea textarea--math"
              value={value.text}
              onChange={(e) => onChange({ ...value, text: e.target.value })}
              placeholder={placeholder}
              aria-invalid={invalid}
              aria-describedby={`${id}-hint`}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="field__hint" id={`${id}-hint`}>
              {hint}
            </span>
            <div className="preview" data-empty={!previewText} aria-live="polite" aria-label="수식 미리보기">
              {previewText ? <MathText text={previewText} /> : '입력하면 여기에 렌더링된 수식이 보입니다.'}
            </div>
          </div>
        ) : (
          <div className="field">
            <div
              className="drop"
              data-over={over}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              {value.file ? (
                <div className="drop__file">
                  {value.preview ? <img className="drop__thumb" src={value.preview} alt="" width={64} height={64} /> : <span className="drop__thumb" aria-hidden="true" />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="drop__name">{value.file.name}</div>
                    <small>{(value.file.size / 1024 / 1024).toFixed(1)}&nbsp;MB</small>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="이미지 제거"
                    onClick={(e) => {
                      e.preventDefault()
                      onChange({ ...value, file: null, preview: null })
                    }}
                    style={{ position: 'relative', zIndex: 1 }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="drop__icon">
                    <ImageUp aria-hidden="true" />
                  </span>
                  <strong>이미지를 여기에 놓거나 눌러서 고르세요</strong>
                  <small>PNG, JPG, HEIC, WebP. 20&nbsp;MB 이하, 한 이미지에 한 문항.</small>
                </>
              )}
              <input type="file" name={`${name}_image`} accept="image/*,.heic,.heif" onChange={onPick} aria-label={`${title} 이미지 선택`} aria-invalid={invalid} />
            </div>
            {fileError ? (
              <span className="field__error" role="alert">
                {fileError}
              </span>
            ) : (
              <span className="field__hint">인쇄물이나 태블릿 화면이 사진보다 정확하게 읽힙니다.</span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
