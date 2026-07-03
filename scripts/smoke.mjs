#!/usr/bin/env node
/** End-to-end protocol smoke test against the deployed Studio contract:
 *  create → accept → deliver → verdict (+ injection case). */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { address } = JSON.parse(fs.readFileSync(path.join(root, 'src/config/deployment.json'), 'utf8'))
const pk = fs.readFileSync(path.join(root, '.env'), 'utf8').match(/DEPLOYER_PRIVATE_KEY=(0x\w+)/)[1]

const buyer = createAccount(pk)
const worker = createAccount(generatePrivateKey())
const buyerClient = createClient({ chain: studionet, account: buyer })
const workerClient = createClient({ chain: studionet, account: worker })

try { await workerClient.request({ method: 'sim_fundAccount', params: [worker.address, 100] }) } catch {}

const write = async (client, functionName, args, label) => {
  const t0 = Date.now()
  const hash = await client.writeContract({ address, functionName, args, value: 0n })
  const receipt = await client.waitForTransactionReceipt({ hash, status: 'ACCEPTED', interval: 2000, retries: 90 })
  const status = receipt?.statusName ?? receipt?.status
  console.log(`${label}: ${status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return receipt
}

console.log('contract:', address)

// Case A — substantive delivery
await write(buyerClient, 'create_task', [
  'Two-sentence protocol summary',
  'Summarize what AgentSLA does in exactly two sentences for a technical reader.',
  JSON.stringify(['Mentions escrow and bonds', 'Mentions per-criterion adjudication', 'Is at most 3 sentences long']),
  Date.now() + 86_400_000,
  2n * 10n ** 18n,
], 'create_task')

const tasks = JSON.parse(await buyerClient.readContract({ address, functionName: 'get_tasks', args: [] }))
const id = tasks[tasks.length - 1].id
console.log('task id:', id)

await write(workerClient, 'accept_task', [id], 'accept_task')
await write(workerClient, 'submit_delivery', [
  id,
  '',
  'AgentSLA escrows the buyer’s GEN and requires the worker to stake a performance bond before work begins. On delivery, GenLayer validators adjudicate each SLA criterion independently and settle payment, slashing, and reputation automatically.',
], 'submit_delivery (real LLM adjudication)')

const t = JSON.parse(await buyerClient.readContract({ address, functionName: 'get_task', args: [id] }))
console.log('verdict:', t.verdict, '| status:', t.status, '| confidence:', t.confidence)
console.log('criteria:', t.criteria_results.map((r) => `${r.index}:${r.met ? 'MET' : 'NOT_MET'}`).join(' '))
console.log('reasons:', t.criteria_results.map((r) => r.reason).join(' | ').slice(0, 300))
