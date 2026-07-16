import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth'
import { studionet } from 'genlayer-js/chains'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { PRIVY_APP_ID } from '../config/chain'
import { useTheme } from './theme'
import { chainBackend } from './chain'
import { shortAddr } from './format'
import type { Address } from './types'

/** Privy wallet connection.
 *
 *  The connected wallet signs the buyer-side of the protocol (filing tasks,
 *  cancels, appeals, settlement). The worker agent runs on a local session
 *  key — on-chain, a buyer cannot accept their own task, so the counterparty
 *  is always a distinct identity. Without a configured Privy app id the app
 *  signs with local session personas only.
 *
 *  Chain handling: GenLayer Studio (61999) is registered as Privy's default
 *  and only supported chain, and WalletSync force-switches the wallet on
 *  connect — otherwise viem rejects writes with "the current active chain id
 *  does not match the one in the transaction". */

const STUDIO_CHAIN = {
  id: studionet.id,
  name: studionet.name,
  nativeCurrency: studionet.nativeCurrency,
  rpcUrls: { default: { http: [...studionet.rpcUrls.default.http] } },
}

const STUDIO_CHAIN_HEX = `0x${studionet.id.toString(16)}`

export function WalletBoundary({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  if (!PRIVY_APP_ID) return <>{children}</>
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: theme === 'dark' ? 'dark' : 'light',
          accentColor: '#2643B4',
          logo: undefined,
        },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: STUDIO_CHAIN,
        supportedChains: [STUDIO_CHAIN],
      }}
    >
      <WalletSync />
      {children}
    </PrivyProvider>
  )
}

/** Make sure the wallet is on Studio before it becomes the signer.
 *  Embedded wallets follow defaultChain; external wallets (MetaMask etc.)
 *  need an explicit switch, and an add-chain first if 61999 is unknown. */
async function ensureStudioChain(wallet: {
  switchChain: (id: number) => Promise<unknown>
  getEthereumProvider: () => Promise<{ request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }>
}): Promise<void> {
  try {
    await wallet.switchChain(studionet.id)
    return
  } catch { /* likely unrecognized chain — add it, then switch */ }
  const provider = await wallet.getEthereumProvider()
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: STUDIO_CHAIN_HEX,
      chainName: studionet.name,
      nativeCurrency: studionet.nativeCurrency,
      rpcUrls: [...studionet.rpcUrls.default.http],
    }],
  })
  await wallet.switchChain(studionet.id)
}

/** A refused chain switch leaves the wallet authenticated but unwired;
 *  bumping this store re-runs WalletSync so the user can retry without
 *  disconnecting. */
let syncAttempt = 0
const syncListeners = new Set<() => void>()
function retryWalletSync() {
  syncAttempt++
  syncListeners.forEach((fn) => fn())
}
function useSyncAttempt(): number {
  return useSyncExternalStore(
    (fn) => { syncListeners.add(fn); return () => syncListeners.delete(fn) },
    () => syncAttempt,
  )
}

function WalletSync() {
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()
  const attempt = useSyncAttempt()

  useEffect(() => {
    let cancelled = false
    const wallet = authenticated ? wallets[0] : undefined
    if (!wallet) {
      chainBackend?.setPrivySigner(null, null)
      return
    }
    void (async () => {
      try {
        await ensureStudioChain(wallet)
        const provider = await wallet.getEthereumProvider()
        if (!cancelled) chainBackend?.setPrivySigner(wallet.address as Address, provider)
      } catch {
        // Wallet refused the chain switch — don't wire a signer that will
        // fail every write. Buyer actions stay gated behind the connect
        // prompt until the user retries the switch; nothing signs for them.
        if (!cancelled) chainBackend?.setPrivySigner(null, null)
      }
    })()
    return () => { cancelled = true }
  }, [authenticated, wallets, attempt])

  return null
}

/** Inline call-to-action rendered wherever a buyer-side write is gated on
 *  a wallet signature. Handles all three states: not logged in (connect),
 *  logged in but wallet not on Studio (retry the network switch), and
 *  Privy still booting. Renders nothing once the signer is wired. */
export function ConnectWalletButton({ label = 'Connect wallet to sign' }: { label?: string }) {
  if (!PRIVY_APP_ID) return null
  return <ConnectWalletInner label={label} />
}

function ConnectWalletInner({ label }: { label: string }) {
  const { ready, authenticated, login } = usePrivy()
  useSyncAttempt()
  const connected = useSyncExternalStore(
    (fn) => chainBackend?.subscribe(fn) ?? (() => {}),
    () => chainBackend?.connectedAddress ?? null,
  )

  if (connected) return null
  if (!ready) {
    return <button className="btn btn-primary" disabled>Loading wallet…</button>
  }
  if (!authenticated) {
    return <button className="btn btn-primary" onClick={login}>{label}</button>
  }
  // Authenticated but the signer isn't wired — the wallet is on the wrong
  // network (or the switch is still in flight). Offer an explicit retry.
  return (
    <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
      <button className="btn btn-primary" onClick={retryWalletSync}>
        Switch wallet to GenLayer Studio
      </button>
      <span className="t-small ink-faint">
        Your wallet is connected but not on the Studio network — approve the
        network switch to enable signing.
      </span>
    </div>
  )
}

export function WalletControls() {
  if (!PRIVY_APP_ID) return null
  return <PrivyControls />
}

/** Connected-wallet address: click to copy the full address. */
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      // Clipboard API unavailable (insecure context) — legacy fallback.
      const ta = document.createElement('textarea')
      ta.value = address
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      className="seal-download t-data"
      onClick={copy}
      title={`${address} — click to copy`}
      aria-label={`Copy connected wallet address ${address}`}
      style={{ cursor: 'pointer' }}
    >
      {copied ? 'copied ✓' : shortAddr(address)}
    </button>
  )
}

function PrivyControls() {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { wallets } = useWallets()

  if (!ready) return null

  if (!authenticated) {
    return (
      <button className="btn btn-secondary" style={{ padding: '4px 12px' }} onClick={login}>
        Connect wallet
      </button>
    )
  }

  const addr = wallets[0]?.address
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      {addr ? (
        <CopyAddress address={addr} />
      ) : (
        <span className="t-data">{user?.email?.address ?? 'connected'}</span>
      )}
      <button
        className="seal-download t-small"
        onClick={logout}
        aria-label="Disconnect wallet"
        style={{ textDecoration: 'underline' }}
      >
        disconnect
      </button>
    </span>
  )
}
