import gsap from 'gsap'
import Lenis from 'lenis'

/** Motion system (§6): procedure, never spectacle.
 *  GSAP timelines + Lenis smooth scroll, all guarded by
 *  prefers-reduced-motion. */

export const EASE_COURT = 'cubic-bezier(0.32, 0, 0.12, 1)'
// GSAP custom-ease equivalent of --ease-court
export const easeCourt = (t: number) => {
  // cubic-bezier(0.32, 0, 0.12, 1) approximated via gsap's power curves is
  // not exact; use CustomEase-free numeric bezier.
  return bezier(0.32, 0, 0.12, 1)(t)
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const solve = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-5) break
      const d = (3 * ax * t + 2 * bx) * t + cx
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    return t
  }
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solve(x)))
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

let lenis: Lenis | null = null

export function initLenis(): void {
  if (prefersReducedMotion() || lenis) return
  lenis = new Lenis({ lerp: 0.1 })
  const raf = (time: number) => {
    lenis?.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
}

/** Page load: docket lines draw in left→right — the court opening the file.
 *  That's the entire load sequence (§6). */
export function playDocketOpen(root: HTMLElement): void {
  const rules = root.querySelectorAll<HTMLElement>('.dl-rule, .dl-rule-lead')
  const labels = root.querySelectorAll<HTMLElement>('.dl-label')
  if (prefersReducedMotion()) return
  gsap.fromTo(rules, { scaleX: 0 }, {
    scaleX: 1, duration: 0.32, ease: easeCourt, stagger: 0.06,
  })
  gsap.fromTo(labels, { opacity: 0 }, {
    opacity: 1, duration: 0.32, ease: easeCourt, stagger: 0.06,
  })
}

/** Criterion rows: reveal top→bottom, dots stamping in (§6). */
export function playCriteriaReveal(root: HTMLElement): void {
  const rows = root.querySelectorAll<HTMLElement>('.criterion-row')
  const dots = root.querySelectorAll<HTMLElement>('.criterion-dot')
  if (prefersReducedMotion() || rows.length === 0) return
  gsap.fromTo(rows, { opacity: 0, y: 6 }, {
    opacity: 1, y: 0, duration: 0.32, ease: easeCourt, stagger: 0.09,
  })
  gsap.fromTo(dots, { scale: 1.06 }, {
    scale: 1.0, duration: 0.32, ease: easeCourt, stagger: 0.09,
  })
}
