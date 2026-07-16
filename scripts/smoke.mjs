#!/usr/bin/env node
/** End-to-end protocol + asset smoke test against the deployed Studio contract.
 *
 *  Exercises the full custody path with real value:
 *    fund → create (escrow rides as tx value) → accept (bond as value)
 *    → deliver (real LLM adjudication) → finalize after the appeal window
 *    → withdraw (native payout via emit_transfer)
 *  and asserts the backing invariant custody == locked + withdrawable
 *  after every step, plus wei-exact conservation at settlement. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { address, rpcUrl, appealWindowMs } = JSON.parse(
  fs.readFileSync(path.join(root, 'src/config/deployment.json'), 'utf8'))
const pk = fs.readFileSync(path.join(root, '.env'), 'utf8').match(/DEPLOYER_PRIVATE_KEY=(0x\w+)/)[1]

const GEN = 10n ** 18n

const buyer = createAccount(pk)
const worker = createAccount(generatePrivateKey())
const buyerClient = createClient({ chain: studionet, account: buyer })
const workerClient = createClient({ chain: studionet, account: worker })

/** sim_fundAccount with a wei-scale amount: 100 GEN = 1e20 exceeds
 *  Number.MAX_SAFE_INTEGER, so the JSON body carries the integer literal
 *  by hand (the node parses arbitrary-precision JSON numbers fine). */
const fund = (addr, wei) =>
  fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount","params":["${addr}",${wei}]}`,
  })

/** Studio is a shared node: -32006 "execution slots occupied" and -32029
 *  "rate limit exceeded" (30 req/min) are transient conditions, not
 *  failures. Back off and retry. */
const withBusyRetry = async (fn, label = 'rpc') => {
  for (let i = 0; i < 20; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String(e?.details ?? e?.cause?.message ?? e?.message ?? e)
      if (!/busy|slots occupied|retry later|rate limit/i.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 8000))
    }
  }
  throw new Error(`${label}: node stayed busy after 20 retries`)
}

const read = async (fn, args = []) =>
  withBusyRetry(() => buyerClient.readContract({ address, functionName: fn, args }), fn)

/** Backing invariant: custody must never be less than what the ledger
 *  owes. A withdraw's native payout is a triggered transaction, so right
 *  after acceptance custody may briefly exceed the ledger (transfer in
 *  flight) — a surplus is legal, a deficit never is. */
const vault = async () => {
  const v = JSON.parse(await read('get_vault'))
  if (!v.backed || BigInt(v.custody) < BigInt(v.locked) + BigInt(v.withdrawable)) {
    throw new Error(`VAULT NOT BACKED: ${JSON.stringify(v)}`)
  }
  return v
}

/** Wait for in-flight outbound transfers to settle: custody drains back
 *  to exactly locked + withdrawable. */
