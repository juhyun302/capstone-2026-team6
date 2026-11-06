import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

// Renders a Korean sentence with $...$ and $$...$$ formulas through KaTeX.
// Anything KaTeX cannot parse is shown as the raw text instead of thrown.

const SPLIT = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g

function renderTex(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' })
  } catch {
    return null
  }
}

export function MathText({ text, className, as: Tag = 'p' }: { text: string; className?: string; as?: 'p' | 'span' | 'div' }) {
  const html = useMemo(() => {
    const parts = text.split(SPLIT)
    return parts
      .map((part) => {
        if (part.startsWith('$$') && part.endsWith('$$')) return renderTex(part.slice(2, -2), true) ?? escape(part)
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return renderTex(part.slice(1, -1), false) ?? escape(part)
        return escape(part)
      })
      .join('')
  }, [text])
  return <Tag className={`math${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
