import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth'
import { studionet } from 'genlayer-js/chains'
import { useEffect, type ReactNode } from 'react'
import { PRIVY_APP_ID } from '../config/chain'
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
  if (!PRIVY_APP_ID) return <>{children}</>
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'light',
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

function WalletSync() {
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()

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
        // fail every write; buyer actions fall back to the local persona.
        if (!cancelled) chainBackend?.setPrivySigner(null, null)
      }
    })()
    return () => { cancelled = true }
  }, [authenticated, wallets])

  return null
}

export function WalletControls() {
  if (!PRIVY_APP_ID) return null
  return <PrivyControls />
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
      <span className="t-data" aria-label={`connected wallet ${addr ?? ''}`}>
        {addr ? shortAddr(addr) : user?.email?.address ?? 'connected'}
      </span>
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
