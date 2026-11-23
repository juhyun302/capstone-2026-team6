import { useEffect, useId, useState } from 'react'
import type { FigureSpec } from '../figure/types'
import type { RenderedFigure } from '../figure/render'

// A candidate's figure on white paper, with what the gap check found and the three files a
// person takes away: SVG, a 600dpi PNG, and the drawing-kit script (zip of .py and .eq.txt).
// The drawing code loads only when a figure is on screen.

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FigureView({ spec, name, label }: { spec: FigureSpec; name: string; label: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [drawn, setDrawn] = useState<RenderedFigure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setDrawn(null)
    setError(null)
    import('../figure/render')
      .then(({ renderFigure }) => {
        if (alive) setDrawn(renderFigure(spec, { uid: `fig${uid}`, title: label }))
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '그림을 그리지 못했습니다.')
      })
    return () => {
      alive = false
    }
  }, [spec, uid, label])

  if (error) return <p className="fig__error">그림을 그리지 못했습니다: {error}</p>
  if (!drawn) return <div className="fig fig--loading" aria-busy="true" aria-label={`${label} 그리는 중`} />

  async function download(kind: 'svg' | 'png' | 'kit') {
    if (!drawn) return
    setBusy(true)
    try {
      if (kind === 'svg') save(`${name}.svg`, new Blob([drawn.svg], { type: 'image/svg+xml' }))
      if (kind === 'png') {
        const { svgToPng } = await import('../figure/png')
        save(`${name}.png`, await svgToPng(drawn.svg, drawn.width_mm, drawn.height_mm, 600))
      }
      if (kind === 'kit') {
        const [{ kitFiles }, { zip }] = await Promise.all([import('../figure/kit'), import('../figure/zip')])
        const files = kitFiles(spec, drawn, name)
        save(`${name}_키트.zip`, zip([{ name: `${name}.py`, text: files.script }, { name: `${name}.eq.txt`, text: files.labels }]))
      }
    } finally {
      setBusy(false)
    }
  }

  const { report } = drawn
  return (
    <figure className="fig">
      {/* shown a little larger than print, where the labels are 11pt; the files keep the real size */}
      <div className="fig__paper" style={{ '--fig-w': `${(drawn.width_mm * 1.25).toFixed(2)}mm` } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      <figcaption className="fig__meta">
        <span className={report.ok ? 'fig__check' : 'fig__check fig__check--warn'} title={report.rows.filter((r) => !r.ok).map((r) => `${r.tex}: ${r.gap.toFixed(2)}mm`).join('\n') || undefined}>
          {report.summary}
          {report.warnings.length ? ` · ${report.warnings.join(' · ')}` : ''}
        </span>
        <span className="fig__files">
          <button type="button" className="disclose-btn" disabled={busy} onClick={() => download('svg')}>SVG</button>
          <button type="button" className="disclose-btn" disabled={busy} onClick={() => download('png')}>PNG 600dpi</button>
          <button type="button" className="disclose-btn" disabled={busy} onClick={() => download('kit')} title="그림 제작 키트(figlib_tikz.py)용 스크립트와 글자 목록. 키트에서 한컴 수식 글자로 다시 만든다">
            키트 스크립트
          </button>
        </span>
      </figcaption>
    </figure>
  )
}
