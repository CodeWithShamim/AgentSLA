/** Typed chain config (FR-7.5). Contract addresses are wired from
 *  `genlayer schema` output after Bradbury deploy (never hand-typed ABIs).
 *  While addresses are unset the app runs in SIMULATION mode: the full
 *  protocol lifecycle is emulated locally with the same types and states. */

import type { Address } from '../lib/types'

export const CHAIN = {
  id: 4221,
  name: 'GenLayer Bradbury Testnet',
  rpcUrl: 'https://rpc-bradbury.genlayer.com',
  currency: 'GEN',
} as const

export const CONTRACTS: Record<string, Address | null> = {
  TaskRegistry: null,
  SLAAdjudicator: null,
  EscrowVault: null,
  AgentReputation: null,
  AppealManager: null,
}

export const SIMULATION = Object.values(CONTRACTS).some((a) => a === null)

/** Protocol parameters (mirrors contract config). */
export const PARAMS = {
  minEscrow: 10n ** 18n,               // 1 GEN
  bondPct: 20,                          // worker bond = 20% of escrow (FR-1.3)
  appealBondPct: 10,                    // appeal bond = 10% of escrow (FR-5.2)
  /** 24h on-chain (FR-5.1); shortened in simulation so the demo is watchable. */
  appealWindowMs: SIMULATION ? 90_000 : 24 * 3600_000,
  slashBuyerPct: 50,                    // NOT_MET slash split (FR-3.3)
} as const

export const TREASURY: Address = '0x7EA5000000000000000000000000000000000000'
