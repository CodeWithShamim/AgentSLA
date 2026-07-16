/** Typed chain config (FR-7.5).
 *
 *  The app targets GenLayer Studio Network with the deployed AgentSLA
 *  contract from deployment.json (written by scripts/deploy.mjs). If no
 *  deployment is present the app falls back to the local protocol
 *  simulation — same states, same math — so the UI always works. */

import deployment from './deployment.json'
import type { Address } from '../lib/types'

export const CHAIN = {
  id: deployment.chainId,
  name: 'GenLayer Studio Network',
  rpcUrl: deployment.rpcUrl,
  currency: 'GEN',
} as const

/** Bradbury remains the production target (PRD); Studio is the live demo net. */
export const BRADBURY = {
  id: 4221,
  name: 'GenLayer Bradbury Testnet',
  rpcUrl: 'https://rpc-bradbury.genlayer.com',
} as const

export const CONTRACT_ADDRESS: Address | null =
  (deployment.address as Address) ?? null

/** GenLayer Studio block explorer (studionet). */
export const EXPLORER_URL = 'https://explorer-studio.genlayer.com'

export const explorerAddressUrl = (address: string): string =>
  `${EXPLORER_URL}/address/${address}`

export const ON_CHAIN = Boolean(CONTRACT_ADDRESS)

/** Protocol parameters (mirrors the deployed contract's get_params). */
export const PARAMS = {
  minEscrow: BigInt(deployment.minEscrow ?? '1000000000000000000'),
  bondPct: 20,                          // worker bond = 20% of escrow (FR-1.3)
  appealBondPct: 10,                    // appeal bond = 10% of escrow (FR-5.2)
  appealWindowMs: deployment.appealWindowMs ?? 120_000,
  slashBuyerPct: 50,                    // NOT_MET slash split (FR-3.3)
} as const

/** Slash revenue accrues to the deployer (recorded at deploy time). */
export const TREASURY: Address =
  ((deployment as Record<string, unknown>).treasury as Address | undefined)
  ?? '0x7EA5000000000000000000000000000000000000'

export const PRIVY_APP_ID: string | undefined = import.meta.env.VITE_PRIVY_APP_ID
