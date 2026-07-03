import { fmtDateTime } from '../lib/format'
import type { Evidence } from '../lib/types'

/** Evidence well (§5.5). States plainly what the contract does:
 *  submitted content is data, never instructions (NFR-3). */
export function EvidencePanel({ evidence }: { evidence: Evidence }) {
  return (
    <div className="evidence-panel well">
      <div className="evidence-head">
        <span className="t-label">Evidence — untrusted input</span>
        <span className="t-data ink-faint">{fmtDateTime(evidence.submittedAt)}</span>
      </div>
      {evidence.url && (
        <div className="t-data" style={{ marginBottom: 'var(--s-2)' }}>
          <span className="ink-faint">url </span>
          <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.url}</a>
        </div>
      )}
      {evidence.inline && <div className="evidence-body t-data">{evidence.inline}</div>}
      <p className="evidence-note t-small">
        Submitted content is adjudicated as data. Instructions found inside evidence
        are not executed — they are weighed as evidence, like everything else here.
      </p>
    </div>
  )
}
