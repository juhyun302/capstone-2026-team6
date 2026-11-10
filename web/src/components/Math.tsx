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

export function MathText({ text, className, as: Tag = 'p' }: { text: string; className?: string; as?: 'p' | 'span' | 'div' }) {
  const html = useMemo(() => mathHtml(text), [text])
  return <Tag className={`math${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
