import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { Flip } from 'gsap/Flip'
import Lenis from 'lenis'

/** Motion system (§6): procedure, never spectacle.
 *  One GSAP ticker drives everything — timelines and Lenis. All motion is
 *  transform/opacity (plus measured height on expand/collapse), eased by
 *  the single court curve, and killed live when reduced-motion flips on. */

gsap.registerPlugin(CustomEase, Flip)
if (!CustomEase.get('court')) CustomEase.create('court', '0.32,0,0.12,1')

export const EASE_COURT = 'cubic-bezier(0.32, 0, 0.12, 1)'
export const DUR_FAST = 0.16
export const DUR_MOVE = 0.32

/** Numeric court curve — for R3F per-frame math only. DOM tweens use
 *  the registered CustomEase ('court'), which is the exact same curve. */
export const easeCourt = bezier(0.32, 0, 0.12, 1)

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

/* ---------- Reduced motion: live, not a one-time read ---------- */

const rmQuery =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

let reduced = rmQuery?.matches ?? false
const rmListeners = new Set<(reduced: boolean) => void>()

rmQuery?.addEventListener('change', (e) => {
  reduced = e.matches
  if (reduced) {
    // Finish everything instantly and stop smooth scroll.
    gsap.globalTimeline.getChildren(true, true, true).forEach((t) => {
      t.progress(1).kill()
    })
    destroyLenis()
  } else {
    initLenis()
  }
  rmListeners.forEach((cb) => cb(reduced))
})

export function prefersReducedMotion(): boolean {
  return reduced
}

/** Subscribe to live reduced-motion changes. Returns an unsubscribe. */
export function onReducedMotionChange(cb: (reduced: boolean) => void): () => void {
  rmListeners.add(cb)
  return () => rmListeners.delete(cb)
}

/** The ceremony needs a working Canvas; low-memory devices get the
 *  static seal instead (§7 performance rules). */
export function ceremonyCapable(): boolean {
  if (reduced) return false
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return mem === undefined || mem >= 4
}

/* ---------- Lenis, driven by the GSAP ticker ---------- */

let lenis: Lenis | null = null
let lenisTick: ((time: number) => void) | null = null

export function initLenis(): void {
  if (reduced || lenis || typeof window === 'undefined') return
  lenis = new Lenis({ lerp: 0.1 })
  lenisTick = (time) => lenis?.raf(time * 1000)
  gsap.ticker.add(lenisTick)
  gsap.ticker.lagSmoothing(0)
}

export function destroyLenis(): void {
  if (lenisTick) gsap.ticker.remove(lenisTick)
  lenis?.destroy()
  lenis = null
  lenisTick = null
}

export function getLenis(): Lenis | null {
  return lenis
}

/* ---------- Primitives ---------- */

/** Page load: docket lines draw in left→right — the court opening the file.
 *  That's the entire load sequence (§6). */
export function playDocketOpen(root: HTMLElement): void {
  if (reduced) return
  const rules = root.querySelectorAll<HTMLElement>('.dl-rule, .dl-rule-lead')
  const labels = root.querySelectorAll<HTMLElement>('.dl-label')
  gsap.fromTo(rules, { scaleX: 0 }, {
    scaleX: 1, duration: DUR_MOVE, ease: 'court', stagger: 0.06, clearProps: 'transform',
  })
  gsap.fromTo(labels, { autoAlpha: 0 }, {
    autoAlpha: 1, duration: DUR_MOVE, ease: 'court', stagger: 0.06, clearProps: 'opacity,visibility',
  })
}

/** Row cascade: rows rise 8px into place; any dots inside stamp
 *  (scale 1.06 → 1). Returns the timeline for sequencing, or null
 *  when there is nothing to animate. */
export function revealRows(
  rows: ArrayLike<Element>,
  opts: { stagger?: number; y?: number } = {},
): gsap.core.Timeline | null {
  if (reduced || rows.length === 0) return null
  const { stagger = 0.09, y = 8 } = opts
  const dots: Element[] = []
  Array.prototype.forEach.call(rows, (r: Element) => {
    dots.push(...Array.from(r.querySelectorAll('.criterion-dot')))
  })
  const tl = gsap.timeline()
  tl.fromTo(rows, { autoAlpha: 0, y }, {
    autoAlpha: 1, y: 0, duration: DUR_MOVE, ease: 'court', stagger,
    clearProps: 'transform,opacity,visibility',
  })
  if (dots.length > 0) {
    tl.fromTo(dots, { scale: 1.06 }, {
      scale: 1, duration: DUR_MOVE, ease: 'court', stagger, clearProps: 'transform',
    }, 0)
  }
  return tl
}

/** Criterion rows: reveal top→bottom, dots stamping in (§6). */
export function playCriteriaReveal(root: HTMLElement): gsap.core.Timeline | null {
  return revealRows(root.querySelectorAll('.criterion-row'))
}

/** Board cards stagger-rise. Only the first `cap` animate — long lists
 *  must not feel gated behind choreography. */
export function playCardsRise(root: HTMLElement, cap = 8): void {
  if (reduced) return
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.task-card')).slice(0, cap)
  if (cards.length === 0) return
  gsap.fromTo(cards, { autoAlpha: 0, y: 12 }, {
    autoAlpha: 1, y: 0, duration: DUR_MOVE, ease: 'court', stagger: 0.06,
    clearProps: 'transform,opacity,visibility',
  })
}

/** Count a numeric readout up/down inside a fixed-width mono container.
 *  Only textContent changes — never layout. */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  opts: { format?: (n: number) => string; duration?: number; delay?: number; final?: string } = {},
): void {
  const format = opts.format ?? ((n) => String(Math.round(n)))
  const settle = () => { el.textContent = opts.final ?? format(to) }
  if (reduced || from === to) {
    settle()
    return
  }
  const proxy = { v: from }
  gsap.to(proxy, {
    v: to,
    duration: opts.duration ?? DUR_MOVE,
    delay: opts.delay ?? 0,
    ease: 'court',
    onUpdate: () => { el.textContent = format(proxy.v) },
    onComplete: settle,
  })
}

/** FLIP a list reorder: capture, mutate the DOM, settle in 320ms. */
export function flipList(container: HTMLElement, mutate: () => void): void {
  if (reduced) {
    mutate()
    return
  }
  const state = Flip.getState(container.children)
  mutate()
  Flip.from(state, { duration: DUR_MOVE, ease: 'court' })
}

/** Expand a freshly-mounted block from zero measured height. */
export function revealBlock(el: HTMLElement, duration = DUR_FAST): void {
  if (reduced) return
  gsap.from(el, {
    height: 0, autoAlpha: 0, duration, ease: 'court',
    clearProps: 'height,opacity,visibility',
  })
}

/** Collapse a block to zero height, then run the removal. */
export function collapseBlock(el: HTMLElement, onDone: () => void, duration = DUR_FAST): void {
  if (reduced) {
    onDone()
    return
  }
  gsap.to(el, { height: 0, autoAlpha: 0, duration, ease: 'court', onComplete: onDone })
}

/** Route transitions: a 160ms paper-level fade. No slides, no scaling —
 *  filings don't fly. */
export function playRouteFade(el: HTMLElement): void {
  if (reduced) return
  gsap.fromTo(el, { autoAlpha: 0 }, {
    autoAlpha: 1, duration: DUR_FAST, ease: 'court', clearProps: 'opacity,visibility',
  })
}
