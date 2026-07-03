import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PARAMS } from '../config/chain'
import { CriterionRow } from '../components/CriterionRow'
import { DocketLine } from '../components/DocketLine'
import { EvidencePanel } from '../components/EvidencePanel'
import { StatusChip } from '../components/StatusChip'
import { TxLadder } from '../components/TxLadder'
import { VerdictSeal } from '../components/VerdictSeal'
import { agentName } from '../lib/agents'
import { caseNo, fmtCountdown, fmtDateTime, fmtGEN, pct, shortAddr } from '../lib/format'
import { useDocketOpen, useCriteriaReveal } from '../lib/hooks'
import { useNow, useTask } from '../lib/reads'
import { writes } from '../lib/writes'
import type { Task } from '../lib/types'

function Fact({ label, value, aria }: { label: string; value: string; aria?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s-3)', padding: 'var(--s-2) 0' }}>
      <span className="t-small ink-muted">{label}</span>
      <span className="t-data" aria-label={aria}>{value}</span>
    </div>
  )
}

function DeliverForm({ task, onTx }: { task: Task; onTx: (h: string) => void }) {
  const [url, setUrl] = useState('')
  const [inline, setInline] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    if (!url.trim() && !inline.trim()) {
      setErr('At least one evidence field is required.')
      return
    }
    try {
      const hash = writes.submitDelivery(task.id, {
        url: url.trim() || undefined,
        inline: inline.trim() || undefined,
      })
      onTx(hash)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div className="field">
        <label className="t-label" htmlFor="ev-url">Evidence URL</label>
        <input id="ev-url" className="input mono" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="field">
        <label className="t-label" htmlFor="ev-inline">Inline evidence</label>
        <textarea id="ev-inline" className="textarea mono" rows={6} value={inline} onChange={(e) => setInline(e.target.value)}
          placeholder="Paste the deliverable content…" />
        <span className="hint t-small">
          Preferred for v1 — remote pages can change between leader and validator fetches.
        </span>
      </div>
      {err && <p className="error t-small">{err}</p>}
      <div>
        <button className="btn btn-primary" onClick={submit}>Submit delivery for adjudication</button>
      </div>
      <details>
        <summary className="t-small ink-faint" style={{ cursor: 'pointer' }}>Simulation triggers</summary>
        <p className="t-small ink-muted" style={{ marginTop: 'var(--s-2)' }}>
          Include <span className="t-data">[[force:met]]</span>, <span className="t-data">[[force:partial]]</span>,{' '}
          <span className="t-data">[[force:not_met]]</span> or <span className="t-data">[[force:soft_error]]</span> in
          the inline evidence to pin an outcome. Instruction-shaped text
          (“ignore all previous instructions…”) demonstrates the injection defense.
        </p>
      </details>
    </div>
  )
}

