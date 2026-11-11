import type { CandidateQuestion, GenerationResult } from '../../api/types'
import { escapeHtml, mathHtml, statementHtml } from '../../components/Math'

// What leaves the app after a person approves: LaTeX text to paste, or one HTML file to keep.

export interface Approved {
  /** The number the candidate has on screen. */
  number: number
  candidate: CandidateQuestion
}

export function approvedOf(candidates: CandidateQuestion[]): Approved[] {
  return candidates.flatMap((candidate, index) => (candidate.review_result.approval_status === 'APPROVED' ? [{ number: index + 1, candidate }] : []))
}

export function approvedText(approved: Approved[]) {
  return approved.map(({ number, candidate }) => `[후보 ${number}]\n${candidate.statement}\n\n[풀이]\n${candidate.solution}`).join('\n\n')
}

const pad = (n: number) => String(n).padStart(2, '0')

export function approvedFileName(now: Date) {
  return `Aleph_승인문항_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.html`
}

const STYLE = `
body { margin: 0; background: #fff; color: #1c2430; font: 16px/1.8 "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 48px 24px 72px; }
h1 { margin: 0; font-size: 1.6rem; line-height: 1.3; }
.meta { margin-top: 8px; color: #5b6575; font-size: 0.9rem; }
section { margin-top: 40px; padding-top: 24px; border-top: 1px solid #d9dee6; }
h2 { margin: 0 0 12px; font-size: 1.1rem; }
h3 { margin: 20px 0 8px; color: #5b6575; font-size: 0.95rem; }
p { margin: 0; white-space: pre-wrap; overflow-wrap: break-word; }
math { font-size: 1.1em; }
.math-line { display: block; }
.math-conds { display: block; margin: 12px 0; padding: 10px 14px; border: 1px solid #5b6575; }
.math-cond { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 6px; }
@media print { main { max-width: none; padding: 0; } section { break-inside: avoid; } }
`

/** A complete page with no outside files: formulas are MathML, which browsers draw themselves. */
export function approvedFile(result: GenerationResult, approved: Approved[], now: Date) {
  const paragraph = (text: string) => `<p>${mathHtml(text, 'mathml')}</p>`
  const question = (text: string) => `<p>${statementHtml(text, 'mathml')}</p>`
  const items = approved.map(({ number, candidate }) => `<section><h2>후보 ${number}</h2>${question(candidate.statement)}<h3>풀이</h3>${paragraph(candidate.solution)}</section>`)
  const meta = `${now.toLocaleString('ko-KR')} 저장 · 교육과정 범위 ${escapeHtml(result.request.curriculum_scope)} · 사용 승인 ${approved.length}개`
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aleph 승인 문항</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Aleph 승인 문항</h1>
<p class="meta">${meta}</p>
${items.join('\n')}
<section><h2>원문 문항</h2>${question(result.request.source.statement)}</section>
</main>
</body>
</html>
`
}
