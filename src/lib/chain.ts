import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { transactionsStatusNumberToName } from 'genlayer-js/types'
import { CHAIN, CONTRACT_ADDRESS, PARAMS, PRIVY_APP_ID, TREASURY } from '../config/chain'
import { registerChainNameResolver } from './agents'
import { pct } from './format'
import { sessionAccounts, type Persona } from './session'
import type {
  Address, AgentRecord, ReputationEvent, SettlementLine,
  Task, TaskStatus, TxRecord, TxStep, VaultReport, VerdictKind,
} from './types'

/** ChainBackend — the live StudioNet data layer.
 *
 *  Polls the deployed AgentSLA contract and mirrors it into the same
 *  Task/TxRecord shapes the views already consume. Buyer-side writes are
 *  signed by the connected Privy wallet — required, never substituted.
 *  The worker agent runs on a local session key: the human operator is
 *  the buyer, and a buyer cannot accept their own task on-chain. */

const POLL_MS = 4000
const TX_POLL_MS = 2500
const DOCKET_PAGE = 50   // get_tasks_page hard cap (contract-enforced)

type Listener = () => void

interface Signer {
  kind: 'persona' | 'privy'
  address: Address
  account?: (typeof sessionAccounts)['buyer']
  provider?: unknown
}

// The full static chain definition — carries the consensus contract
// metadata genlayer-js resolves write transactions against.
const chainConfig = studionet

function statusName(s: unknown): string {
  if (typeof s === 'number' || (typeof s === 'string' && /^\d+$/.test(s))) {
    return (transactionsStatusNumberToName as Record<string, string>)[String(s)] ?? 'PENDING'
  }
  return String(s ?? 'PENDING')
}

