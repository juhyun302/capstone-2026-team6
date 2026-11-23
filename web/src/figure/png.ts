// SVG -> PNG in the browser, with the resolution written into the file (pHYs) so a document
// places it at its real size, as the kit's export does.

import { renderFigure } from './render'
import type { FigureSpec } from './types'
import { crc32 } from './zip'

async function withDpi(blob: Blob, dpi: number): Promise<Blob> {
  const png = new Uint8Array(await blob.arrayBuffer())
  const chunk = new Uint8Array(21)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, 9)
  chunk.set(new TextEncoder().encode('pHYs'), 4)
  const perMetre = Math.round(dpi / 0.0254)
  view.setUint32(8, perMetre)
  view.setUint32(12, perMetre)
  chunk[16] = 1
  view.setUint32(17, crc32(chunk.subarray(4, 17)))
  // signature (8) + IHDR (25), then pHYs
  return new Blob([png.slice(0, 33), chunk, png.slice(33)], { type: 'image/png' })
}

export async function svgToPng(svg: string, widthMm: number, heightMm: number, dpi: number): Promise<Blob> {
  const width = Math.max(1, Math.round((widthMm / 25.4) * dpi))
  const height = Math.max(1, Math.round((heightMm / 25.4) * dpi))
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('그림을 PNG로 바꾸지 못했습니다.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그림을 PNG로 바꾸지 못했습니다.'))), 'image/png'))
  return withDpi(blob, dpi)
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** The picture a model is shown: 200dpi is enough to read 11pt labels. */
export async function figurePng(spec: FigureSpec, dpi = 200): Promise<string> {
  const drawn = renderFigure(spec, { uid: 'model' })
  return dataUrl(await svgToPng(drawn.svg, drawn.width_mm, drawn.height_mm, dpi))
}
