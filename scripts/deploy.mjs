#!/usr/bin/env node
/**
 * Deploy the AgentSLA Intelligent Contract to GenLayer Studio Network.
 *
 *   node scripts/deploy.mjs [--window-ms 120000] [--min-escrow 1000000000000000000]
 *
 * The deployer key is kept in .env (DEPLOYER_PRIVATE_KEY); one is generated
 * on first run. On success the deployed address is written to
 * src/config/deployment.json, which the frontend reads at build time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { syncReadme } from './sync-readme.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : dflt
}
const WINDOW_MS = Number(arg('--window-ms', '120000'))          // 2 min demo window
const MIN_ESCROW = BigInt(arg('--min-escrow', 10n ** 18n + '')) // 1 GEN

// --- deployer key (local .env only, never committed) ---
const envPath = path.join(root, '.env')
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
let pk = env.match(/^DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1]
if (!pk) {
  pk = generatePrivateKey()
  fs.writeFileSync(envPath, env + (env && !env.endsWith('\n') ? '\n' : '') + `DEPLOYER_PRIVATE_KEY=${pk}\n`)
  console.log('generated deployer key → .env')
}
const account = createAccount(pk)
console.log('deployer:', account.address)

const client = createClient({ chain: studionet, account })

// Escrows and bonds ride as real value now, so the deployer needs a real
// wei-scale balance. The amount exceeds Number.MAX_SAFE_INTEGER, so the
// JSON-RPC body carries the integer literal by hand.
try {
  const amount = (10_000n * 10n ** 18n).toString()   // 10,000 GEN
  await fetch(studionet.rpcUrls.default.http[0], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount","params":["${account.address}",${amount}]}`,
  })
  console.log('funded deployer on Studio (10,000 GEN)')
} catch (e) {
  console.log('fund skipped:', String(e.message || e).slice(0, 120))
}

const code = fs.readFileSync(path.join(root, 'contracts', 'agentsla.py'), 'utf8')

console.log(`deploying… (appeal window ${WINDOW_MS} ms, min escrow ${MIN_ESCROW})`)
const hash = await client.deployContract({
  code,
  args: [WINDOW_MS, MIN_ESCROW],
})
console.log('deploy tx:', hash)

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: 'ACCEPTED',
  interval: 3000,
  retries: 60,
})

const address =
  receipt?.data?.contract_address ??
  receipt?.contract_address ??
  receipt?.to_address ??
  receipt?.recipient
if (!address) {
  console.error('could not locate contract address in receipt; keys:', Object.keys(receipt || {}))
  process.exit(1)
}
console.log('contract address:', address)

// sanity read
const params = await client.readContract({ address, functionName: 'get_params', args: [] })
console.log('get_params →', params)

const outPath = path.join(root, 'src', 'config', 'deployment.json')
fs.writeFileSync(outPath, JSON.stringify({
  network: 'studionet',
  chainId: studionet.id,
  rpcUrl: studionet.rpcUrls.default.http[0],
  address,
  deployedAt: new Date().toISOString(),
  appealWindowMs: WINDOW_MS,
  minEscrow: MIN_ESCROW.toString(),
}, null, 2) + '\n')
console.log('wrote', path.relative(root, outPath))

// Keep the README's live-deployment line in sync with the address we just wrote.
syncReadme()