function toLadderStep(name: string): TxStep {
  switch (name) {
    case 'FINALIZED': return 'finalized'
    case 'ACCEPTED':
    case 'READY_TO_FINALIZE': return 'accepted'
    case 'UNDETERMINED':
    case 'VALIDATORS_TIMEOUT':
    case 'LEADER_TIMEOUT': return 'soft-error'
    case 'CANCELED': return 'failed'
    default: return 'pending'
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapTask(raw: any, pendingKind: string | undefined): Task {
  const verdictObj = raw.verdict
    ? {
        verdict: raw.verdict as VerdictKind,
        criteriaResults: (raw.criteria_results as any[]).map((r) => ({
          index: Number(r.index), met: Boolean(r.met), reason: String(r.reason ?? ''),
        })),
        confidence: (raw.confidence ?? 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
        judgedAt: Number(raw.judged_ms),
        appealWindowEnds: Number(raw.window_ends_ms),
        round: (Number(raw.round) === 2 ? 2 : 1) as 1 | 2,
        injectionDetected: Boolean(raw.injection),
      }
    : undefined

  const firstVerdict = raw.first_verdict
    ? {
        verdict: raw.first_verdict as VerdictKind,
        criteriaResults: (raw.first_results as any[]).map((r) => ({
          index: Number(r.index), met: Boolean(r.met), reason: String(r.reason ?? ''),
        })),
        confidence: 'HIGH' as const,
        judgedAt: Number(raw.judged_ms),
        appealWindowEnds: Number(raw.window_ends_ms),
        round: 1 as const,
      }
    : undefined

  let status = raw.status as TaskStatus
  if (status === 'ACCEPTED' && Date.now() > Number(raw.deadline_ms)) status = 'EXPIRED'
  // In-flight adjudication/appeal shows as the live deliberation state.
  if (pendingKind === 'deliver' && (status === 'ACCEPTED' || status === 'EXPIRED')) status = 'ADJUDICATING'
  if (pendingKind === 'appeal' && status === 'ADJUDICATED') status = 'APPEALED'

  const settlement: SettlementLine[] = (raw.settlement as any[]).map((l) => ({
    label: String(l.label), to: l.to as Address,
    amount: BigInt(l.amount), kind: l.kind,
  }))

  return {
    id: Number(raw.id),
    buyer: raw.buyer as Address,
    worker: (raw.worker ?? undefined) as Address | undefined,
    title: String(raw.title),
    slaText: String(raw.sla_text),
    criteria: (raw.criteria as string[]).map(String),
    deadline: Number(raw.deadline_ms),
    escrow: BigInt(raw.escrow),
    bond: BigInt(raw.bond),
    createdAt: Number(raw.created_ms),
    status,
    evidence: raw.evidence_ms
      ? {
          url: raw.evidence_url || undefined,
          inline: raw.evidence_inline || undefined,
          submittedAt: Number(raw.evidence_ms),
        }
      : undefined,
    verdict: verdictObj,
    firstVerdict,
    appeal: raw.appellant
      ? {
          appellant: raw.appellant as Address,
          bond: BigInt(raw.appeal_bond),
          filedAt: Number(raw.judged_ms),
          outcome: (raw.appeal_outcome ?? undefined) as 'UPHELD' | 'OVERTURNED' | undefined,
        }
      : undefined,
    settlement: settlement.length ? settlement : undefined,
    errorTag: (raw.error_tag ?? undefined) as Task['errorTag'],
    errorDetail: raw.error_detail ?? undefined,
    bids: ((raw.bids ?? []) as any[]).map((b) => ({
      worker: b.worker as Address, price: BigInt(b.price), ts: Number(b.ts),
    })),
    selectedWorker: (raw.selected_worker ?? undefined) as Address | undefined,
    groupId: raw.group_id ? Number(raw.group_id) : undefined,
    groupIndex: Number(raw.group_index ?? 0),
    groupSize: Number(raw.group_size ?? 0),
  }
}

class ChainBackend {
  private listeners = new Set<Listener>()
  private tasks: Task[] = []
  private repEvents: any[] = []
  private txs: TxRecord[] = []
  private vault: VaultReport | null = null
  private claims: Record<string, bigint> = {}
  /** taskId → 'deliver' | 'appeal' while that tx is in flight */
  private pendingByTask = new Map<number, string>()
  private privySigner: Signer | null = null
  private funded = new Set<string>()
  private everSucceeded = false
  private consecutiveFailures = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null

  readonly address = CONTRACT_ADDRESS!

  private readClient = createClient({ chain: chainConfig })

  start() {
    if (this.pollTimer) return
    void this.poll()
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    this.listeners.forEach((fn) => fn())
  }

  /** true once the contract has answered at least one poll */
  get healthy(): boolean { return this.everSucceeded }
  get unreachable(): boolean { return !this.everSucceeded && this.consecutiveFailures >= 3 }

  /** Connection state for the header badge — reads and writes always target
   *  the chain; this only reports whether the RPC is currently answering. */
  get health(): 'connecting' | 'ok' | 'degraded' | 'unreachable' {
    if (this.consecutiveFailures >= 3) return this.everSucceeded ? 'degraded' : 'unreachable'
    return this.everSucceeded ? 'ok' : 'connecting'
  }

  // ----- signers -----

  setPrivySigner(address: Address | null, provider: unknown) {
    this.privySigner = address ? { kind: 'privy', address, provider } : null
    if (address) void this.fund(address)
    this.notify()
  }

  get connectedAddress(): Address | null {
    return this.privySigner?.address ?? null
  }

  personaAddress(p: Persona): Address {
    return sessionAccounts[p].address as Address
  }

  private async fund(address: string) {
    if (this.funded.has(address)) return
    this.funded.add(address)
    try {
      // Escrows/bonds ride as real value now, so accounts need a real sim
      // balance (wei scale). 1e22 wei = 10,000 GEN exceeds Number.MAX_SAFE_INTEGER,
      // so the JSON-RPC body is built by hand to keep the integer literal exact.
      const amount = (10_000n * 10n ** 18n).toString()
      await fetch(CHAIN.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: `{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount","params":["${address}",${amount}]}`,
      })
    } catch { /* gasless network — funding is best-effort */ }
  }

  /** Buyer-side actions are signed by the connected wallet — when wallet
   *  auth is configured, there is no fallback signer: an unconnected buyer
   *  write throws instead of silently signing with a local key. The worker
   *  agent (the distinct counterparty — a buyer cannot accept their own
   *  task) runs on the local session key. */
  private clientFor(side: Persona) {
    if (side === 'buyer') {
      if (this.privySigner) {
        return createClient({
          chain: chainConfig,
          account: this.privySigner.address,
          provider: this.privySigner.provider as never,
        })
      }
      if (PRIVY_APP_ID) {
        throw new Error(
          'WALLET_REQUIRED: connect your wallet to sign this action — '
          + 'buyer-side transactions move real funds and are never signed by a session key.',
        )
      }
    }
    const account = sessionAccounts[side]
    void this.fund(account.address)
    return createClient({ chain: chainConfig, account })
  }

  actingAddress(side: Persona): Address {
    if (side === 'buyer' && this.privySigner) return this.privySigner.address
    return sessionAccounts[side].address as Address
  }

  // ----- reads -----

  /** Bounded docket read (FR-11): pages through get_tasks_page instead of
   *  the unbounded get_tasks, so payload size stays flat as the docket
   *  grows. Page 1 carries the total; the rest fetch in parallel. */
  private async fetchDocket(): Promise<any[]> {
    const readPage = (offset: number) =>
      this.readClient.readContract({
        address: this.address, functionName: 'get_tasks_page', args: [offset, DOCKET_PAGE],
      })
    const first = JSON.parse(String(await readPage(0)))
    const all: any[] = [...first.tasks]
    const total = Number(first.total)
    if (total > DOCKET_PAGE) {
      const offsets: number[] = []
      for (let o = DOCKET_PAGE; o < total; o += DOCKET_PAGE) offsets.push(o)
      const pages = await Promise.all(offsets.map(readPage))
      for (const p of pages) all.push(...JSON.parse(String(p)).tasks)
    }
    return all
  }

  private async poll() {
    try {
      const claimAddrs = [
        ...new Set([this.actingAddress('buyer'), this.actingAddress('worker'), TREASURY]
          .map((a) => a.toLowerCase())),
      ]
      const [taskRows, repJson, vaultJson, ...claims] = await Promise.all([
        this.fetchDocket(),
        this.readClient.readContract({ address: this.address, functionName: 'get_reputation', args: [] }),
        this.readClient.readContract({ address: this.address, functionName: 'get_vault', args: [] }),
        ...claimAddrs.map((a) =>
          this.readClient.readContract({ address: this.address, functionName: 'get_balance', args: [a] })),
      ])
      this.tasks = taskRows
        .map((raw) => mapTask(raw, this.pendingByTask.get(Number(raw.id))))
        .sort((a, b) => b.id - a.id)
      this.repEvents = JSON.parse(String(repJson))
      const v = JSON.parse(String(vaultJson))
      this.vault = {
        custody: BigInt(v.custody), locked: BigInt(v.locked),
        withdrawable: BigInt(v.withdrawable), paidOut: BigInt(v.paid_out),
        surplus: BigInt(v.surplus), backed: Boolean(v.backed),
      }
      this.claims = Object.fromEntries(claimAddrs.map((a, i) => [a, BigInt(String(claims[i]))]))
      this.everSucceeded = true
      this.consecutiveFailures = 0
    } catch {
      this.consecutiveFailures++
    }
    this.notify()
  }

  getTasks(): Task[] { return this.tasks }
  getTask(id: number): Task | undefined { return this.tasks.find((t) => t.id === id) }
  getVault(): VaultReport | null { return this.vault }
  getClaim(address: string): bigint { return this.claims[address.toLowerCase()] ?? 0n }
  getTx(hash: string): TxRecord | undefined { return this.txs.find((t) => t.hash === hash) }
  txStep(tx: TxRecord): TxStep { return tx.step }

  getAgents(): AgentRecord[] {
    const addrs = new Set<string>()
    for (const t of this.tasks) {
      addrs.add(t.buyer)
      if (t.worker) addrs.add(t.worker)
    }
    for (const e of this.repEvents) addrs.add(e.agent)
    return [...addrs].map((a) => this.getAgent(a as Address))
  }

  getAgent(address: Address): AgentRecord {
    const history: ReputationEvent[] = this.repEvents
      .filter((e) => e.agent.toLowerCase() === address.toLowerCase())
      .map((e) => ({
        taskId: Number(e.task_id),
        role: e.role,
        verdict: e.verdict,
        delta: Number(e.delta),
        timestamp: Number(e.ts),
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
    const raw = history.filter((h) => h.role === 'worker').reduce((s, e) => s + e.delta, 0)
    const isBuyer = this.tasks.some((t) => t.buyer.toLowerCase() === address.toLowerCase())
    const isWorker = this.tasks.some((t) => t.worker?.toLowerCase() === address.toLowerCase())
    return {
      address,
      name: this.nameOf(address),
      kind: isBuyer && isWorker ? 'hybrid' : isWorker ? 'worker' : 'buyer',
      score: Math.max(0, raw),
      history,
    }
  }

  nameOf(address: string): string {
    const a = address.toLowerCase()
    if (a === TREASURY.toLowerCase()) return 'treasury'
    if (this.privySigner && a === this.privySigner.address.toLowerCase()) return 'you (wallet)'
    if (a === sessionAccounts.buyer.address.toLowerCase()) return 'buyer agent (local)'
    if (a === sessionAccounts.worker.address.toLowerCase()) return 'worker agent (local)'
    return `agent-${address.slice(2, 8).toLowerCase()}`
  }

  // ----- writes -----

  private async submitTx(
    side: Persona,
    functionName: string,
    args: unknown[],
    label: string,
    taskId?: number,
    pendingKind?: string,
    value: bigint = 0n,
  ): Promise<string> {
    const client = this.clientFor(side)
    const write = () => client.writeContract({
      address: this.address,
      functionName,
      args: args as never[],
      value,
    })
    let hash: string
    try {
      hash = await write()
    } catch (e) {
      // Wallet drifted off Studio (e.g. user switched networks): viem
      // rejects with a chain-id mismatch. Switch back once and retry.
      const msg = String((e as Error)?.message ?? e)
      const provider = this.privySigner?.provider as
        | { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined
      if (side === 'buyer' && provider && /chain id|chain of the connection|switch/i.test(msg)) {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${studionet.id.toString(16)}` }],
        })
        hash = await write()
      } else {
        throw e
      }
    }
    const tx: TxRecord = { hash, label, step: 'submitted', startedAt: Date.now(), taskId }
    this.txs.push(tx)
    if (this.txs.length > 40) this.txs.splice(0, this.txs.length - 40)
    if (taskId !== undefined && pendingKind) this.pendingByTask.set(taskId, pendingKind)
    this.notify()
    void this.trackTx(tx, taskId)
    return hash
  }

  private async trackTx(tx: TxRecord, taskId?: number) {
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, TX_POLL_MS))
      try {
        const t = await this.readClient.getTransaction({ hash: tx.hash as never })
        const name = statusName((t as any)?.status)
        const step = toLadderStep(name)
        if (step !== tx.step) {
          tx.step = step
          if (step === 'accepted' || step === 'finalized' || step === 'soft-error' || step === 'failed') {
            if (taskId !== undefined && step !== 'accepted') this.pendingByTask.delete(taskId)
            void this.poll()
          }
          this.notify()
        }
        if (step === 'finalized' || step === 'failed') {
          if (taskId !== undefined) this.pendingByTask.delete(taskId)
          void this.poll()
          return
        }
        // ACCEPTED is a decided state on Studio; adjudication result is
        // already readable. Stop pending overlay once accepted.
        if (step === 'accepted' && taskId !== undefined) {
          this.pendingByTask.delete(taskId)
        }
        if (step === 'soft-error') return
      } catch { /* keep polling */ }
    }
  }

  async createTask(input: {
    title: string; slaText: string; criteria: string[]
    deadline: number; escrow: bigint
  }): Promise<{ hash: string }> {
    // The escrow rides as the transaction value — real GEN into custody.
    return {
      hash: await this.submitTx('buyer', 'create_task', [
        input.title, input.slaText, JSON.stringify(input.criteria),
        input.deadline,
      ], `create_task — escrow ${input.escrow}`, undefined, undefined, input.escrow),
    }
  }

  async createTaskGroup(input: {
    title: string; slaText: string; deadline: number
    milestones: { title: string; criteria: string[]; amount: bigint }[]
  }): Promise<{ hash: string }> {
    // One payable call funds every stage: the attached value must equal
    // the sum of the slices, and the contract enforces the equality.
    // Amounts ride as strings — wei figures exceed Number.MAX_SAFE_INTEGER
    // and JSON.stringify would corrupt them; Python's int() parses strings.
    const total = input.milestones.reduce((s, m) => s + m.amount, 0n)
    const milestonesJson = JSON.stringify(input.milestones.map((m) => ({
      title: m.title, criteria: m.criteria, amount: m.amount.toString(),
    })))
    return {
      hash: await this.submitTx('buyer', 'create_task_group', [
        input.title, input.slaText, milestonesJson, input.deadline,
      ], `create_task_group — ${input.milestones.length} milestones, escrow ${total}`,
      undefined, undefined, total),
    }
  }

  async acceptTask(id: number): Promise<string> {
    // Bonds are reputation-gated: quote the acting worker's exact stake
    // from chain — attaching the generic 20% would over/under-fund.
    const quote = await this.readClient.readContract({
      address: this.address,
      functionName: 'get_required_bond',
      args: [id, this.actingAddress('worker')],
    })
    return this.submitTx('worker', 'accept_task', [id],
      'accept_task — stake bond', id, undefined, BigInt(String(quote)))
  }

  placeBid(id: number, price: bigint): Promise<string> {
    return this.submitTx('worker', 'place_bid', [id, price],
      `place_bid — offer ${price}`, id)
  }

  selectBid(id: number, worker: Address): Promise<string> {
    return this.submitTx('buyer', 'select_bid', [id, worker],
      'select_bid — award & reprice', id)
  }

  submitDelivery(id: number, evidence: { url?: string; inline?: string }): Promise<string> {
    return this.submitTx('worker', 'submit_delivery',
      [id, evidence.url ?? '', evidence.inline ?? ''],
      'submit_delivery', id, 'deliver')
  }

  fileAppeal(id: number, appellant: Address): Promise<string> {
    const task = this.getTask(id)
    if (!task) return Promise.reject(new Error(`task ${id} not loaded`))
    const side: Persona =
      appellant.toLowerCase() === (task.worker ?? '').toLowerCase() ? 'worker' : 'buyer'
    return this.submitTx(side, 'file_appeal', [id],
      'file_appeal — post bond', id, 'appeal', pct(task.escrow, PARAMS.appealBondPct))
  }

  abandonTask(id: number): Promise<string> {
    return this.submitTx('worker', 'abandon_task', [id], 'abandon — concede & refund buyer', id)
  }

  withdraw(side: Persona): Promise<string> {
    return this.submitTx(side, 'withdraw', [], 'withdraw — claim native GEN')
  }

  finalize(id: number): Promise<string> {
    return this.submitTx('buyer', 'finalize', [id], 'finalize — execute settlement', id)
  }

  resolveNeutral(id: number): Promise<string> {
    return this.submitTx('buyer', 'resolve_neutral', [id], 'resolve_neutral', id)
  }

  cancelTask(id: number): Promise<string> {
    return this.submitTx('buyer', 'cancel_task', [id], 'cancel_task — reclaim escrow', id)
  }

  reclaimExpired(id: number): Promise<string> {
    return this.submitTx('buyer', 'reclaim_expired', [id], 'reclaim — deadline miss', id)
  }
}

export const chainBackend = CONTRACT_ADDRESS ? new ChainBackend() : null

registerChainNameResolver(() =>
  chainBackend && !chainBackend.unreachable ? (a) => chainBackend.nameOf(a) : null,
)
