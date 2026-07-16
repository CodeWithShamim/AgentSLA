import { useState } from 'react'
import { TREASURY } from '../config/chain'
import { agentName } from '../lib/agents'
import { fmtGEN, shortAddr } from '../lib/format'
import { useActingAddress, useClaim, useVault, useWalletGate } from '../lib/reads'
import { ConnectWalletButton } from '../lib/wallet'
import { writes } from '../lib/writes'

/** Custody vault — the protocol's real-asset ledger (FR-3.0).
 *
 *  Renders the contract's solvency report (native custody vs. locked
 *  stakes vs. withdrawable claims) and the caller-facing pull-payment
 *  exit: settlement credits are claims on real GEN held by the contract,
 *  paid out with a native transfer on withdraw. */

function ClaimRow(props: { side?: 'buyer' | 'worker'; address: string; label: string }) {
  const claim = useClaim(props.address)
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle')
  const gate = useWalletGate()
  // Buyer claims are paid to the connected wallet — withdrawing requires
  // its signature; a session key never signs for the buyer side.
  const needWallet = props.side === 'buyer' && gate.required && !gate.connected

  const onWithdraw = async () => {
    if (!props.side) return
    setState('sending')
    try {
      await writes.withdraw(props.side, props.address as `0x${string}`)
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="tc-top" style={{ alignItems: 'center', padding: 'var(--s-3) 0' }}>
      <span className="tc-id t-data" aria-label={`address ${props.address}`}>
        {shortAddr(props.address)}
      </span>
      <span className="t-label ink-muted">{props.label}</span>
      <span className="tc-amount t-data" aria-label="withdrawable claim">
        {fmtGEN(claim)}
      </span>
      {props.side && (needWallet ? (
        claim > 0n && <ConnectWalletButton label="Connect wallet to withdraw" />
      ) : (
        <button
          className="btn btn-secondary"
          onClick={() => void onWithdraw()}
          disabled={claim <= 0n || state === 'sending'}
          aria-label={`withdraw claim for ${props.label}`}
        >
          {state === 'sending' ? 'Withdrawing…' : state === 'error' ? 'Retry withdraw' : 'Withdraw'}
        </button>
      ))}
    </div>
  )
}

export function VaultPanel() {
  const vault = useVault()
  const buyerAddr = useActingAddress('buyer')
  const workerAddr = useActingAddress('worker')

  if (!vault) return null

  const stats: Array<[string, string]> = [
    ['custody (native)', fmtGEN(vault.custody)],
    ['locked in cases', fmtGEN(vault.locked)],
    ['withdrawable', fmtGEN(vault.withdrawable)],
    ['paid out', fmtGEN(vault.paidOut)],
  ]

  return (
    <section aria-label="custody vault">
      <div className="filing" style={{ padding: 'var(--s-4) var(--s-5)' }}>
        <p className="t-body ink-muted">
          Every escrow, bond, and appeal bond is native GEN held by the contract.
          Settlements convert locked custody into withdrawable claims; withdrawal
          pays out with a real transfer. Invariant:{' '}
          <span className="t-data">custody = locked + withdrawable</span>.
        </p>
        <div className="tc-top" style={{ flexWrap: 'wrap', gap: 'var(--s-4)', marginTop: 'var(--s-3)' }}>
          {stats.map(([label, value]) => (
            <div key={label}>
              <div className="t-label ink-muted">{label}</div>
              <div className="t-data" style={{ fontSize: 'var(--fs-3, 1.1rem)' }}>{value}</div>
            </div>
          ))}
          <div>
            <div className="t-label ink-muted">solvency</div>
            <div className="t-data" role="status">
              {vault.backed ? 'FULLY BACKED' : 'UNDERCOLLATERALIZED'}
            </div>
          </div>
        </div>
        <div className="ruled" style={{ marginTop: 'var(--s-4)' }}>
          <ClaimRow side="buyer" address={buyerAddr} label={`${agentName(buyerAddr)} · buyer side`} />
          <ClaimRow side="worker" address={workerAddr} label={`${agentName(workerAddr)} · worker agent`} />
          <ClaimRow address={TREASURY} label="protocol treasury" />
        </div>
      </div>
    </section>
  )
}
