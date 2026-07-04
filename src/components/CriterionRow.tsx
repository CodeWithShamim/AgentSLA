import { useState } from 'react'
import { fmtIndex } from '../lib/format'
import { useMountReveal } from '../lib/hooks'
import type { CriterionResult } from '../lib/types'

/** The atomic unit of the product — one row per SLA criterion (§5.3).
 *  Only the boolean is consensus; the reason is testimony. */
export function CriterionRow({ index, text, result }: {
  index: number
  text: string
  result?: CriterionResult
}) {
  const [open, setOpen] = useState(false)
  const reasonRef = useMountReveal<HTMLDivElement>(open)
  const state = result ? (result.met ? 'met' : 'notmet') : 'pending'

  return (
    <div className="criterion-row">
      <div className="criterion-main">
        <span className="criterion-index t-data">{fmtIndex(index)}</span>
        <span className="t-body">{text}</span>
        {result ? (
          <span className="criterion-verdict">
            <span className={`criterion-dot dot-${state}`} aria-hidden />
            <span
              className="t-label"
              style={{ color: result.met ? 'var(--verdict-met)' : 'var(--verdict-notmet)' }}
            >
              {result.met ? 'Met' : 'Not met'}
            </span>
            <button
              className="criterion-reason-toggle t-small"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} adjudicator reason for criterion ${index + 1}`}
            >
              {open ? '▾' : '▸'} reason
            </button>
          </span>
        ) : (
          <span className="criterion-verdict">
            <span className="criterion-dot dot-pending" aria-hidden />
            <span className="t-label ink-faint">Pending</span>
          </span>
        )}
      </div>
      {result && open && (
        <div className="criterion-main" ref={reasonRef} style={{ overflow: 'hidden' }}>
          <span />
          <div className="criterion-reason t-small">
            “{result.reason}”
            <div className="reason-note">
              Adjudicator testimony — only the boolean above is consensus data.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
