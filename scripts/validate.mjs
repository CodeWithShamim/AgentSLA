#!/usr/bin/env node
/**
 * Contract validation — the PRD §7 lint/verify gate.
 *
 * genvm-lint ships with the GenLayer boilerplate toolchain and is not on
 * npm/PyPI, so this script performs the equivalent checks, ending with the
 * strongest one available: compiling the contract and extracting its schema
 * on the live Studio GenVM via gen_getContractSchemaForCode.
 *
 *   node scripts/validate.mjs [--json]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(root, 'contracts', 'agentsla.py')
const code = fs.readFileSync(contractPath, 'utf8')
const asJson = process.argv.includes('--json')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  if (!asJson) console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

// 1. Python syntax compiles locally
let syntaxOk = false
try {
  execFileSync('python3', ['-m', 'py_compile', contractPath], { stdio: 'pipe' })
  syntaxOk = check('py_compile', true)
} catch (e) {
  check('py_compile', false, String(e.stderr ?? e).slice(0, 200))
}

// 2. Static gates (NFR-4, NFR-5, PRD §7)
const firstLine = code.split('\n', 1)[0]
check(
  'pinned runner (NFR-5)',
  /^# \{ "Depends": "py-genlayer:[0-9a-z]{40,}" \}$/.test(firstLine),
  firstLine.trim(),
)
check(
  'no test/latest runner alias',
  !/py-genlayer:(test|latest)/.test(code),
)
// Strip comments/docstrings so FR references in prose don't false-positive.
const codeOnly = code
  .split('\n')
  .map((l) => l.replace(/#.*$/, ''))
  .join('\n')
  .replace(/"""[\s\S]*?"""/g, '')
check(
  'no float literals in code (FR-3.5)',
  !/\d+\.\d/.test(codeOnly),
)
check(
  'no float time math (.timestamp())',
  !/\.timestamp\(\)/.test(codeOnly),
)
check(
  'no raw dict/list storage annotations (NFR-4)',
  !/^\s+\w+:\s*(dict|list)\[/m.test(code.split('class AgentSLA')[1]?.split('def __init__')[0] ?? ''),
)
check(
  'FR-4 taxonomy prefixes present',
  ['EXPECTED', 'EXTERNAL', 'TRANSIENT', 'LLM_ERROR'].every((t) => code.includes(`'${t}'`) || code.includes(`${t}:`)),
)
check(
  'verdict enum whitelist (NFR-3)',
  code.includes("VERDICTS = ('MET', 'PARTIAL', 'NOT_MET')"),
)
check(
  'untrusted-data delimiters in prompt (FR-2.5)',
  code.includes('UNTRUSTED DELIVERABLE'),
)

// 3. Live GenVM: compile + schema extraction on the Studio node
let schema = null
if (syntaxOk) {
  try {
    const client = createClient({ chain: studionet })
    schema = await client.getContractSchemaForCode(code)
    check('GenVM compile + schema (live Studio node)', true)
  } catch (e) {
    check('GenVM compile + schema (live Studio node)', false, String(e.message ?? e).slice(0, 300))
  }
}

// 4. Schema shape: the frontend's expected surface
if (schema) {
  const methods = schema.methods ?? {}
  const expect = {
    create_task: false, accept_task: false, submit_delivery: false,
    finalize: false, file_appeal: false, resolve_neutral: false,
    cancel_task: false, reclaim_expired: false,
    get_tasks: true, get_task: true, get_reputation: true,
    get_score: true, get_balance: true, get_params: true,
  }
  const missing = Object.entries(expect).filter(
    ([name, readonly]) => !methods[name] || methods[name].readonly !== readonly,
  )
  check(
    'schema surface matches frontend',
    missing.length === 0,
    missing.length ? `missing/mismatched: ${missing.map(([n]) => n).join(', ')}` : `${Object.keys(methods).length} methods`,
  )
}

const failed = results.filter((r) => !r.ok)
if (asJson) console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2))
else console.log(failed.length === 0 ? '\nvalidate: all checks passed' : `\nvalidate: ${failed.length} check(s) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
