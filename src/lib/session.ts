import { createAccount, generatePrivateKey } from 'genlayer-js'
import type { Address } from './types'

/** Local session identities for StudioNet.
 *
 *  The protocol needs two parties (a buyer cannot accept their own task),
 *  so the app keeps two persistent session agents. When a Privy wallet is
 *  connected it replaces the active persona as the signer; the personas
 *  remain available for demoing the counterparty side. Keys live in
 *  localStorage only — Studio is a gasless test network. */

export type Persona = 'buyer' | 'worker'

const LS_KEY = 'agentsla-session-keys-v1'

interface Stored {
  buyer: `0x${string}`
  worker: `0x${string}`
}

function loadKeys(): Stored {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Stored
      if (parsed.buyer && parsed.worker) return parsed
    }
  } catch { /* regenerate below */ }
  const fresh: Stored = { buyer: generatePrivateKey(), worker: generatePrivateKey() }
  try { localStorage.setItem(LS_KEY, JSON.stringify(fresh)) } catch { /* in-memory only */ }
  return fresh
}

const keys = loadKeys()

export const sessionAccounts = {
  buyer: createAccount(keys.buyer),
  worker: createAccount(keys.worker),
}

export function personaAddress(p: Persona): Address {
  return sessionAccounts[p].address as Address
}
