import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

// Renders a Korean sentence with $...$ and $$...$$ formulas through KaTeX.
// Anything KaTeX cannot parse is shown as the raw text instead of thrown.

const SPLIT = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g

type Output = 'html' | 'mathml'

function renderTex(tex: string, display: boolean, output: Output) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output })
  } catch {
    return null
  }
}

/** 'mathml' needs no stylesheet or fonts, so it suits a saved file; 'html' matches the app's look. */
export function mathHtml(text: string, output: Output = 'html') {
  return text
    .split(SPLIT)
    .map((part) => {
      if (part.startsWith('$$') && part.endsWith('$$')) return renderTex(part.slice(2, -2), true, output) ?? escapeHtml(part)
      if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return renderTex(part.slice(1, -1), false, output) ?? escapeHtml(part)
      return escapeHtml(part)
    })
    .join('')
}

const LABELS = ['가', '나', '다', '라', '마', '바']

/** The statement's lines. Math tokens stay whole, and each (가), (나) starts a line even if written on the running line. */
function statementLines(text: string) {
  let next = 0
  const lines = ['']
  text.replace(/\r\n/g, '\n').split(SPLIT).forEach((part, index) => {
    if (index % 2) {
      lines[lines.length - 1] += part
      return
    }
    const marked = part.replace(/\(([가나다라마바])\)(?=\s)/g, (mark, label: string, at: number) => {
      const before = (lines[lines.length - 1] + part.slice(0, at)).trimEnd()
      // "조건 (나)의" and the like only refer to a condition; the first label must also begin a sentence
      if (label !== LABELS[next] || before.endsWith('조건') || (next === 0 && before && !/[.:\n]$/.test(part.slice(0, at).trimEnd() || before.slice(-1)))) return mark
      next += 1
      return `\n${mark}`
    })
    const [first, ...rest] = marked.split(/\n+/)
    lines[lines.length - 1] += first
    lines.push(...rest)
  })
  return lines.map((line) => line.trim()).filter(Boolean)
}

/** A question as exam papers set it: (가), (나) one per line in a ruled box, the rest line by line. */
export function statementHtml(text: string, output: Output = 'html') {
  const blocks: string[] = []
  let conditions: string[] = []
  const closeBox = () => {
    if (conditions.length) blocks.push(`<span class="math-conds">${conditions.join('')}</span>`)
    conditions = []
  }
  for (const line of statementLines(text)) {
    const label = line.match(/^\(([가나다라마바])\)\s+/)
    if (label) {
      conditions.push(`<span class="math-cond"><span>(${label[1]})</span><span>${mathHtml(line.slice(label[0].length), output)}</span></span>`)
    } else {
      closeBox()
      blocks.push(`<span class="math-line">${mathHtml(line, output)}</span>`)
    }
  }
  closeBox()
  return blocks.join('')
}

export function MathText({ text, className, as: Tag = 'p', statement = false }: { text: string; className?: string; as?: 'p' | 'span' | 'div'; statement?: boolean }) {
  const html = useMemo(() => (statement ? statementHtml(text) : mathHtml(text)), [text, statement])
  return <Tag className={`math${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