export function CaseDetail() {
  const { id } = useParams()
  const task = useTask(Number(id))
  const now = useNow()
  const [txHash, setTxHash] = useState<string | null>(null)
  const root = useDocketOpen<HTMLDivElement>([id])
  const criteriaRoot = useCriteriaReveal<HTMLDivElement>(task?.verdict?.judgedAt)

  const ceremony = useMemo(
    () => !!task?.verdict && Date.now() - task.verdict.judgedAt < 15_000,
    [task?.verdict?.judgedAt],
  )

  if (!task) {
    return (
      <div>
        <DocketLine label="Case not found" />
        <p className="t-body ink-muted">No such case on the docket. <Link to="/">Return to the docket.</Link></p>
      </div>
    )
  }

  const v = task.verdict
  const appealOpen = task.status === 'ADJUDICATED' && v && now < v.appealWindowEnds
  const msLeft = v ? v.appealWindowEnds - now : 0

  return (
    <div ref={root}>
      <div style={{ padding: 'var(--s-6) 0 0' }}>
        <p className="t-data ink-faint">CASE {caseNo(task.id)} · filed {fmtDateTime(task.createdAt)}</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)', flexWrap: 'wrap', marginTop: 'var(--s-2)' }}>
          <h1 className="t-h1">{task.title}</h1>
          <StatusChip status={task.status} verdict={v?.verdict} />
        </div>
      </div>

      <div className="grid-12" style={{ marginTop: 'var(--s-2)' }}>
        {/* ——— Filing (left, 7) ——— */}
        <div className="col-7">
          <DocketLine label="SLA" />
          <p className="t-body">{task.slaText}</p>

          <DocketLine label="Criteria" />
          <div className="filing ruled" style={{ padding: '0 var(--s-4)' }} ref={criteriaRoot}>
            {task.criteria.map((c, i) => (
              <CriterionRow key={i} index={i} text={c} result={v?.criteriaResults[i]} />
            ))}
          </div>

          {task.evidence && (
            <>
              <DocketLine label="Evidence" />
              <EvidencePanel evidence={task.evidence} />
            </>
          )}

          {v?.injectionDetected && (
            <div className="finding notmet" style={{ marginTop: 'var(--s-4)' }}>
              <span className="tag t-data">INJECTION</span>
              <span className="t-small">
                The deliverable contained instructions addressed to the adjudicator.
                They were treated as untrusted data and not executed; judgment
                proceeded on the actual content of the evidence.
              </span>
            </div>
          )}

          {task.firstVerdict && (
            <>
              <DocketLine label="First verdict — appealed" />
              <div className="filing ruled" style={{ padding: '0 var(--s-4)', opacity: 0.75 }}>
                {task.criteria.map((c, i) => (
                  <CriterionRow key={i} index={i} text={c} result={task.firstVerdict!.criteriaResults[i]} />
                ))}
              </div>
              {task.appeal?.outcome && (
                <p className="t-small ink-muted" style={{ marginTop: 'var(--s-3)' }}>
                  Appeal by {agentName(task.appeal.appellant)} — first verdict{' '}
                  <strong>{task.appeal.outcome === 'OVERTURNED' ? 'overturned' : 'upheld'}</strong>.
                  The second verdict is final.
                </p>
              )}
            </>
          )}
        </div>

        {/* ——— Status & settlement (right, 5) ——— */}
        <div className="col-5">
          <DocketLine label="Parties & stakes" />
          <div className="filing" style={{ padding: 'var(--s-3) var(--s-4)' }}>
            <Fact label="Buyer" value={`${agentName(task.buyer)} · ${shortAddr(task.buyer)}`} aria={`buyer ${agentName(task.buyer)}, address ${task.buyer}`} />
            {task.worker && (
              <Fact label="Worker" value={`${agentName(task.worker)} · ${shortAddr(task.worker)}`} aria={`worker ${agentName(task.worker)}, address ${task.worker}`} />
            )}
            <Fact label="Escrow" value={fmtGEN(task.escrow)} />
            <Fact label="Worker bond" value={fmtGEN(task.bond)} />
            <Fact label="Deadline" value={fmtDateTime(task.deadline)} />
            {v && <Fact label="Confidence" value={v.confidence} />}
            {v && <Fact label="Round" value={v.round === 2 ? '2 of 2 (final)' : '1'} />}
          </div>

          {(task.worker || task.buyer) && (
            <p className="t-small ink-faint" style={{ marginTop: 'var(--s-2)' }}>
              <Link to={`/agent/${task.worker ?? task.buyer}`}>View {agentName(task.worker ?? task.buyer)}'s record →</Link>
            </p>
          )}

          <DocketLine label="Proceedings" />

          {txHash && <div style={{ marginBottom: 'var(--s-4)' }}><TxLadder hash={txHash} /></div>}

          {task.status === 'OPEN' && (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <button className="btn btn-primary" onClick={() => setTxHash(writes.acceptTask(task.id))}>
                Stake bond & accept ({fmtGEN(task.bond)})
              </button>
              <button className="btn btn-destructive" onClick={() => setTxHash(writes.cancelTask(task.id))}>
                Cancel & reclaim escrow ({fmtGEN(task.escrow)})
              </button>
              <p className="t-small ink-faint">
                Accepting stakes a performance bond of {PARAMS.bondPct}% of escrow.
                Cancellation is available to the buyer while the task is unaccepted.
              </p>
            </div>
          )}

          {task.status === 'ACCEPTED' && <DeliverForm task={task} onTx={setTxHash} />}

          {task.status === 'ADJUDICATING' && (
            <p className="t-body ink-muted">
              Validators are deliberating. Each criterion is judged independently;
              consensus compares only the verdict enum and the per-criterion booleans.
            </p>
          )}

          {task.status === 'APPEALED' && !task.appeal?.outcome && (
            <p className="t-body ink-muted">
              Appeal bond posted. A fresh leader/validator round is re-adjudicating
              the deliverable. The second verdict is final.
            </p>
          )}

          {task.status === 'SOFT_ERROR' && (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <div className="finding">
                <span className="tag t-data">{task.errorTag}</span>
                <span className="t-small">{task.errorDetail}</span>
              </div>
              <p className="t-small ink-muted">
                Validators did not converge. No party is at fault. Resolve neutrally
                to return escrow to the buyer and bond to the worker — no slash, no
                reputation write.
              </p>
              <button className="btn btn-primary" onClick={() => setTxHash(writes.resolveNeutral(task.id))}>
                Resolve neutrally
              </button>
            </div>
          )}

          {task.status === 'EXPIRED' && (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <div className="finding notmet">
                <span className="tag t-data">DEADLINE</span>
                <span className="t-small">
                  The deadline passed with no delivery. The buyer may reclaim the
                  escrow; the full worker bond is slashed.
                </span>
              </div>
              <button className="btn btn-destructive" onClick={() => setTxHash(writes.reclaimExpired(task.id))}>
                Reclaim escrow + slash bond ({fmtGEN(task.escrow + task.bond)})
              </button>
            </div>
          )}

          {v && (task.status === 'ADJUDICATED' || task.status === 'FINAL') && (
            <>
              <VerdictSeal task={task} ceremony={ceremony} />
              {appealOpen && (
                <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                  <div className="window-note">
                    <span className="t-small">Appeal window closes in</span>
                    <span className="t-data">{fmtCountdown(msLeft)}</span>
                  </div>
                  <Link className="btn btn-secondary" to={`/case/${task.id}/appeal`}>
                    File appeal ({fmtGEN(pct(task.escrow, PARAMS.appealBondPct))})
                  </Link>
                  <p className="t-small ink-faint">
                    Settlement executes when the window closes. Either party may appeal
                    by posting a bond of {PARAMS.appealBondPct}% of escrow.
                  </p>
                </div>
              )}
            </>
          )}

          {task.settlement && (
            <>
              <DocketLine label="Settlement" />
              <div className="filing ruled" style={{ padding: '0 var(--s-4)' }}>
                {task.settlement.map((line, i) => (
                  <div key={i} className={`settlement-line sl-${line.kind}`}>
                    <span className="sl-label t-small">{line.label}</span>
                    <span className="t-data ink-faint">{agentName(line.to)}</span>
                    <span className="sl-amount t-data">{fmtGEN(line.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
