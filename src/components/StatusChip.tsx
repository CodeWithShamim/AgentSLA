import type { TaskStatus } from '../lib/types'

const MAP: Record<TaskStatus, { label: string; cls: string }> = {
  OPEN:             { label: 'Open',          cls: 'chip-open' },
  ACCEPTED:         { label: 'Accepted',      cls: 'chip-accepted' },
  DELIVERED:        { label: 'Delivered',     cls: 'chip-delivered' },
  ADJUDICATING:     { label: 'Adjudicating',  cls: 'chip-adjudicating' },
  ADJUDICATED:      { label: 'Verdict in',    cls: 'chip-accepted' },
  APPEALED:         { label: 'Appealed',      cls: 'chip-appealed' },
  SOFT_ERROR:       { label: 'Soft error',    cls: 'chip-soft' },
  RESOLVED_NEUTRAL: { label: 'Resolved — neutral', cls: 'chip-soft' },
  FINAL:            { label: 'Final',         cls: 'chip-final' },
  CANCELED:         { label: 'Canceled',      cls: 'chip-canceled' },
  EXPIRED:          { label: 'Deadline missed', cls: 'chip-expired' },
}

const VERDICT_CLS = { MET: 'chip-met', PARTIAL: 'chip-partial', NOT_MET: 'chip-notmet' } as const

export function StatusChip({ status, verdict }: {
  status: TaskStatus
  verdict?: 'MET' | 'PARTIAL' | 'NOT_MET'
}) {
  // A finalized case with a verdict reads as the verdict, chip-final styled by hue
  if ((status === 'ADJUDICATED' || status === 'FINAL') && verdict) {
    const label = verdict === 'NOT_MET' ? 'Not met' : verdict === 'PARTIAL' ? 'Partial' : 'Met'
    return (
      <span className={`status-chip t-label ${VERDICT_CLS[verdict]}`}>
        {label}
        {status === 'FINAL' && <span aria-hidden>·</span>}
        {status === 'FINAL' && 'Final'}
      </span>
    )
  }
  const m = MAP[status]
  return <span className={`status-chip t-label ${m.cls}`}>{m.label}</span>
}
