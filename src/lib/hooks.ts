import gsap from 'gsap'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  countUp,
  onReducedMotionChange,
  playCriteriaReveal,
  playDocketOpen,
  prefersReducedMotion,
  revealBlock,
} from '../design/motion'

/** Every view animation runs inside a gsap.context scoped to its root —
 *  ctx.revert() on unmount keeps StrictMode double-mounts and route
 *  changes artifact-free (§6). */
export function useCourtMotion<T extends HTMLElement>(
  play: (root: T) => void,
  deps: unknown[] = [],
) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ctx = gsap.context(() => play(el), el)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/** Play the docket-open sequence once on view mount (§6). */
export function useDocketOpen<T extends HTMLElement>(deps: unknown[] = []) {
  return useCourtMotion<T>((el) => playDocketOpen(el), deps)
}

/** Stamp criterion results in top→bottom when they land (§6).
 *  Pass `undefined` to keep the rows static — the court doesn't re-stamp
 *  an already-final case. */
export function useCriteriaReveal<T extends HTMLElement>(key: string | number | undefined) {
  const ref = useRef<T>(null)
  const played = useRef<string | number | undefined>(undefined)
  useEffect(() => {
    const el = ref.current
    if (key === undefined || key === played.current || !el) return
    played.current = key
    const ctx = gsap.context(() => { playCriteriaReveal(el) }, el)
    return () => ctx.revert()
  }, [key])
  return ref
}

/** Live prefers-reduced-motion flag — flips mid-session when the OS
 *  setting changes, so the seal can swap Canvas → static SVG. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => onReducedMotionChange(setReduced), [])
  return reduced
}

/** Animate a numeric readout when its value changes. The element's text
 *  is owned by GSAP between renders; layout never moves (fixed-width
 *  mono container). */
export function useCountUp<T extends HTMLElement>(
  value: number,
  format: (n: number) => string,
  opts: { duration?: number; delay?: number } = {},
) {
  const ref = useRef<T>(null)
  const prev = useRef<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const from = prev.current
    prev.current = value
    if (from === null) {
      el.textContent = format(value)
      return
    }
    countUp(el, from, value, { format, ...opts })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return ref
}

/** Expand a conditionally-rendered block from zero height on mount. */
export function useMountReveal<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (open && ref.current) revealBlock(ref.current)
  }, [open])
  return ref
}
