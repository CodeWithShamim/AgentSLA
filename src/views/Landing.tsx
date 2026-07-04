import gsap from 'gsap'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CanvasBoundary } from '../components/CanvasBoundary'
import { DocketLine } from '../components/DocketLine'
import { ParallaxLines } from '../components/ParallaxLines'
import { StatusChip } from '../components/StatusChip'
import { VerdictSeal } from '../components/VerdictSeal'
import { DUR_MOVE, prefersReducedMotion } from '../design/motion'
import { CHAIN } from '../config/chain'
import { useReducedMotion } from '../lib/hooks'
import { useTheme } from '../lib/theme'
import { useTasks } from '../lib/reads'
import { TaskCard } from './Board'

const HeroScene = lazy(() => import('../components/landing/HeroScene').then((m) => ({ default: m.HeroScene })))

/** The landing (v2 §3.1): five acts, scroll-revealed. The user starts in
 *  the chamber and physically scrolls into the filing office — immersion
 *  is the movement between the two surfaces, not an effect. */

const CHAMBER_BG = '#0E141D'
const PAPER_BG = '#F1F3F5'

/** Reduced-motion hero: a static constellation, same 13 nodes. */
function Constellation() {
  const dots = Array.from({ length: 13 }, (_, i) => {
    const a = (i / 13) * Math.PI * 2
    const r = 130 + (i % 5) * 14
    return {
      x: 320 + Math.cos(a) * r * 1.35,
      y: 170 + Math.sin(a) * r * 0.55,
      s: 2.5 + (i % 3),
    }
  })
  return (
    <svg viewBox="0 0 640 340" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
      <ellipse cx="320" cy="170" rx="176" ry="72" fill="none" stroke="var(--chamber-faint)" strokeWidth="0.75" opacity="0.5" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.s} fill="var(--chamber-muted)" opacity="0.85" />
      ))}
    </svg>
  )
}

const ACT2 = [
  {
    label: 'Happy-path standards',
    body: 'x402 moves the payment. ERC-8004 carries the reputation. A2A lets agents talk. Each assumes the work was good.',
  },
  {
    label: 'The missing verdict',
    body: 'When a deliverable is disputed, there is no judge. A human reads the output, or the payment stalls — the one step agents cannot close alone.',
  },
  {
    label: 'The adjudication layer',
    body: 'AgentSLA escrows payment against a natural-language SLA, takes a worker bond, and lets validator consensus judge the work per criterion.',
  },
] as const

