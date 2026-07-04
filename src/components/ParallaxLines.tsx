import gsap from 'gsap'
import { useEffect, useRef } from 'react'
import { onReducedMotionChange, prefersReducedMotion } from '../design/motion'

/** Immersive parallax line field: layered archival rules that drift at
 *  different rates as the section scrolls through the viewport — depth read
 *  from relative motion, transform-only, and no autonomous loop (so it stays
 *  inside the landing's animation limit; scroll parallax is already the one
 *  motion the chamber allows). Colours ride `var(--rule)`, which remaps to the
 *  chamber palette on dark surfaces, so the field themes itself. Purely
 *  decorative (aria-hidden) and dead still under reduced motion. */

type Layer = { depth: number; lines: { y: number; w: number; dash?: string }[] }

// depth: 0 far … 1 near. Near layers are thicker, stronger, and travel more —
// the parallax spread is what reads as depth. y is a percentage down the box.
const LAYERS: Layer[] = [
  { depth: 0.22, lines: [{ y: 9, w: 0.6 }, { y: 27, w: 0.6, dash: '2 7' }, { y: 44, w: 0.6 }, { y: 63, w: 0.6, dash: '2 7' }, { y: 82, w: 0.6 }, { y: 95, w: 0.6 }] },
  { depth: 0.55, lines: [{ y: 16, w: 0.9 }, { y: 38, w: 0.9 }, { y: 71, w: 0.9, dash: '3 9' }, { y: 88, w: 0.9 }] },
  { depth: 1.0, lines: [{ y: 30, w: 1.3 }, { y: 53, w: 1.3 }, { y: 77, w: 1.3 }] },
]

// Peak travel (px) for the nearest layer; far layers scale down by depth.
const TRAVEL = 46

export function ParallaxLines() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return

    const layerEls = Array.from(el.querySelectorAll<HTMLElement>('.pl-layer'))
    const setters = layerEls.map((l) => gsap.quickSetter(l, 'y', 'px'))
    const depths = layerEls.map((l) => Number(l.dataset.depth) || 0)

    let raf = 0
    let bound = false

    const apply = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      // 0 as the section enters from the bottom, 1 as it clears the top.
      const p = (vh - rect.top) / (vh + rect.height)
      const base = (Math.max(0, Math.min(1, p)) - 0.5) * 2 // -1 … 1
      setters.forEach((set, i) => set(-base * TRAVEL * depths[i]))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }

    const enable = () => {
      if (bound || prefersReducedMotion()) return
      bound = true
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })
      apply()
    }
    const disable = () => {
      if (!bound) return
      bound = false
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      setters.forEach((set) => set(0)) // settle flat when motion is off
    }

    enable()
    const offRM = onReducedMotionChange((reduced) => (reduced ? disable() : enable()))
    return () => { disable(); offRM() }
  }, [])

  return (
    <div className="parallax-lines" ref={root} aria-hidden>
      {LAYERS.map((layer, li) => (
        <div key={li} className="pl-layer" data-depth={layer.depth}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            {layer.lines.map((ln, i) => (
              <line
                key={i}
                x1="0"
                x2="100"
                y1={ln.y}
                y2={ln.y}
                strokeWidth={ln.w}
                strokeDasharray={ln.dash}
                opacity={0.14 + layer.depth * 0.34}
              />
            ))}
          </svg>
        </div>
      ))}
    </div>
  )
}
