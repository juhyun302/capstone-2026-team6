// Fold dist-single/index.html, its one JS file and its one CSS file into a single HTML file
// that opens straight from disk. Fonts are already data URIs (assetsInlineLimit in vite.config.ts).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(web, 'dist-single')
const out = path.join(dist, 'aleph.html')

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const read = (ref) => fs.readFileSync(path.join(dist, ref.replace(/^\.\//, '')), 'utf8')
const used = new Set()

html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, ref) => {
  used.add(ref)
  // a "</script" inside the bundle would end the tag early
  return `<script type="module">${read(ref).replace(/<\/script/gi, '<\\/script')}</script>`
})
html = html.replace(/<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+)">/g, (_, ref) => {
  used.add(ref)
  // every browser that runs this page reads woff2; the woff and ttf copies only add weight
  const css = read(ref).replace(/,\s*url\(data:font\/(?:woff|ttf);base64,[A-Za-z0-9+/=]+\)\s*format\("(?:woff|truetype)"\)/g, '')
  return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
})

const left = html.match(/(?:src|href)="\.\/assets\/[^"]+"/g)
if (left) throw new Error(`not inlined: ${left.join(', ')}`)
if (!used.size) throw new Error('no script or stylesheet found in dist-single/index.html')

fs.writeFileSync(out, html)
console.log(`${path.relative(web, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB  (${[...used].join(', ')})`)
