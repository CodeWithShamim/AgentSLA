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
const TREASURY = '0x7ea5000000000000000000000000000000000000'

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

const read = async (fn, args = []) =>
  buyerClient.readContract({ address, functionName: fn, args })

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
const vaultSettled = async (label, retries = 45) => {
  for (let i = 0; i < retries; i++) {
    const v = await vault()
    if (BigInt(v.custody) === BigInt(v.locked) + BigInt(v.withdrawable)) {
      console.log(`  ✓ ${label}: custody settled to locked + withdrawable`)
      return v
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`${label}: outbound transfer never settled`)
}

const write = async (client, functionName, args, label, value = 0n) => {
  const t0 = Date.now()
  const hash = await client.writeContract({ address, functionName, args, value })
  const receipt = await client.waitForTransactionReceipt({ hash, status: 'ACCEPTED', interval: 2000, retries: 90 })
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
const claims0 = {}
for (const [who, addr] of [['worker', worker.address], ['buyer', buyer.address], ['treasury', TREASURY]]) {
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
for (const [who, addr] of [['worker', worker.address], ['buyer', buyer.address], ['treasury', TREASURY]]) {
  claims[who] = BigInt(await read('get_balance', [addr])) - claims0[who]
  console.log(`claim[${who}] (this case) = ${claims[who]}`)
}
assertEq('conservation (claims sum to escrow + bond)',
  claims.worker + claims.buyer + claims.treasury, escrow + bond)
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

console.log('\nsmoke: full asset lifecycle OK — custody backed at every step, conservation exact')
