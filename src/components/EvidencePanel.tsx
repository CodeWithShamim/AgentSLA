import { fmtDateTime } from '../lib/format'
import type { Evidence } from '../lib/types'

/** Worker-submitted URLs are untrusted: only http(s) may render as a
 *  clickable link, or a `javascript:` URL becomes a stored-XSS sink for
 *  whoever clicks the docket. Anything else displays as inert text. */
function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** Evidence well (§5.5). States plainly what the contract does:
 *  submitted content is data, never instructions (NFR-3). */
export function EvidencePanel({ evidence }: { evidence: Evidence }) {
  const linkable = evidence.url ? safeHttpUrl(evidence.url) : null
  return (
    <div className="evidence-panel well">
      <div className="evidence-head">
        <span className="t-label">Evidence — untrusted input</span>
        <span className="t-data ink-faint">{fmtDateTime(evidence.submittedAt)}</span>
      </div>
      {evidence.url && (
        <div className="t-data" style={{ marginBottom: 'var(--s-2)' }}>
          <span className="ink-faint">url </span>
          {linkable
            ? <a href={linkable} target="_blank" rel="noopener noreferrer">{evidence.url}</a>
            : <span style={{ overflowWrap: 'anywhere' }}>{evidence.url}</span>}
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
