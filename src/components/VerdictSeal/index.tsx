import gsap from 'gsap'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const HUES = { MET: '--verdict-met', PARTIAL: '--verdict-partial', NOT_MET: '--verdict-notmet' } as const
const HUE_FALLBACK = { MET: '#1E7A5F', PARTIAL: '#9A6B10', NOT_MET: '#9E2B20' } as const

type Phase = 'waiting' | 'deliberating' | 'stamping' | 'rest'

export function VerdictSeal({ task, ceremony = false, go = true }: {
  task: Task
  ceremony?: boolean
  /** Master-timeline gate: the ceremony act begins only when the case
   *  view's criteria act hands off (§6). */
  go?: boolean
}) {
  const now = useNow()
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
  const colors = useMemo(
    () => ({
      ink: tokenColor('--ink', '#141B26'),
      paper: tokenColor('--paper-raised', '#FFFFFF'),
      faint: tokenColor('--ink-faint', '#8B96A3'),
    }),
    [],
  )

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

  const hue = tokenColor(HUES[verdict.verdict], HUE_FALLBACK[verdict.verdict])
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
    <div className="seal-wrap">
      {/* The 320px slot is reserved through every phase — the ceremony
          must not shift the docket (CLS gate, §Phase 5). */}
      <div className="seal-canvas">
        {phase === 'deliberating' && (
          <Suspense fallback={null}>
            <SealScene
              inkColor={colors.ink}
              hueColor={hue}
              onDone={() => setPhase('stamping')}
            />
          </Suspense>
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
