import { Link, useParams } from 'react-router-dom'
import { DocketLine } from '../components/DocketLine'
import { countUp, playDocketOpen, revealRows } from '../design/motion'
import { caseNo, fmtDate } from '../lib/format'
import { useCourtMotion } from '../lib/hooks'
import { useAgent } from '../lib/reads'
import type { Address } from '../lib/types'

const VERDICT_LABEL: Record<string, string> = {
  MET: 'Met', PARTIAL: 'Partial', NOT_MET: 'Not met', DEADLINE_MISS: 'Deadline miss',
}

export function AgentProfile() {
  const { address } = useParams()
  const agent = useAgent((address ?? '0x0') as Address)
  const score = agent.score
  const root = useCourtMotion<HTMLDivElement>((el) => {
    playDocketOpen(el)
    const fig = el.querySelector<HTMLElement>('.score-figure')
    if (fig) countUp(fig, 0, score)
    revealRows(el.querySelectorAll('.history-row'), { stagger: 0.06 })
  }, [address, agent.history.length > 0])

  return (
    <div ref={root}>
      <div style={{ padding: 'var(--s-6) 0 0' }}>
        <p className="t-data ink-faint" aria-label={`agent address ${agent.address}`}>{agent.address}</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)', marginTop: 'var(--s-2)' }}>
          <h1 className="t-h1">{agent.name}</h1>
          <span className="t-label ink-muted">{agent.kind}</span>
        </div>
      </div>

      <div className="grid-12">
        <div className="col-5">
          <DocketLine label="Reputation score" />
          <div className="filing" style={{ padding: 'var(--s-5)' }}>
            <div className="score-figure" aria-label={`reputation score ${agent.score}`}>{agent.score}</div>
            <p className="t-small ink-muted" style={{ marginTop: 'var(--s-2)' }}>
              Weighted rolling record, floored at zero. ERC-8004-compatible read shape:
              <span className="t-data"> get_score(address)</span>.
            </p>
          </div>
        </div>

        <div className="col-7">
          <DocketLine label="Verdict history" />
          {agent.history.length === 0 ? (
            <p className="t-body ink-muted">No finalized verdicts recorded for this agent.</p>
          ) : (
            <div className="filing ruled" style={{ padding: '0 var(--s-4)' }}>
              {agent.history.map((e, i) => (
                <div key={i} className="history-row">
                  <Link className="t-data" to={`/case/${e.taskId}`}>{caseNo(e.taskId)}</Link>
                  <span className="t-small">
                    {VERDICT_LABEL[e.verdict]} · as {e.role}
                  </span>
                  <span
                    className={`t-data ${e.delta > 0 ? 'delta-pos' : e.delta < 0 ? 'delta-neg' : 'delta-zero'}`}
                  >
                    {e.delta > 0 ? `+${e.delta}` : e.delta}
                  </span>
                  <span className="t-data ink-faint">{fmtDate(e.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
