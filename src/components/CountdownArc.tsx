import gsap from 'gsap'
import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../design/motion'

/** Appeal-window countdown arc (§6). One tween, mounted once: from the
 *  current remaining fraction to zero over the real remaining time,
 *  linear ease — clocks don't ease. Under reduced motion the arc is
 *  redrawn per second by the parent's clock re-render instead. */
export function CountdownArc({ msLeft, totalMs, size = 18 }: {
  msLeft: number
  totalMs: number
  size?: number
}) {
  const circleRef = useRef<SVGCircleElement>(null)
  const r = 7
  const circ = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, msLeft / totalMs))

  useEffect(() => {
    const c = circleRef.current
    if (!c || prefersReducedMotion() || msLeft <= 0) return
    gsap.fromTo(c,
      { strokeDashoffset: circ * (1 - frac) },
      { strokeDashoffset: circ, duration: msLeft / 1000, ease: 'none' })
    return () => { gsap.killTweensOf(c) }
    // Mount-only: the tween runs in real time; re-renders must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden style={{ flex: 'none', alignSelf: 'center' }}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--rule)" strokeWidth="1.5" />
      <circle
        ref={circleRef}
        cx="9" cy="9" r={r}
        fill="none"
        stroke="var(--verdict-partial)"
        strokeWidth="1.5"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}
