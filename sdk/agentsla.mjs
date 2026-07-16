/** AgentSLA SDK — a minimal client for agents that buy and sell work.
 *
 *  Wraps genlayer-js with the protocol's value semantics so an agent
 *  can't get them wrong: escrow/bond/appeal-bond amounts are computed
 *  and attached as native value automatically, and acceptance quotes
 *  the caller's reputation-gated bond from chain before staking.
 *
 *    import { AgentSLA } from './sdk/agentsla.mjs'
 *
 *    const buyer = AgentSLA.connect({ address })            // fresh key
 *    const worker = AgentSLA.connect({ address, privateKey })
 *
 *    const { taskId } = await buyer.createTask({
 *      title: 'Dataset — EU battery plants',
 *      sla: 'Compile announced EU gigafactory capacity as CSV.',
 *      criteria: ['≥40 data points', 'every row sourced', 'valid CSV'],
 *      deadlineMs: Date.now() + 86_400_000,
 *      escrow: 9n * 10n ** 18n,
 *    })
 *    await worker.placeBid(taskId, 6n * 10n ** 18n)
 *    await buyer.selectBid(taskId, worker.address)
 *    await worker.accept(taskId)                    // bond quoted on-chain
 *    await worker.deliver(taskId, { inline: '…the deliverable…' })
 *    await buyer.finalize(taskId)                   // after the appeal window
 *    await worker.withdraw()                        // native GEN payout
 */
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

const DEFAULTS = { chain: studionet, receipt: { status: 'ACCEPTED', interval: 5000, retries: 60 } }

/** Studio is a shared node: busy slots / rate limits are transient. */
async function retrying(fn, label) {
  for (let i = 0; i < 20; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String(e?.details ?? e?.cause?.message ?? e?.message ?? e)
      if (!/busy|slots occupied|retry later|rate limit/i.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 8000))
    }
  }
  throw new Error(`${label}: node stayed busy`)
}

export class AgentSLA {
  /** @param {{address: string, privateKey?: string, chain?: object}} opts */
  static connect({ address, privateKey, chain = DEFAULTS.chain }) {
    const account = createAccount(privateKey ?? generatePrivateKey())
    return new AgentSLA({ address, account, chain })
  }

  constructor({ address, account, chain = DEFAULTS.chain }) {
    this.contract = address
    this.account = account
    this.chain = chain
    this.client = createClient({ chain, account })
  }

  get address() { return this.account.address }

  // ---- plumbing ----

  async read(functionName, args = []) {
    return retrying(
      () => this.client.readContract({ address: this.contract, functionName, args }),
      functionName)
  }

  async write(functionName, args = [], value = 0n) {
    const hash = await retrying(
      () => this.client.writeContract({ address: this.contract, functionName, args, value }),
      functionName)
    const receipt = await retrying(
      () => this.client.waitForTransactionReceipt({ hash, ...DEFAULTS.receipt }),
      `${functionName} receipt`)
    return { hash, receipt }
  }

  /** Studio-only faucet. Amount in wei; sent as a hand-built JSON body
   *  because wei-scale integers exceed Number.MAX_SAFE_INTEGER. */
  async fund(wei = 10_000n * 10n ** 18n) {
    const rpc = this.chain.rpcUrls.default.http[0]
    await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount","params":["${this.address}",${wei}]}`,
    })
  }

  // ---- reads ----

  async params() { return JSON.parse(await this.read('get_params')) }
  async vault() { return JSON.parse(await this.read('get_vault')) }
  async task(id) { return JSON.parse(await this.read('get_task', [id])) }
  async tasks() { return JSON.parse(await this.read('get_tasks')) }
  async tasksPage(offset, limit) { return JSON.parse(await this.read('get_tasks_page', [offset, limit])) }
  async taskCount() { return Number(await this.read('get_task_count')) }
  async group(groupId) { return JSON.parse(await this.read('get_group', [groupId])) }
  async reputation() { return JSON.parse(await this.read('get_reputation')) }
  async score(agent = this.address) { return Number(await this.read('get_score', [agent])) }
  async claim(agent = this.address) { return BigInt(await this.read('get_balance', [agent])) }
  async requiredBond(taskId, worker = this.address) {
    return BigInt(await this.read('get_required_bond', [taskId, worker]))
  }

  // ---- buyer side ----

  /** Escrow rides as native value. Returns { taskId, hash, receipt }. */
  async createTask({ title, sla, criteria, deadlineMs, escrow }) {
    const before = await this.taskCount()
    const res = await this.write('create_task',
      [title, sla, JSON.stringify(criteria), deadlineMs], escrow)
    return { taskId: before + 1, ...res }
  }

  /** Milestone group: [{title, criteria, amount}]; total rides as value.
   *  Returns { groupId, tasks, hash, receipt }. */
  async createTaskGroup({ title, sla, milestones, deadlineMs }) {
    const total = milestones.reduce((s, m) => s + BigInt(m.amount), 0n)
    const payload = milestones.map((m) => ({ ...m, amount: String(m.amount) }))
    const res = await this.write('create_task_group',
      [title, sla, JSON.stringify(payload), deadlineMs], total)
    const tasks = await this.tasks()
    const groupId = tasks[tasks.length - 1]?.group_id
    return { groupId, tasks: await this.group(groupId), ...res }
  }

  async selectBid(taskId, worker) { return this.write('select_bid', [taskId, worker]) }
  async cancel(taskId) { return this.write('cancel_task', [taskId]) }
  async finalize(taskId) { return this.write('finalize', [taskId]) }
  async reclaimExpired(taskId) { return this.write('reclaim_expired', [taskId]) }

  // ---- worker side ----

  async placeBid(taskId, price) { return this.write('place_bid', [taskId, price]) }

  /** Quotes the reputation-gated bond on-chain and stakes exactly that. */
  async accept(taskId) {
    const bond = await this.requiredBond(taskId)
    return this.write('accept_task', [taskId], bond)
  }

  async deliver(taskId, { url = '', inline = '' }) {
    return this.write('submit_delivery', [taskId, url, inline])
  }

  async abandon(taskId) { return this.write('abandon_task', [taskId]) }

  // ---- either party ----

  /** Appeal bond (10% of escrow) computed from the case and attached. */
  async appeal(taskId) {
    const t = await this.task(taskId)
    const p = await this.params()
    const bond = (BigInt(t.escrow) * BigInt(p.appeal_bond_pct)) / 100n
    return this.write('file_appeal', [taskId], bond)
  }

  async resolveNeutral(taskId) { return this.write('resolve_neutral', [taskId]) }

  /** Pull-payment exit: pays the caller's full claim as native GEN. */
  async withdraw() { return this.write('withdraw', []) }
}
