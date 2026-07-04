import { forwardRef } from 'react'
import type { VerdictKind } from '../../lib/types'

/** Static seal geometry — shared by the R3F stamp phase, the
 *  reduced-motion fallback, and the downloadable artifact (§7).
 *  The inner notch ring *is* the consensus data: one notch per
 *  criterion, filled = met. */

export interface SealProps {
  verdict: VerdictKind
  criteria: boolean[]        // FR-2.3 boolean vector, in index order
  caseNo: string
  hue: string
  ink: string
  paper: string
  faint: string
  final: boolean
  /** 0..1 fraction of appeal window remaining; null once final */
  windowFrac: number | null
  /** Chamber finality (v2 §2): when set and final, the seal ends in
   *  metal — main rings in brass, ring text in brass-dim. */
  brass?: string
  brassDim?: string
  size?: number | string
}

const WORD: Record<VerdictKind, string> = { MET: 'MET', PARTIAL: 'PARTIAL', NOT_MET: 'NOT MET' }

export const SealSVG = forwardRef<SVGSVGElement, SealProps>(function SealSVG(
  { verdict, criteria, caseNo, hue, ink, paper, faint, final, windowFrac, brass, brassDim, size = '100%' },
  ref,
) {
  const C = 160
  const rOuter = 148
  const rText = 128
  const rNotch = 104
  const rInner = 86
  const n = Math.max(criteria.length, 1)

  // Notches around the inner ring
  const notches = criteria.map((met, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const x1 = C + Math.cos(a) * (rNotch - 7)
    const y1 = C + Math.sin(a) * (rNotch - 7)
    const x2 = C + Math.cos(a) * (rNotch + 7)
    const y2 = C + Math.sin(a) * (rNotch + 7)
    return { met, x1, y1, x2, y2, key: i }
  })

  // Appeal-window countdown arc (hairline, along the outer edge)
  const arc = windowFrac !== null && windowFrac > 0 ? describeArc(C, C, 156, -90, -90 + 360 * windowFrac) : null

  // At finality the seal darkens one step — hue mixed toward ink (§7),
  // never losing the verdict color entirely. On chamber surfaces
  // finality is brass instead: the ceremony ends in metal (v2 §2).
  const mainStroke = final ? (brass ?? mixHex(hue, ink, 0.35)) : hue
  const ringTextFill = final && brass ? (brassDim ?? mainStroke) : mainStroke
  const captionFill = final ? (brass ?? ink) : faint

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 320 320"
      role="img"
      aria-label={`Verdict seal, case ${caseNo}: ${WORD[verdict]}${final ? ', final' : ', appeal window open'}. ${criteria.filter(Boolean).length} of ${criteria.length} criteria met.`}
      style={{ display: 'block' }}
    >
      <defs>
        <path id={`ring-${caseNo}`} d={`M 160 ${160 - rText} A ${rText} ${rText} 0 1 1 159.99 ${160 - rText}`} fill="none" />
      </defs>

      {/* paper base + faint ink-bleed ring */}
      <circle cx={C} cy={C} r={rOuter + 6} fill={paper} />
      <circle cx={C} cy={C} r={rOuter + 3} fill="none" stroke={faint} strokeWidth="0.75" opacity="0.5" />

      {/* outer ring */}
      <circle cx={C} cy={C} r={rOuter} fill="none" stroke={mainStroke} strokeWidth="2.5" />
      <circle cx={C} cy={C} r={rOuter - 6} fill="none" stroke={mainStroke} strokeWidth="0.75" />

      {/* ring text */}
      <text
        fill={ringTextFill}
        style={{
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: '13.5px',
          letterSpacing: '4px',
          fontWeight: 500,
        }}
      >
        <textPath href={`#ring-${caseNo}`} startOffset="0">
          GENLAYER · OPTIMISTIC DEMOCRACY · CASE {caseNo} · GENLAYER · OPTIMISTIC DEMOCRACY ·
        </textPath>
      </text>

      {/* notch ring — the criteria boolean vector */}
      <circle cx={C} cy={C} r={rNotch} fill="none" stroke={mainStroke} strokeWidth="0.75" opacity="0.65" />
      {notches.map((t) =>
        t.met ? (
          <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={mainStroke} strokeWidth="5" strokeLinecap="butt" />
        ) : (
          <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={mainStroke} strokeWidth="1.25" strokeLinecap="butt" opacity="0.6" />
        ),
      )}

      {/* inner ring + verdict word */}
      <circle cx={C} cy={C} r={rInner} fill="none" stroke={mainStroke} strokeWidth="1.25" />
      <text
        x={C}
        y={C + 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={mainStroke}
        style={{
          fontFamily: "'Spectral', Georgia, serif",
          fontWeight: 600,
          fontSize: verdict === 'PARTIAL' ? '30px' : '34px',
          letterSpacing: '1px',
        }}
      >
        {WORD[verdict]}
      </text>
      <text
        x={C}
        y={C + 34}
        textAnchor="middle"
        fill={captionFill}
        style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: '11px', letterSpacing: '2px' }}
      >
        {final ? 'FINAL' : 'APPEAL WINDOW OPEN'}
      </text>

      {/* appeal countdown arc */}
      {arc && <path d={arc} fill="none" stroke={hue} strokeWidth="1" opacity="0.9" />}
    </svg>
  )
})

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, endDeg)
  const e = polar(cx, cy, r, startDeg)
  const large = endDeg - startDeg <= 180 ? '0' : '1'
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t)
  const r = ch((pa >> 16) & 255, (pb >> 16) & 255)
  const g = ch((pa >> 8) & 255, (pb >> 8) & 255)
  const bl = ch(pa & 255, pb & 255)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}
