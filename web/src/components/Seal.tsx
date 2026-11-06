import { useEffect, useRef } from 'react'
import { animate, utils } from 'animejs'
import type { Verdict } from '../api/types'
import { VERDICT_LABEL } from './Verdict'

// The verdict, pressed on like a reviewer's seal. Re-presses when the verdict
// or the reviewer changes (replayKey). Under reduced motion it is simply there.

export function Seal({ verdict, note, replayKey, className, provisional = false }: { verdict: Verdict; note: string; replayKey: string; className?: string; provisional?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  // An AI USE is not an approval (AC7), so it must not read like the instructor's seal.
  const label = provisional && verdict === 'USE' ? '잠정 사용' : VERDICT_LABEL[verdict]
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      utils.set(el, { opacity: 0.92, scale: 1, rotate: -8 })
      return
    }
    utils.set(el, { opacity: 0, scale: 1.4, rotate: -13 })
    const a = animate(el, { opacity: [0, 0.92], scale: [1.4, 1], rotate: [-13, -8], duration: 420, delay: 350, ease: 'outExpo' })
    return () => {
      a.pause()
    }
  }, [replayKey])
  return (
    <span ref={ref} className={`seal${className ? ` ${className}` : ''}`} data-verdict={verdict} data-provisional={provisional} role="img" aria-label={`판정: ${label}. ${note}`}>
      <span>{label}</span>
      <small>{note}</small>
    </span>
  )
}
