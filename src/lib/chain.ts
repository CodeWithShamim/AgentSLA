import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { transactionsStatusNumberToName } from 'genlayer-js/types'
import { CONTRACT_ADDRESS } from '../config/chain'
import { registerChainNameResolver } from './agents'
import { sessionAccounts, type Persona } from './session'
import type {
  Address, AgentRecord, ReputationEvent, SettlementLine,
  Task, TaskStatus, TxRecord, TxStep, VerdictKind,
} from './types'

/** ChainBackend — the live StudioNet data layer.
 *
 *  Polls the deployed AgentSLA contract and mirrors it into the same
 *  Task/TxRecord shapes the views already consume. Writes are signed
 *  either by the connected Privy wallet (buyer-side actions) or by the
 *  local session personas: the human operator is the buyer, the worker
 *  agent runs on a local session key — a buyer cannot accept their own
 *  task on-chain. */

const POLL_MS = 4000
const TX_POLL_MS = 2500

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
  }
}

class ChainBackend {
  private listeners = new Set<Listener>()
  private tasks: Task[] = []
  private repEvents: any[] = []
  private txs: TxRecord[] = []
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
      await this.readClient.request({
        method: 'sim_fundAccount',
        params: [address as `0x${string}`, 100],
      } as never)
    } catch { /* gasless network — funding is best-effort */ }
  }

  /** Buyer-side actions use the connected wallet when present, else the
   *  buyer persona. Worker-side actions always use the worker persona. */
  private clientFor(side: Persona) {
    if (side === 'buyer' && this.privySigner) {
      return createClient({
        chain: chainConfig,
        account: this.privySigner.address,
        provider: this.privySigner.provider as never,
      })
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

  private async poll() {
    try {
      const [tasksJson, repJson] = await Promise.all([
        this.readClient.readContract({ address: this.address, functionName: 'get_tasks', args: [] }),
        this.readClient.readContract({ address: this.address, functionName: 'get_reputation', args: [] }),
      ])
      this.tasks = (JSON.parse(String(tasksJson)) as any[])
        .map((raw) => mapTask(raw, this.pendingByTask.get(Number(raw.id))))
        .sort((a, b) => b.id - a.id)
      this.repEvents = JSON.parse(String(repJson))
      this.everSucceeded = true
      this.consecutiveFailures = 0
    } catch {
      this.consecutiveFailures++
    }
    this.notify()
  }

  getTasks(): Task[] { return this.tasks }
  getTask(id: number): Task | undefined { return this.tasks.find((t) => t.id === id) }
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
    if (a === '0x7ea5000000000000000000000000000000000000') return 'treasury'
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
  ): Promise<string> {
    const client = this.clientFor(side)
    const write = () => client.writeContract({
      address: this.address,
      functionName,
      args: args as never[],
      value: 0n,
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
    return {
      hash: await this.submitTx('buyer', 'create_task', [
        input.title, input.slaText, JSON.stringify(input.criteria),
        input.deadline, input.escrow,
      ], `create_task — escrow ${input.escrow}`),
    }
  }

  acceptTask(id: number): Promise<string> {
    return this.submitTx('worker', 'accept_task', [id], 'accept_task — stake bond', id)
  }

  submitDelivery(id: number, evidence: { url?: string; inline?: string }): Promise<string> {
    return this.submitTx('worker', 'submit_delivery',
      [id, evidence.url ?? '', evidence.inline ?? ''],
      'submit_delivery', id, 'deliver')
  }

  fileAppeal(id: number, appellant: Address): Promise<string> {
    const side: Persona =
      appellant.toLowerCase() === (this.getTask(id)?.worker ?? '').toLowerCase() ? 'worker' : 'buyer'
    return this.submitTx(side, 'file_appeal', [id], 'file_appeal — post bond', id, 'appeal')
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
