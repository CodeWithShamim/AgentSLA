#!/usr/bin/env node
/** SDK demo — two autonomous agents transact through the marketplace
 *  features using only sdk/agentsla.mjs:
 *
 *    1. bidding: buyer posts at 3 GEN, worker bids 2 GEN, buyer selects
 *       (surplus refunds), worker accepts at the on-chain bond quote,
 *       delivers, real LLM adjudication runs
 *    2. milestones: buyer funds a 2-stage group in one payable call
 *
 *  Runs against the deployed contract in src/config/deployment.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentSLA } from '../sdk/agentsla.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { address } = JSON.parse(fs.readFileSync(path.join(root, 'src/config/deployment.json'), 'utf8'))
const GEN = 10n ** 18n

const buyer = AgentSLA.connect({ address })
const worker = AgentSLA.connect({ address })
console.log('contract:', address)
console.log('buyer:', buyer.address, '| worker:', worker.address)

await buyer.fund()
await worker.fund()

// --- act 1: competitive bidding ---
const { taskId } = await buyer.createTask({
  title: 'Two-sentence protocol summary',
  sla: 'Summarize what AgentSLA does in exactly two sentences for a technical reader.',
  criteria: ['Mentions escrow and bonds', 'Mentions per-criterion adjudication'],
  deadlineMs: Date.now() + 86_400_000,
  escrow: 3n * GEN,
})
console.log('task', taskId, 'posted at 3 GEN')

await worker.placeBid(taskId, 2n * GEN)
console.log('worker bid 2 GEN')
await buyer.selectBid(taskId, worker.address)
console.log('buyer selected the bid — surplus claim:', (await buyer.claim()).toString())

const quote = await worker.requiredBond(taskId)
console.log('bond quote for worker (reputation-gated):', quote.toString())
await worker.accept(taskId)
await worker.deliver(taskId, {
  inline: 'AgentSLA escrows the buyer’s GEN and requires the worker to stake a bond. Validators adjudicate each SLA criterion independently and settle payment automatically.',
})
const t = await buyer.task(taskId)
console.log('verdict:', t.verdict, '| status:', t.status)

// --- act 2: milestone group in one funded call ---
const { groupId, tasks } = await buyer.createTaskGroup({
  title: 'Market study',
  sla: 'Deliver the staged market study per milestone criteria.',
  milestones: [
    { title: 'Research notes', criteria: ['At least 10 sources listed'], amount: 1n * GEN },
    { title: 'Final report', criteria: ['Covers all research themes'], amount: 2n * GEN },
  ],
  deadlineMs: Date.now() + 86_400_000,
})
console.log(`group ${groupId}:`, tasks.map((m) => `#${m.id} "${m.title}" ${m.escrow} wei`).join(' | '))

const vault = await buyer.vault()
console.log('vault:', vault, '\nsdk-demo: OK')
