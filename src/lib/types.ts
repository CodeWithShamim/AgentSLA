/** Core protocol types — mirrors the AgentSLA contract set (PRD §4, §5). */

export type Address = `0x${string}`

export type VerdictKind = 'MET' | 'PARTIAL' | 'NOT_MET'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type TaskStatus =
  | 'OPEN'
  | 'ACCEPTED'
  | 'DELIVERED'
  | 'ADJUDICATING'
  | 'ADJUDICATED'   // verdict in, appeal window running
  | 'APPEALED'      // re-adjudication pending or done (second verdict final)
  | 'SOFT_ERROR'    // LLM_ERROR / non-convergence — neutral resolution available
  | 'RESOLVED_NEUTRAL'
  | 'FINAL'
  | 'CANCELED'
  | 'EXPIRED'       // deadline missed, buyer reclaim available
  | 'ABANDONED'     // worker conceded early — buyer made whole immediately

/** FR-4 error taxonomy — deterministic string prefixes. */
export type ErrorTag = 'EXPECTED' | 'EXTERNAL' | 'TRANSIENT' | 'LLM_ERROR'

export interface CriterionResult {
  index: number
  met: boolean
  reason: string
}

export interface Verdict {
  verdict: VerdictKind
  criteriaResults: CriterionResult[]
  confidence: Confidence
  judgedAt: number            // ms epoch
  appealWindowEnds: number    // ms epoch
  round: 1 | 2                // 2 = post-appeal, final
  injectionDetected?: boolean
}

export interface Appeal {
  appellant: Address
  bond: bigint
  filedAt: number
  outcome?: 'UPHELD' | 'OVERTURNED'   // relative to first verdict
}

export interface SettlementLine {
  label: string
  to: Address
  amount: bigint
  kind: 'release' | 'refund' | 'bond-return' | 'slash' | 'appeal-bond' | 'neutral'
}

export interface Evidence {
  url?: string
  inline?: string
  submittedAt: number
}

/** Open offer from a worker to do the task for `price` (FR-8). */
export interface Bid {
  worker: Address
  price: bigint
  ts: number
}

export interface Task {
  id: number
  buyer: Address
  worker?: Address
  title: string               // deliverable_hint
  slaText: string
  criteria: string[]
  deadline: number            // ms epoch
  escrow: bigint              // wei-style, 18 decimals
  bond: bigint                // required/staked worker bond
  createdAt: number
  status: TaskStatus
  evidence?: Evidence
  verdict?: Verdict
  firstVerdict?: Verdict      // preserved when appealed
  appeal?: Appeal
  settlement?: SettlementLine[]
  errorTag?: ErrorTag
  errorDetail?: string
  bids?: Bid[]                // open bid book (FR-8)
  selectedWorker?: Address    // buyer-selected bidder; locks acceptance
  groupId?: number            // milestone group (FR-9)
  groupIndex?: number
  groupSize?: number
}

/** Transaction state ladder (FR-7.2). */
export type TxStep = 'submitted' | 'pending' | 'accepted' | 'finalized' | 'failed' | 'soft-error'

export interface TxRecord {
  hash: string
  label: string
  step: TxStep
  startedAt: number
  taskId?: number
}

export interface ReputationEvent {
  taskId: number
  role: 'buyer' | 'worker'
  verdict: VerdictKind | 'DEADLINE_MISS' | 'ABANDONED'
  delta: number
  timestamp: number
}

/** Custody solvency report — mirrors the contract's get_vault view.
 *  The backing invariant: custody == locked + withdrawable, always. */
export interface VaultReport {
  custody: bigint       // contract's real native balance
  locked: bigint        // backing open escrows / bonds / appeal bonds
  withdrawable: bigint  // sum of all claims payable
  paidOut: bigint       // cumulative native GEN paid via withdraw()
  surplus: bigint
  backed: boolean
}

export interface AgentRecord {
  address: Address
  name: string
  kind: 'buyer' | 'worker' | 'hybrid'
  score: number
  history: ReputationEvent[]
}
