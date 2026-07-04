import gsap from 'gsap'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasBoundary } from '../CanvasBoundary'
import { ceremonyCapable } from '../../design/motion'
import { PARAMS } from '../../config/chain'
import { caseNo as fmtCase } from '../../lib/format'
import { useReducedMotion } from '../../lib/hooks'
import { useNow } from '../../lib/reads'
import type { Task } from '../../lib/types'
import { SealSVG } from './SealSVG'

const SealScene = lazy(() => import('./SealScene').then((m) => ({ default: m.SealScene })))

/** The one memorable thing (§7). Four acts: deliberation → convergence
 *  (R3F, mounted only for the ceremony) → the stamp (SVG pressed into a
 *  paper depression) → rest (one ink-bleed ring, then stillness).
 *  Static SVG under reduced motion or on low-memory devices.
 *  Downloadable — the seal is the product's shareable artifact. */

const HUES = { MET: '--verdict-met', PARTIAL: '--verdict-partial', NOT_MET: '--verdict-notmet' } as const
const HUE_FALLBACK = { MET: '#1E7A5F', PARTIAL: '#9A6B10', NOT_MET: '#9E2B20' } as const

const COLOR_DEFAULTS = {
  ink: '#141B26',
  paper: '#FFFFFF',
  faint: '#8B96A3',
  hue: '#4C5866',
  brass: '#A98C4A',
  brassDim: '#937E4A',
}

type Phase = 'waiting' | 'deliberating' | 'stamping' | 'rest'

export function VerdictSeal({ task, ceremony = false, go = true, brass = false }: {
  task: Task
  ceremony?: boolean
  /** Master-timeline gate: the ceremony act begins only when the case
   *  view's criteria act hands off (§6). */
  go?: boolean
  /** Chamber-only finality accent: at FINAL the seal ends in metal (v2 §2). */
  brass?: boolean
}) {
  const now = useNow()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const stampRef = useRef<HTMLDivElement>(null)
  const depressRef = useRef<HTMLDivElement>(null)
  const bleedRef = useRef<SVGCircleElement>(null)
  const reduced = useReducedMotion()
  const animate = ceremony && !reduced && ceremonyCapable()
  const [phase, setPhase] = useState<Phase>(animate ? 'waiting' : 'rest')

  // The ceremony starts on the master timeline's cue.
  useEffect(() => {
    if (phase === 'waiting' && go) setPhase('deliberating')
  }, [go, phase])

  // Reduced motion flipping on mid-ceremony lands the seal immediately.
  useEffect(() => {
    if (reduced && phase !== 'rest') setPhase('rest')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  const verdict = task.verdict

  /** Colors resolve from the cascade at the seal's own position — the
   *  same component renders ink-on-paper in the filing and light-on-dark
   *  inside a chamber inset, with no styling logic in JS. */
  const [colors, setColors] = useState(COLOR_DEFAULTS)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || !verdict) return
    const cs = getComputedStyle(el)
    const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    setColors({
      ink: get('--ink', COLOR_DEFAULTS.ink),
      paper: get('--paper-raised', COLOR_DEFAULTS.paper),
      faint: get('--ink-faint', COLOR_DEFAULTS.faint),
      hue: get(HUES[verdict.verdict], HUE_FALLBACK[verdict.verdict]),
      brass: get('--brass', COLOR_DEFAULTS.brass),
      brassDim: get('--brass-dim', COLOR_DEFAULTS.brassDim),
    })
  }, [verdict?.verdict])

  /** Act 3, the stamp (1400–1600ms): the seal presses in — scale 1.04 → 1,
   *  rotation −2° → 0, emboss shadow deepening while a radial paper
   *  depression breathes under it. Act 4 follows: one expanding ink-bleed
   *  ring, 400ms, then rest. */
  useLayoutEffect(() => {
    if (phase !== 'stamping' || !stampRef.current) return
    const tl = gsap.timeline({ onComplete: () => setPhase('rest') })
    tl.fromTo(stampRef.current,
      { scale: 1.04, rotation: -2, autoAlpha: 0 },
      { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.2, ease: 'court' })
    if (depressRef.current) {
      tl.fromTo(depressRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, ease: 'court' }, 0)
      tl.to(depressRef.current, { autoAlpha: 0, duration: 0.28, ease: 'court' }, 0.16)
    }
    if (bleedRef.current) {
      tl.fromTo(bleedRef.current,
        { attr: { r: 150 }, opacity: 0.4 },
        { attr: { r: 162 }, opacity: 0, duration: 0.4, ease: 'court' }, 0.14)
    }
    return () => { tl.kill() }
  }, [phase])

  if (!verdict) return null

  const hue = colors.hue
  const final = task.status === 'FINAL' || verdict.round === 2
  const windowFrac = final
    ? null
    : Math.max(0, Math.min(1, (verdict.appealWindowEnds - now) / PARAMS.appealWindowMs))

  const download = () => {
    const el = svgRef.current
    if (!el) return
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n' + el.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')],
      { type: 'image/svg+xml' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agentsla-case-${task.id}-seal.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  const bools = verdict.criteriaResults.map((r) => r.met)

  return (
    <div className="seal-wrap" ref={wrapRef}>
      {/* The 320px slot is reserved through every phase — the ceremony
          must not shift the docket (CLS gate, §Phase 5). */}
      <div className="seal-canvas">
        {phase === 'deliberating' && (
          <CanvasBoundary fallback={null} onError={() => setPhase('rest')}>
            <Suspense fallback={null}>
              <SealScene
                inkColor={colors.ink}
                hueColor={hue}
                onDone={() => setPhase('stamping')}
              />
            </Suspense>
          </CanvasBoundary>
        )}
        {(phase === 'stamping' || phase === 'rest') && (
          <>
            <div ref={depressRef} className="seal-depress" aria-hidden style={{ opacity: 0 }} />
            <div
              ref={stampRef}
              className="seal-svg-layer"
              style={{
                filter:
                  phase === 'rest'
                    ? 'drop-shadow(0 2px 2px rgba(20,27,38,0.18))'
                    : 'drop-shadow(0 6px 8px rgba(20,27,38,0.25))',
              }}
            >
              <SealSVG
                ref={svgRef}
                verdict={verdict.verdict}
                criteria={bools}
                caseNo={fmtCase(task.id)}
                hue={hue}
                ink={colors.ink}
                paper={colors.paper}
                faint={colors.faint}
                final={final}
                windowFrac={windowFrac}
                brass={brass && final ? colors.brass : undefined}
                brassDim={brass && final ? colors.brassDim : undefined}
                size={undefined}
              />
            </div>
            <svg className="seal-bleed" viewBox="0 0 320 320" aria-hidden>
              <circle ref={bleedRef} cx="160" cy="160" r="150" fill="none" stroke={hue} strokeWidth="1.5" opacity="0" />
            </svg>
          </>
        )}
      </div>
      {phase === 'rest' && (
        <button className="seal-download t-small" onClick={download}>
          ↓ Download seal (SVG)
        </button>
      )}
    </div>
  )
}
