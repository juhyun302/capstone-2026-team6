import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { CandidateQuestion, GenerationResult, Verdict } from '../../api/types'
import { MathText } from '../../components/Math'
import { Seal } from '../../components/Seal'
import { VERDICT_LABEL } from '../../components/Verdict'
import { approvalSentence, checksSentence, DecideRow, ResultHead, sealNote, SourceDialog, useDecisions } from './shared'

// The plain view: candidates in two columns, solution and reasons folded.

const AXIS_LABEL: Record<string, string> = {
  object: '대상',
  condition_form: '조건 구조',
  target: '묻는 것',
  representation: '제시 방식',
  solution_route: '풀이 구성',
}

export function PlainView({ result }: { result: GenerationResult }) {
  const reduce = useReducedMotion()
  const { candidates, decide, busy } = useDecisions(result)
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <article className="sheet">
      <ResultHead onOpenSource={() => dialog.current?.showModal()} />
      <SourceDialog ref={dialog} result={result} />
      <section className="sheet__candidates" aria-label="후보 문항">
        {candidates.map((c, i) => (
          <motion.div key={c.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, delay: 0.08 * i, ease: [0.23, 1, 0.32, 1] }}>
            <Candidate index={i} candidate={c} busy={busy} onDecide={(v) => decide(c, v)} />
          </motion.div>
        ))}
      </section>
    </article>
  )
}

function Fold({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  return (
    <div className="disclose" data-open={open} id={id}>
      <div className="disclose__inner">
        <div className="disclose__panel">{children}</div>
      </div>
    </div>
  )
}

function Candidate({ index, candidate, busy, onDecide }: { index: number; candidate: CandidateQuestion; busy: string | null; onDecide: (v: Verdict) => void }) {
  const [openSolution, setOpenSolution] = useState(false)
  const [openReview, setOpenReview] = useState(false)
  const review = candidate.review_result
  return (
    <section className="cand" aria-labelledby={`cand-${candidate.id}`} data-verdict={review.verdict}>
      <div className="cand__head">
        <h2 id={`cand-${candidate.id}`}>후보 {index + 1}</h2>
        <Seal verdict={review.verdict} note={sealNote(review)} provisional={review.reviewer_type === 'AI'} replayKey={`${review.reviewer_type}-${review.verdict}`} className="cand__seal" />
      </div>
      <p className="cand__verdict-note">{approvalSentence(review)}</p>
      <MathText text={candidate.statement} className="sheet__statement" />
      <div className="cand__tools">
        <button type="button" className="disclose-btn" aria-expanded={openSolution} aria-controls={`sol-${candidate.id}`} onClick={() => setOpenSolution((o) => !o)}>
          {openSolution ? '풀이 닫기' : '풀이 보기'}
          <ChevronDown aria-hidden="true" />
        </button>
        <button type="button" className="disclose-btn" aria-expanded={openReview} aria-controls={`rev-${candidate.id}`} onClick={() => setOpenReview((o) => !o)}>
          {openReview ? '검토 근거 닫기' : '검토 근거 보기'}
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      <div className="cand__folds">
        <Fold id={`sol-${candidate.id}`} open={openSolution}>
          <MathText text={candidate.solution} className="sheet__solution" />
        </Fold>
        <Fold id={`rev-${candidate.id}`} open={openReview}>
          <div className="cand__review">
            <p className="cand__checks">{checksSentence(review)}</p>
            {candidate.surface_check?.copy_suspected && <p className="cand__checks">원문이나 다른 후보와 문장이 거의 같습니다.</p>}
            <MathText text={review.reason} className="cand__reason" />
            {review.reviewer_type !== 'AI' && candidate.ai_review_result && (
              <>
                <h3>AI 잠정 판정: {VERDICT_LABEL[candidate.ai_review_result.verdict]}</h3>
                <MathText text={candidate.ai_review_result.reason} className="cand__reason" />
              </>
            )}
            {candidate.plan && (
              <>
                <h3>설계에서 바꾼 점: {candidate.plan.changed_axes.map((axis) => AXIS_LABEL[axis] ?? axis).join(', ')}</h3>
                <MathText text={candidate.plan.added_judgment} className="cand__reason" />
              </>
            )}
            {candidate.element_trace && (
              <>
                <h3>두 요소가 쓰인 곳</h3>
                <ol className="cand__trace">
                  {candidate.element_trace.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </Fold>
      </div>
      <DecideRow candidate={candidate} busy={busy} onDecide={onDecide} />
    </section>
  )
}
