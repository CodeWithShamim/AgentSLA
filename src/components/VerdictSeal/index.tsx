import gsap from 'gsap'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { easeCourt, prefersReducedMotion } from '../../design/motion'
import { PARAMS } from '../../config/chain'
import { caseNo as fmtCase } from '../../lib/format'
import { useNow } from '../../lib/reads'
import type { Task } from '../../lib/types'
import { SealSVG } from './SealSVG'

const SealScene = lazy(() => import('./SealScene').then((m) => ({ default: m.SealScene })))

/** The one memorable thing (§7). Deliberation → convergence (R3F) →
 *  the stamp (SVG pressed in) → rest. Static SVG under reduced motion.
 *  Downloadable — the seal is the product's shareable artifact. */

function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const HUES = { MET: '--verdict-met', PARTIAL: '--verdict-partial', NOT_MET: '--verdict-notmet' } as const
const HUE_FALLBACK = { MET: '#1E7A5F', PARTIAL: '#9A6B10', NOT_MET: '#9E2B20' } as const

export function VerdictSeal({ task, ceremony = false }: { task: Task; ceremony?: boolean }) {
  const now = useNow()
  const svgRef = useRef<SVGSVGElement>(null)
  const stampRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()
  const [phase, setPhase] = useState<'deliberating' | 'stamping' | 'rest'>(
    ceremony && !reduced ? 'deliberating' : 'rest',
  )

  const verdict = task.verdict
  const colors = useMemo(
    () => ({
      ink: tokenColor('--ink', '#141B26'),
      paper: tokenColor('--paper-raised', '#FFFFFF'),
      faint: tokenColor('--ink-faint', '#8B96A3'),
    }),
    [],
  )

  useEffect(() => {
    if (phase === 'stamping' && stampRef.current) {
      gsap.fromTo(
        stampRef.current,
        { scale: 1.14, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.55,
          ease: easeCourt,
          onComplete: () => setPhase('rest'),
        },
      )
    }
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
        {phase !== 'deliberating' && (
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
