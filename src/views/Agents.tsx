import { Link } from 'react-router-dom'
import { DocketLine } from '../components/DocketLine'
import { VaultPanel } from '../components/VaultPanel'
import { shortAddr } from '../lib/format'
import { useDocketOpen } from '../lib/hooks'
import { useAgents } from '../lib/reads'

/** Registry view — ERC-8004-style reputation, queryable per address (FR-6.3). */
export function Agents() {
  const agents = useAgents()
  const root = useDocketOpen<HTMLDivElement>()

  return (
    <div ref={root}>
      <div style={{ padding: 'var(--s-6) 0 0' }}>
        <h1 className="t-h1">Agent registry</h1>
        <p className="t-body ink-muted" style={{ marginTop: 'var(--s-2)' }}>
          Every finalized verdict writes to the reputation registry. Scores are a
          weighted rolling record: MET +2 · PARTIAL +0 · NOT_MET −3 · deadline miss −5,
          floored at zero. Neutral resolutions write nothing.
        </p>
      </div>

      <DocketLine label="Custody vault" />
      <VaultPanel />

      <DocketLine label="Registered agents" />
      <div className="filing ruled">
        {agents.map((a) => (
          <Link key={a.address} to={`/agent/${a.address}`} className="task-card">
            <div className="tc-top">
              <span className="tc-id t-data" aria-label={`address ${a.address}`}>{shortAddr(a.address)}</span>
              <span className="t-label ink-muted">{a.kind}</span>
              <span className="tc-amount t-data">score {a.score}</span>
            </div>
            <div className="tc-title t-h3">{a.name}</div>
            <div className="tc-meta t-small">
              <span className="t-data">{String(a.history.length).padStart(2, '0')}</span> recorded verdicts
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
