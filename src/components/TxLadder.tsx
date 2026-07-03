import { useTx } from '../lib/reads'
import { shortAddr } from '../lib/format'
import type { TxStep } from '../lib/types'

const STEPS: TxStep[] = ['submitted', 'pending', 'accepted', 'finalized']

/** Transaction state ladder (FR-7.2, §5.4). Rendered on every write —
 *  never hidden behind a toast; settlement is the product. */
export function TxLadder({ hash }: { hash: string | null }) {
  const res = useTx(hash)
  if (!res) return null
  const { tx, step } = res
  const current = STEPS.indexOf(step as TxStep)
  const terminalBad = step === 'failed' || step === 'soft-error'

  return (
    <div className="tx-ladder filing" role="status" aria-live="polite" aria-label={`Transaction ${tx.label}: ${step}`}>
      {STEPS.map((s, i) => {
        const cls =
          terminalBad && i > 1 ? '' :
          i < current || step === 'finalized' && i === STEPS.length - 1 ? 'done' :
          i === current ? 'active' : ''
        return (
          <span key={s} style={{ display: 'contents' }}>
            {i > 0 && <span className="tx-arrow t-data" aria-hidden>──▶</span>}
            <span className={`tx-step ${cls}`}>
              <span className="step-label t-data">{s}</span>
            </span>
          </span>
        )
      })}
      {terminalBad && (
        <>
          <span className="tx-arrow t-data" aria-hidden>└──▶</span>
          <span className={`tx-step ${step === 'failed' ? 'failed' : 'soft'}`}>
            <span className="step-label t-data">{step === 'failed' ? 'failed' : 'soft error'}</span>
          </span>
        </>
      )}
      <span className="tx-hash t-data" aria-label={`transaction hash ${tx.hash}`}>
        {tx.label.split('—')[0].trim()} · {shortAddr(tx.hash)}
      </span>
    </div>
  )
}
