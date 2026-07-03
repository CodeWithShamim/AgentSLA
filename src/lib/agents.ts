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

const TREASURY_ADDR = '0x7EA5000000000000000000000000000000000000'

export function agentName(addr: Address | string): string {
  if (addr === TREASURY_ADDR) return 'treasury'
  return AGENTS[addr as Address]?.name ?? 'unregistered'
}