const vaultSettled = async (label, retries = 30) => {
  for (let i = 0; i < retries; i++) {
    const v = await vault()
    if (BigInt(v.custody) === BigInt(v.locked) + BigInt(v.withdrawable)) {
      console.log(`  ✓ ${label}: custody settled to locked + withdrawable`)
      return v
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`${label}: outbound transfer never settled`)
}

const write = async (client, functionName, args, label, value = 0n) => {
  const t0 = Date.now()
  const hash = await withBusyRetry(
    () => client.writeContract({ address, functionName, args, value }), functionName)
  const receipt = await withBusyRetry(
    () => client.waitForTransactionReceipt({ hash, status: 'ACCEPTED', interval: 5000, retries: 60 }),
    `${functionName} receipt`)
  const status = receipt?.statusName ?? receipt?.status
  console.log(`${label}: ${status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return receipt
}

const assertEq = (label, got, want) => {
  if (got !== want) throw new Error(`${label}: got ${got}, want ${want}`)
  console.log(`  ✓ ${label} = ${got}`)
}

console.log('contract:', address)

await fund(buyer.address, (100n * GEN).toString())
await fund(worker.address, (100n * GEN).toString())
console.log('funded buyer + worker with 100 GEN each')

const v0 = await vault()
console.log('vault before:', v0)

// Treasury = deployer, which is also this script's buyer — dedupe the
// conservation parties so overlapping addresses are not double-counted.
const { treasury } = JSON.parse(await read('get_params'))
const parties = []
{
  const seen = new Set()
  for (const [who, addr] of [['worker', worker.address], ['buyer', buyer.address], ['treasury', treasury]]) {
    const k = addr.toLowerCase()
    if (!seen.has(k)) { seen.add(k); parties.push([who, addr]) }
  }
}

const claims0 = {}
for (const [who, addr] of parties) {
  claims0[who] = BigInt(await read('get_balance', [addr]))
}

// --- create: escrow (2 GEN) rides as real transaction value ---
const escrow = 2n * GEN
await write(buyerClient, 'create_task', [
  'Two-sentence protocol summary',
  'Summarize what AgentSLA does in exactly two sentences for a technical reader.',
  JSON.stringify(['Mentions escrow and bonds', 'Mentions per-criterion adjudication', 'Is at most 3 sentences long']),
  Date.now() + 86_400_000,
], 'create_task (escrow as value)', escrow)

const tasks = JSON.parse(await read('get_tasks'))
const id = tasks[tasks.length - 1].id
const task = tasks[tasks.length - 1]
const bond = BigInt(task.bond)
console.log('task id:', id, '| escrow:', task.escrow, '| bond:', String(bond))

const v1 = await vault()
assertEq('custody grew by escrow', BigInt(v1.custody) - BigInt(v0.custody), escrow)

// --- accept: worker bond rides as value ---
await write(workerClient, 'accept_task', [id], 'accept_task (bond as value)', bond)
const v2 = await vault()
assertEq('custody grew by bond', BigInt(v2.custody) - BigInt(v1.custody), bond)

// --- deliver: real LLM adjudication ---
await write(workerClient, 'submit_delivery', [
  id,
  '',
  'AgentSLA escrows the buyer’s GEN and requires the worker to stake a performance bond before work begins. On delivery, GenLayer validators adjudicate each SLA criterion independently and settle payment, slashing, and reputation automatically.',
], 'submit_delivery (real LLM adjudication)')

let t = JSON.parse(await read('get_task', [id]))
console.log('verdict:', t.verdict, '| status:', t.status, '| confidence:', t.confidence)
console.log('criteria:', t.criteria_results.map((r) => `${r.index}:${r.met ? 'MET' : 'NOT_MET'}`).join(' '))
if (t.status !== 'ADJUDICATED') throw new Error(`expected ADJUDICATED, got ${t.status}`)
await vault()

// --- finalize after the appeal window ---
const waitMs = Math.max(0, Number(t.window_ends_ms) - Date.now()) + 5_000
console.log(`waiting ${(waitMs / 1000).toFixed(0)}s for the appeal window (${appealWindowMs} ms) to close…`)
await new Promise((r) => setTimeout(r, waitMs))
await write(buyerClient, 'finalize', [id], 'finalize (settlement)')

t = JSON.parse(await read('get_task', [id]))
if (t.status !== 'FINAL') throw new Error(`expected FINAL, got ${t.status}`)

// --- conservation: every wei of escrow+bond is claimable by someone ---
const claims = {}
let claimed = 0n
for (const [who, addr] of parties) {
  claims[who] = BigInt(await read('get_balance', [addr])) - claims0[who]
  claimed += claims[who]
  console.log(`claim[${who}] (this case) = ${claims[who]}`)
}
assertEq('conservation (claims sum to escrow + bond)', claimed, escrow + bond)
const v3 = await vault()
assertEq('nothing left locked for this case', BigInt(v3.locked), BigInt(v0.locked))

// --- withdraw: native payout via emit_transfer ---
if (claims.worker > 0n) {
  await write(workerClient, 'withdraw', [], 'withdraw (native payout to worker)')
  assertEq('worker claim zeroed', BigInt(await read('get_balance', [worker.address])), 0n)
  const v4 = await vaultSettled('worker payout')
  assertEq('custody drained by claim', BigInt(v3.custody) - BigInt(v4.custody), claims.worker)
  console.log('paid_out (cumulative):', v4.paid_out)
}
if (claims.buyer > 0n) {
  await write(buyerClient, 'withdraw', [], 'withdraw (native payout to buyer)')
  assertEq('buyer claim zeroed', BigInt(await read('get_balance', [buyer.address])), 0n)
  await vaultSettled('buyer payout')
}

// --- abandon: honest fail-fast exit refunds the buyer immediately ---
const buyerClaimBefore = BigInt(await read('get_balance', [buyer.address]))
const escrow2 = 1n * GEN
await write(buyerClient, 'create_task', [
  'Abandon-path check', 'Any deliverable.', JSON.stringify(['any criterion']),
  Date.now() + 86_400_000,
], 'create_task #2 (for abandon)', escrow2)
const tasks2 = JSON.parse(await read('get_tasks'))
const id2 = tasks2[tasks2.length - 1].id
const bond2 = BigInt(tasks2[tasks2.length - 1].bond)
await write(workerClient, 'accept_task', [id2], 'accept_task #2', bond2)
await write(workerClient, 'abandon_task', [id2], 'abandon_task (honest exit)')
const t2 = JSON.parse(await read('get_task', [id2]))
if (t2.status !== 'ABANDONED') throw new Error(`expected ABANDONED, got ${t2.status}`)
assertEq('abandon refunds buyer escrow + full bond (claimable)',
  BigInt(await read('get_balance', [buyer.address])) - buyerClaimBefore, escrow2 + bond2)
await write(buyerClient, 'withdraw', [], 'withdraw (buyer, abandon refund)')
await vaultSettled('abandon refund payout')

console.log('\nsmoke: full asset lifecycle OK — custody backed at every step, conservation exact')