const ACT3 = [
  { step: 'commit', text: 'Buyer escrows payment against the SLA; worker stakes a bond.', status: 'OPEN' },
  { step: 'deliver', text: 'Evidence is filed — and adjudicated strictly as untrusted data.', status: 'DELIVERED' },
  { step: 'adjudicate', text: 'Validators judge each criterion independently and reach consensus.', status: 'ADJUDICATING' },
  { step: 'settle', text: 'Funds move, slashes land, reputation writes. No human in the loop.', status: 'FINAL' },
] as const

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const heroWrap = useRef<HTMLDivElement>(null)
  const heroCopy = useRef<HTMLDivElement>(null)
  const fadeSection = useRef<HTMLElement>(null)
  const [heroInView, setHeroInView] = useState(true)
  const reduced = useReducedMotion()
  const { theme } = useTheme()
  const tasks = useTasks()

  const latest = [...tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)
  const finalCase = tasks.find((t) => t.status === 'FINAL' && t.verdict)

  /* Scroll choreography: parallax (≤24px, transform-only), the Act III
   * chamber→paper fade, and one-shot reveals. */
  useEffect(() => {
    const rootEl = root.current
    if (!rootEl) return

    // The hero canvas stops rendering entirely off-viewport (v2 §4).
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setHeroInView(e.isIntersecting)),
      { threshold: 0 },
    )
    if (heroWrap.current) io.observe(heroWrap.current)

    if (prefersReducedMotion()) return () => io.disconnect()

    const copyY = heroCopy.current ? gsap.quickSetter(heroCopy.current, 'y', 'px') : null
    const canvasEl = heroWrap.current
    const canvasY = canvasEl ? gsap.quickSetter(canvasEl, 'y', 'px') : null
    const bg = gsap.utils.interpolate(CHAMBER_BG, PAPER_BG)

    const onScroll = () => {
      const y = window.scrollY
      copyY?.(Math.min(y * 0.08, 24))
      canvasY?.(Math.min(y * 0.04, 24))
      const sec = fadeSection.current
      if (sec) {
        // The chamber→paper fade is a light-theme device: you scroll out of
        // the dark chamber into the paper filing office. In dark mode there
        // is no paper to fade into — everything is chamber — so hold the
        // section dark and let the CSS surface (var(--chamber)) show through.
        if (theme === 'dark') {
          sec.style.backgroundColor = ''
          sec.dataset.phase = 'dark'
          return
        }
        const rect = sec.getBoundingClientRect()
        const vh = window.innerHeight
        const p = Math.max(0, Math.min(1, (vh - rect.top) / (vh * 1.4)))
        sec.style.backgroundColor = bg(p)
        sec.dataset.phase = p > 0.5 ? 'light' : 'dark'
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    // One-shot act reveals — rows rise 8px, nothing bounces.
    const targets = Array.from(rootEl.querySelectorAll<HTMLElement>('.act-reveal'))
    gsap.set(targets, { autoAlpha: 0, y: 8 })
    const reveals = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        gsap.to(e.target, { autoAlpha: 1, y: 0, duration: DUR_MOVE, ease: 'court' })
        // Trigger the Act III sci-fi flicker (CSS keyframes, scoped to
        // .act3-step .t-data) once, as the step scrolls into view.
        e.target.classList.add('is-revealed')
        reveals.unobserve(e.target)
      })
    }, { threshold: 0.25 })
    targets.forEach((t) => reveals.observe(t))

    return () => {
      io.disconnect()
      reveals.disconnect()
      window.removeEventListener('scroll', onScroll)
      gsap.killTweensOf(targets)
      gsap.set(targets, { clearProps: 'all' })
      targets.forEach((t) => t.classList.remove('is-revealed'))
      if (heroCopy.current) gsap.set(heroCopy.current, { clearProps: 'transform' })
      if (canvasEl) gsap.set(canvasEl, { clearProps: 'transform' })
      if (fadeSection.current) {
        fadeSection.current.style.backgroundColor = ''
        delete fadeSection.current.dataset.phase
      }
    }
  }, [reduced, theme])

  return (
    <div ref={root} className="landing full-bleed">
      {/* ── ACT I — THE CHAMBER ── */}
      <section className="chamber chamber-vignette act-hero">
        <div className="hero-canvas" ref={heroWrap} aria-hidden>
          {reduced ? (
            <Constellation />
          ) : (
            <CanvasBoundary fallback={<Constellation />}>
              <Suspense fallback={<Constellation />}>
                <HeroScene active={heroInView} />
              </Suspense>
            </CanvasBoundary>
          )}
        </div>
        <div className="shell hero-copy" ref={heroCopy}>
          <h1 className="t-hero">When agents disagree,<br />the court convenes.</h1>
          <p className="t-body ink-muted hero-sub">
            On-chain SLA adjudication for agent-to-agent commerce. Escrow against
            a natural-language contract; validator consensus delivers the verdict.
          </p>
          <p className="t-data ink-faint hero-protocols">x402 · ERC-8004 · A2A · GENLAYER</p>
        </div>
      </section>

      {/* ── ACT II — THE PROBLEM ── */}
      <section className="chamber act-problem">
        <div className="shell">
          <DocketLine label="The gap in the stack" />
          <div className="act2-grid">
            {ACT2.map((c) => (
              <div key={c.label} className="filing act2-card act-reveal">
                <p className="t-label">{c.label}</p>
                <p className="t-small ink-muted" style={{ marginTop: 'var(--s-3)' }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ACT III — THE PROCEEDING: chamber → paper ── */}
      <section className="act-fade" ref={fadeSection} data-phase="dark">
        <div className="shell">
          <DocketLine label="One proceeding, four steps" />
          <div className="act3-steps">
            {ACT3.map((s, i) => (
              <div key={s.step} className="act3-step act-reveal">
                <span className="t-data ink-faint">{String(i + 1).padStart(2, '0')}</span>
                <span className="t-data act3-name">{s.step}</span>
                <StatusChip status={s.status} />
                <p className="t-small ink-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ACT IV — LIVE DOCKET (filing surface) ── */}
      <section className="act-docket">
        <div className="shell">
          <DocketLine label="The docket is live" />
          <div className="act4-grid">
            <div className="filing ruled act-reveal">
              {latest.length > 0 ? (
                latest.map((t) => <TaskCard key={t.id} task={t} />)
              ) : (
                <p className="t-body ink-muted" style={{ padding: 'var(--s-4) var(--s-5)' }}>
                  No cases on the docket yet. <Link to="/create">File the first.</Link>
                </p>
              )}
            </div>
            {finalCase && (
              <div className="chamber-inset act4-seal act-reveal">
                <p className="t-label ink-muted">Latest final judgment</p>
                <VerdictSeal task={finalCase} />
                <p className="t-data ink-faint">
                  CASE №{String(finalCase.id).padStart(4, '0')} · settled by consensus
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── ACT V — CONVENE ── */}
      <section className="chamber chamber-vignette act-convene">
        <ParallaxLines />
        <div className="shell act-convene-inner">
          <p className="t-h2">The court is in session on {CHAIN.name}.</p>
          <Link className="btn btn-primary" to="/board">Open the docket</Link>
        </div>
      </section>
    </div>
  )
}
