// Port of src/aleph/similarity.py: difflib.SequenceMatcher(autojunk=False).ratio()
// on normalized text, with and without numbers masked. A tripwire, not a proof.

export const THRESHOLD = 0.86

function normalized(text: string, masked: boolean): string[] {
  let t = text.replace(/\[\s*[234]\s*점\s*\]/g, '')
  t = t.replace(/\\(?:left|right|displaystyle|,|;|!)/g, '')
  t = t.split('\\dfrac').join('\\frac')
  t = t.replace(/\s+/g, '').toLowerCase()
  if (masked) t = t.replace(/\d+(?:\.\d+)?/g, '#')
  return Array.from(t)
}

function longestMatch(a: string[], b2j: Map<string, number[]>, alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
  let besti = alo
  let bestj = blo
  let bestsize = 0
  let j2len = new Map<number, number>()
  for (let i = alo; i < ahi; i += 1) {
    const next = new Map<number, number>()
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo) continue
      if (j >= bhi) break
      const k = (j2len.get(j - 1) ?? 0) + 1
      next.set(j, k)
      if (k > bestsize) {
        besti = i - k + 1
        bestj = j - k + 1
        bestsize = k
      }
    }
    j2len = next
  }
  return [besti, bestj, bestsize]
}

function ratio(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1
  const b2j = new Map<string, number[]>()
  b.forEach((ch, j) => {
    const list = b2j.get(ch)
    if (list) list.push(j)
    else b2j.set(ch, [j])
  })
  let matches = 0
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!
    const [i, j, k] = longestMatch(a, b2j, alo, ahi, blo, bhi)
    if (!k) continue
    matches += k
    if (alo < i && blo < j) queue.push([alo, i, blo, j])
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
  }
  return (2 * matches) / (a.length + b.length)
}

/** The larger of the plain ratio and the ratio with every number masked. */
export function similarity(left: string, right: string): number {
  if (typeof left !== 'string' || typeof right !== 'string') throw new TypeError('similarity compares two strings')
  const best = Math.max(ratio(normalized(left, false), normalized(right, false)), ratio(normalized(left, true), normalized(right, true)))
  return Math.round(best * 1e4) / 1e4
}
