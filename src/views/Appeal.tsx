import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PARAMS } from '../config/chain'
import { CriterionRow } from '../components/CriterionRow'
import { DocketLine } from '../components/DocketLine'
import { TxLadder } from '../components/TxLadder'
import { agentName } from '../lib/agents'
import { caseNo, fmtCountdown, fmtGEN, pct } from '../lib/format'
import { useDocketOpen } from '../lib/hooks'
import { useNow, useTask } from '../lib/reads'
import { writes } from '../lib/writes'
import type { Address } from '../lib/types'

/** Appeal flow (FR-5). Bond = 10% of escrow; a fresh leader/validator
 *  round re-adjudicates; the second verdict is final. */
export function Appeal() {
  const { id } = useParams()
  const nav = useNavigate()
  const task = useTask(Number(id))
  const now = useNow()
  const root = useDocketOpen<HTMLDivElement>([id])
  const [party, setParty] = useState<'buyer' | 'worker'>('worker')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [filed, setFiled] = useState(false)

  if (!task || !task.verdict || task.status !== 'ADJUDICATED') {
    return (
      <div>
        <DocketLine label="Appeal unavailable" />
        <p className="t-body ink-muted">
          {task
            ? 'This case has no open appeal window.'
            : 'No such case on the docket.'}{' '}
          <Link to={task ? `/case/${task.id}` : '/'}>Return to the {task ? 'case' : 'docket'}.</Link>
        </p>
      </div>
    )
  }

  const v = task.verdict
  const msLeft = v.appealWindowEnds - now
  const bond = pct(task.escrow, PARAMS.appealBondPct)
  const appellant: Address = (party === 'buyer' ? task.buyer : task.worker!) as Address

  const file = () => {
    const hash = writes.fileAppeal(task.id, appellant)
    setTxHash(hash)
    setFiled(true)
    setTimeout(() => nav(`/case/${task.id}`), 3200)
  }

  return (
    <div ref={root} style={{ maxWidth: 720 }}>
      <div style={{ padding: 'var(--s-6) 0 0' }}>
        <p className="t-data ink-faint">CASE {caseNo(task.id)} · appeal window</p>
        <h1 className="t-h1" style={{ marginTop: 'var(--s-2)' }}>File an appeal</h1>
        <div className="window-note" style={{ marginTop: 'var(--s-3)' }}>
          <span className="t-small">Window closes in</span>
          <span className="t-data">{fmtCountdown(msLeft)}</span>
        </div>
      </div>

      <DocketLine label="Verdict under appeal" />
      <div className="filing ruled" style={{ padding: '0 var(--s-4)' }}>
        {task.criteria.map((c, i) => (
          <CriterionRow key={i} index={i} text={c} result={v.criteriaResults[i]} />
        ))}
      </div>

      <DocketLine label="Appellant" />
      <div style={{ display: 'grid', gap: 'var(--s-2)' }} role="radiogroup" aria-label="Appealing party">
        {(['worker', 'buyer'] as const).map((p) => {
          const addr = p === 'buyer' ? task.buyer : task.worker!
          return (
            <label key={p} className="filing" style={{ padding: 'var(--s-3) var(--s-4)', display: 'flex', gap: 'var(--s-3)', alignItems: 'baseline', cursor: 'pointer' }}>
              <input type="radio" name="party" checked={party === p} onChange={() => setParty(p)} />
              <span className="t-body">{agentName(addr)}</span>
              <span className="t-label ink-muted">{p}</span>
            </label>
          )
        })}
      </div>

      <DocketLine label="Consequence" />
      <p className="t-body ink-muted">
        Filing posts an appeal bond of <span className="t-data" style={{ color: 'var(--ink)' }}>{fmtGEN(bond)}</span>{' '}
        ({PARAMS.appealBondPct}% of escrow) and triggers a fresh leader/validator
        round. If the second verdict moves in the appellant's favor, the bond is
        returned; otherwise it is forfeited to the counterparty. The second verdict
        is final — there is no further appeal.
      </p>

      <div style={{ marginTop: 'var(--s-5)', display: 'grid', gap: 'var(--s-4)' }}>
        {!filed && (
          <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
            <button className="btn btn-primary" onClick={file}>
              File appeal ({fmtGEN(bond)})
            </button>
            <Link className="btn btn-secondary" to={`/case/${task.id}`}>Return to case</Link>
          </div>
        )}
        {txHash && <TxLadder hash={txHash} />}
        {filed && <p className="t-small ink-muted">Appeal filed — returning to the case for re-adjudication…</p>}
      </div>
    </div>
  )
}
