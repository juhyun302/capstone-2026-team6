// Figure labels as SVG paths through MathJax, so a figure is one self-contained SVG: it can be
// saved, put in a file, and turned into a PNG for the model without any font files.
// Loaded only when a figure is drawn.

import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams'] }), OutputJax: new SVG({ fontCache: 'none' }) })

export interface TexBox {
  /** The MathJax drawing, to go inside an <svg> with `viewBox`. */
  body: string
  viewBox: [number, number, number, number]
  /** In mm for a font of `em` mm. */
  width: number
  ascent: number
  descent: number
  /** MathJax could not read the TeX; the drawing shows its error message. */
  failed: boolean
}

const cache = new Map<string, Omit<TexBox, 'width' | 'ascent' | 'descent'>>()

export function texBox(tex: string, em: number): TexBox {
  let found = cache.get(tex)
  if (!found) {
    const html: string = adaptor.innerHTML(doc.convert(tex, { display: false }))
    const match = /viewBox="([^"]+)"/.exec(html)
    const viewBox = (match ? match[1].split(/\s+/).map(Number) : [0, -750, 500, 1000]) as [number, number, number, number]
    found = { body: html.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''), viewBox, failed: html.includes('data-mml-node="merror"') }
    cache.set(tex, found)
  }
  const [, minY, width, height] = found.viewBox
  return { ...found, width: (width / 1000) * em, ascent: (-minY / 1000) * em, descent: ((height + minY) / 1000) * em }
}
