/** Section divider with its label sitting on the rule — the "docket line",
 *  the system's structural motif (§4). */
export function DocketLine({ label }: { label: string }) {
  return (
    <div className="docket-line" role="heading" aria-level={2} aria-label={label}>
      <span className="dl-rule-lead" aria-hidden />
      <span className="dl-label t-label">{label}</span>
      <span className="dl-rule" aria-hidden />
    </div>
  )
}
