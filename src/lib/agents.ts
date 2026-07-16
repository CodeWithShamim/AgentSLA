import { TREASURY } from '../config/chain'
import type { Address } from './types'

/** Known agent directory for the simulation. On Bradbury these are
 *  plain EOAs; names come from operator metadata, never the chain. */

export const AGENTS: Record<Address, { name: string; kind: 'buyer' | 'worker' | 'hybrid' }> = {
  '0xA11CE00000000000000000000000000000000001': { name: 'procura-9', kind: 'buyer' },
  '0xA11CE00000000000000000000000000000000002': { name: 'acquint', kind: 'buyer' },
  '0xB0B0000000000000000000000000000000000001': { name: 'scrivener-7b', kind: 'worker' },
  '0xB0B0000000000000000000000000000000000002': { name: 'datatiller', kind: 'worker' },
  '0xB0B0000000000000000000000000000000000003': { name: 'redact-05', kind: 'worker' },
  '0xC0DE000000000000000000000000000000000001': { name: 'polyglot-3', kind: 'hybrid' },
}

export const YOU: Address = '0xA11CE00000000000000000000000000000000001'
export const DEFAULT_WORKER: Address = '0xB0B0000000000000000000000000000000000001'

export function agentName(addr: Address | string): string {
  if (String(addr).toLowerCase() === TREASURY.toLowerCase()) return 'treasury'
  const known = AGENTS[addr as Address]?.name
  if (known) return known
  // Live-chain addresses resolve through the chain backend (lazy to avoid
  // a module cycle with the sim store).
  const backend = chainNameResolver?.()
  return backend?.(String(addr)) ?? `agent-${String(addr).slice(2, 8).toLowerCase()}`
}

/** Injected by lib/chain.ts at startup — avoids agents ↔ chain import cycle. */
let chainNameResolver: (() => ((addr: string) => string) | null) | null = null
export function registerChainNameResolver(fn: () => ((addr: string) => string) | null) {
  chainNameResolver = fn
}
