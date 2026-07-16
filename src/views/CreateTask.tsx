import gsap from 'gsap'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PARAMS } from '../config/chain'
import { DocketLine } from '../components/DocketLine'
import { TxLadder } from '../components/TxLadder'
import { collapseBlock, revealBlock, DUR_FAST } from '../design/motion'
import { fmtGEN, parseGEN, pct } from '../lib/format'
import { useCountUp, useDocketOpen } from '../lib/hooks'
import { useTasks, useWalletGate } from '../lib/reads'
import { ConnectWalletButton } from '../lib/wallet'
import { writes } from '../lib/writes'

const genOf = (wei: bigint) => Number(wei) / 1e18
const fmtBond = (n: number) => `${n.toFixed(2)} GEN`

/** One criterion line. New rows expand in from measured height; removal
 *  collapses before the state change lands (§6 — cause precedes effect). */
function CriterionField({ index, value, canRemove, animateIn, onChange, onRemove }: {
  index: number
  value: string
  canRemove: boolean
  animateIn: boolean
  onChange: (v: string) => void
  onRemove: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Rows present at view mount arrive with the docket; only later
    // additions expand in.
    if (animateIn && rowRef.current) revealBlock(rowRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = () => {
    if (rowRef.current) collapseBlock(rowRef.current, onRemove)
    else onRemove()
  }

  const placeholder =
    index === 0 ? 'Mentions all three product features'
    : index === 1 ? 'Formal tone throughout'
    : 'At least 500 words'

  return (
    <div ref={rowRef} className="field" style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 'var(--s-3)', alignItems: 'center', overflow: 'hidden' }}>
      <span className="t-data ink-faint crit-index">{String(index + 1).padStart(2, '0')}</span>
      <input
        className="input"
        aria-label={`Criterion ${index + 1}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        className="btn btn-secondary"
        style={{ padding: '4px 10px' }}
        onClick={remove}
        disabled={!canRemove}
        aria-label={`Remove criterion ${index + 1}`}
      >
        −
      </button>
    </div>
  )
}

/** Create-task flow (FR-1). The button states the exact consequence (§8). */
export function CreateTask() {
  const nav = useNavigate()
  const root = useDocketOpen<HTMLDivElement>()

  const [title, setTitle] = useState('Product description — HALO-9 field sensor')
  const [sla, setSla] = useState('Write a product description for the HALO-9 field sensor suitable for the company website. It must be accurate, persuasive, and meet every criterion below.')
  const [criteria, setCriteria] = useState<{ id: number; text: string }[]>([
    { id: 0, text: 'Mentions all three product features' },
    { id: 1, text: 'Formal tone throughout' },
    { id: 2, text: 'At least 500 words' },
  ])
  const [escrowStr, setEscrowStr] = useState('10')
  const [days, setDays] = useState(7)
  const [err, setErr] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [filed, setFiled] = useState(false)
  const [busy, setBusy] = useState(false)
  const tasks = useTasks()
  const gate = useWalletGate()
  const needWallet = gate.required && !gate.connected
  const filedAt = useRef(0)
  const filedTitle = useRef('')
  const nextId = useRef(3)
  const didMount = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { didMount.current = true }, [])

  const escrow = parseGEN(escrowStr)
  const bond = escrow !== null ? pct(escrow, PARAMS.bondPct) : null
  const filled = criteria.map((c) => c.text.trim()).filter(Boolean)

  // Bond auto-derives from escrow with a one-beat delay so cause→effect
  // reads; the figure counts, the layout never moves (fixed mono width).
  const bondRef = useCountUp<HTMLSpanElement>(
    bond !== null ? genOf(bond) : 0,
    (n) => (bond === null ? '—' : fmtBond(n)),
    { delay: DUR_FAST },
  )

  const setCriterion = (id: number, text: string) =>
    setCriteria((cs) => cs.map((c) => (c.id === id ? { ...c, text } : c)))

  // Mono indices renumber with a 160ms opacity tick when the list changes.
  useEffect(() => {
    if (!didMount.current || !listRef.current) return
    gsap.fromTo(listRef.current.querySelectorAll('.crit-index'),
      { opacity: 0.35 }, { opacity: 1, duration: DUR_FAST, ease: 'court' })
  }, [criteria.length])

  // Once the filed task appears on the docket, open its case view.
  useEffect(() => {
    if (!filed) return
    const mine = tasks.find(
      (t) => t.title === filedTitle.current && t.createdAt >= filedAt.current - 120_000,
    )
    if (mine) {
      const timer = setTimeout(() => nav(`/case/${mine.id}`), 1600)
      return () => clearTimeout(timer)
    }
  }, [filed, tasks, nav])

  const submit = async () => {
    setErr(null)
    if (!title.trim()) return setErr('A deliverable title is required.')
    if (!sla.trim()) return setErr('SLA text is required — it is the contract the court enforces.')
    if (filled.length < 1) return setErr('At least one criterion is required (FR-1.2).')
    if (filled.length > 10) return setErr('At most 10 criteria (FR-1.2).')
    if (escrow === null) return setErr('Escrow must be a valid GEN amount.')
    if (escrow < PARAMS.minEscrow) return setErr(`Escrow below the minimum of ${fmtGEN(PARAMS.minEscrow)}.`)

    setBusy(true)
    try {
      const { hash } = await writes.createTask({
        title: title.trim(),
        slaText: sla.trim(),
        criteria: filled,
        deadline: Date.now() + days * 86_400_000,
        escrow,
      })
      filedAt.current = Date.now()
      filedTitle.current = title.trim()
      setTxHash(hash)
      setFiled(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 200) : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={root} style={{ maxWidth: 720 }}>
      <div style={{ padding: 'var(--s-6) 0 0' }}>
        <h1 className="t-h1">File a task</h1>
        <p className="t-body ink-muted" style={{ marginTop: 'var(--s-2)' }}>
          The SLA is written in natural language; each criterion is judged
          independently by validator consensus. Write criteria as discrete,
          individually judgeable statements.
        </p>
      </div>

      <DocketLine label="Deliverable" />
      <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <div className="field">
          <label className="t-label" htmlFor="ct-title">Title (deliverable hint)</label>
          <input id="ct-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Product description — HALO-9 field sensor" />
        </div>
        <div className="field">
          <label className="t-label" htmlFor="ct-sla">SLA text</label>
          <textarea id="ct-sla" className="textarea" rows={4} value={sla} onChange={(e) => setSla(e.target.value)}
            placeholder="Describe the task and the standard the deliverable must meet…" />
        </div>
      </div>

      <DocketLine label="Criteria" />
      <div ref={listRef} style={{ display: 'grid', gap: 'var(--s-3)' }}>
        {criteria.map((c, i) => (
          <CriterionField
            key={c.id}
            index={i}
            value={c.text}
            canRemove={criteria.length > 1}
            animateIn={didMount.current}
            onChange={(v) => setCriterion(c.id, v)}
            onRemove={() => setCriteria((cs) => cs.filter((x) => x.id !== c.id))}
          />
        ))}
        <div>
          <button
            className="btn btn-secondary"
            onClick={() => setCriteria((cs) => [...cs, { id: nextId.current++, text: '' }])}
            disabled={criteria.length >= 10}
          >
            + Add criterion ({criteria.length}/10)
          </button>
        </div>
      </div>

      <DocketLine label="Stakes" />
      <div className="field-pair">
        <div className="field">
          <label className="t-label" htmlFor="ct-escrow">Escrow (GEN)</label>
          <input id="ct-escrow" className="input mono" inputMode="decimal" value={escrowStr}
            onChange={(e) => setEscrowStr(e.target.value)} />
          <span className="hint t-small">
            Minimum {fmtGEN(PARAMS.minEscrow)}. Worker bond will be{' '}
            <span className="t-data" ref={bondRef} style={{ display: 'inline-block', minWidth: '7ch' }} /> ({PARAMS.bondPct}%).
          </span>
        </div>
        <div className="field">
          <label className="t-label" htmlFor="ct-deadline">Deadline (days from now)</label>
          <input id="ct-deadline" className="input mono" type="number" min={1} max={60} value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} />
          <span className="hint t-small">Missed deadline → full refund + full bond slash (FR-3.4).</span>
        </div>
      </div>

      {err && <p className="error t-small" style={{ marginTop: 'var(--s-4)' }}>{err}</p>}

      <div style={{ marginTop: 'var(--s-5)', display: 'grid', gap: 'var(--s-4)' }}>
        {!filed && (needWallet ? (
          <div style={{ display: 'grid', gap: 'var(--s-2)', justifyItems: 'start' }}>
            <ConnectWalletButton label={`Connect wallet to escrow ${escrow !== null ? fmtGEN(escrow) : 'GEN'}`} />
            <p className="t-small ink-faint">
              Filing moves real GEN from your wallet into contract custody —
              the transaction must be signed by your connected wallet.
            </p>
          </div>
        ) : (
          <div>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Signing…' : `Escrow ${escrow !== null ? fmtGEN(escrow) : '— GEN'} & open the case`}
            </button>
          </div>
        ))}
        {txHash && <TxLadder hash={txHash} />}
        {filed && (
          <p className="t-small ink-muted">
            Case filed — opening the docket entry once it lands on-chain…
          </p>
        )}
      </div>
    </div>
  )
}
