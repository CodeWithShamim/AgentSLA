import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PARAMS } from '../config/chain'
import { DocketLine } from '../components/DocketLine'
import { TxLadder } from '../components/TxLadder'
import { fmtGEN, parseGEN, pct } from '../lib/format'
import { useDocketOpen } from '../lib/hooks'
import { writes } from '../lib/writes'

/** Create-task flow (FR-1). The button states the exact consequence (§8). */
export function CreateTask() {
  const nav = useNavigate()
  const root = useDocketOpen<HTMLDivElement>()

  const [title, setTitle] = useState('')
  const [sla, setSla] = useState('')
  const [criteria, setCriteria] = useState<string[]>(['', '', ''])
  const [escrowStr, setEscrowStr] = useState('10')
  const [days, setDays] = useState(7)
  const [err, setErr] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<number | null>(null)

  const escrow = parseGEN(escrowStr)
  const bond = escrow !== null ? pct(escrow, PARAMS.bondPct) : null
  const filled = criteria.map((c) => c.trim()).filter(Boolean)

  const setCriterion = (i: number, v: string) =>
    setCriteria((cs) => cs.map((c, j) => (j === i ? v : c)))

  const submit = () => {
    setErr(null)
    if (!title.trim()) return setErr('A deliverable title is required.')
    if (!sla.trim()) return setErr('SLA text is required — it is the contract the court enforces.')
    if (filled.length < 1) return setErr('At least one criterion is required (FR-1.2).')
    if (filled.length > 10) return setErr('At most 10 criteria (FR-1.2).')
    if (escrow === null) return setErr('Escrow must be a valid GEN amount.')
    if (escrow < PARAMS.minEscrow) return setErr(`Escrow below the minimum of ${fmtGEN(PARAMS.minEscrow)}.`)

    const { hash, taskId } = writes.createTask({
      title: title.trim(),
      slaText: sla.trim(),
      criteria: filled,
      deadline: Date.now() + days * 86_400_000,
      escrow,
    })
    setTxHash(hash)
    setCreatedId(taskId)
    setTimeout(() => nav(`/case/${taskId}`), 3200)
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
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        {criteria.map((c, i) => (
          <div key={i} className="field" style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 'var(--s-3)', alignItems: 'center' }}>
            <span className="t-data ink-faint">{String(i + 1).padStart(2, '0')}</span>
            <input
              className="input"
              aria-label={`Criterion ${i + 1}`}
              value={c}
              onChange={(e) => setCriterion(i, e.target.value)}
              placeholder={i === 0 ? 'Mentions all three product features' : i === 1 ? 'Formal tone throughout' : 'At least 500 words'}
            />
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px' }}
              onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}
              disabled={criteria.length <= 1}
              aria-label={`Remove criterion ${i + 1}`}
            >
              −
            </button>
          </div>
        ))}
        <div>
          <button
            className="btn btn-secondary"
            onClick={() => setCriteria((cs) => [...cs, ''])}
            disabled={criteria.length >= 10}
          >
            + Add criterion ({criteria.length}/10)
          </button>
        </div>
      </div>

      <DocketLine label="Stakes" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-4)' }}>
        <div className="field">
          <label className="t-label" htmlFor="ct-escrow">Escrow (GEN)</label>
          <input id="ct-escrow" className="input mono" inputMode="decimal" value={escrowStr}
            onChange={(e) => setEscrowStr(e.target.value)} />
          <span className="hint t-small">
            Minimum {fmtGEN(PARAMS.minEscrow)}. Worker bond will be{' '}
            <span className="t-data">{bond !== null ? fmtGEN(bond) : '—'}</span> ({PARAMS.bondPct}%).
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
        {!createdId && (
          <div>
            <button className="btn btn-primary" onClick={submit}>
              Escrow {escrow !== null ? fmtGEN(escrow) : '— GEN'} & open the case
            </button>
          </div>
        )}
        {txHash && <TxLadder hash={txHash} />}
        {createdId && (
          <p className="t-small ink-muted">
            Case №{String(createdId).padStart(4, '0')} filed — opening the docket entry…
          </p>
        )}
      </div>
    </div>
  )
}
