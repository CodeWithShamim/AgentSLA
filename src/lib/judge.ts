import type { Confidence, CriterionResult, VerdictKind } from './types'

/** Simulated SLAAdjudicator.
 *
 *  Mirrors the contract's non-deterministic core (PRD FR-2): each criterion
 *  is judged independently to a boolean + reason; the overall verdict is
 *  derived deterministically afterwards (FR-2.4). Evidence is treated as
 *  untrusted data — instruction-shaped content inside it is flagged, never
 *  followed (NFR-3).
 *
 *  Simulation triggers (documented in the deliver form):
 *    [[force:met]] [[force:partial]] [[force:not_met]]  — pin the outcome
 *    [[force:soft_error]]                               — LLM_ERROR / non-convergence
 */

export interface JudgeOutput {
  kind: 'verdict'
  verdict: VerdictKind
  criteriaResults: CriterionResult[]
  confidence: Confidence
  injectionDetected: boolean
}

export interface JudgeSoftError {
  kind: 'soft_error'
  tag: 'LLM_ERROR'
  detail: string
}

const INJECTION_PATTERNS = [
  /ignore (all |previous |prior |the )*(instructions|rules|prompts)/i,
  /disregard (the |all )*(sla|criteria|instructions)/i,
  /output\s+"?MET"?/i,
  /mark (all|every) criteri(a|on) (as )?met/i,
  /you are (now|no longer)/i,
  /system\s*(prompt|message)\s*:/i,
  /\bAs the adjudicator\b/i,
]

const STOPWORDS = new Set([
  'the', 'and', 'that', 'with', 'this', 'must', 'have', 'from', 'least',
  'most', 'each', 'every', 'all', 'any', 'should', 'shall', 'contain',
  'contains', 'include', 'includes', 'mention', 'mentions', 'mentioned',
  'uses', 'use', 'written', 'throughout', 'more', 'than', 'within', 'under',
  'over', 'about', 'into', 'onto', 'their', 'there', 'when', 'where',
])

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? []
}

/** Deterministic fallback so leader/validator "agree" run-to-run. */
function hashBool(seed: string): boolean {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 100 < 62
}

function judgeCriterion(index: number, criterion: string, evidence: string): CriterionResult {
  const evWords = words(evidence)
  const evSet = new Set(evWords)

  // Word-count criteria: "at least 500 words", "minimum 300 words"
  const wc = criterion.match(/(\d[\d,]*)\s*words?/i)
  if (wc) {
    const target = parseInt(wc[1].replace(/,/g, ''), 10)
    const atMost = /\b(at most|under|fewer than|less than|maximum|max)\b/i.test(criterion)
    const count = evWords.length
    const met = atMost ? count <= target : count >= target
    return {
      index,
      met,
      reason: `Deliverable contains ${count} words against a ${atMost ? 'maximum' : 'minimum'} of ${target}.`,
    }
  }

  // Keyword coverage: significant terms of the criterion present in evidence
  const terms = [...new Set(words(criterion).filter((w) => w.length > 3 && !STOPWORDS.has(w)))]
  if (terms.length > 0) {
    const found = terms.filter((t) => evSet.has(t))
    const coverage = found.length / terms.length
    if (coverage >= 0.5) {
      return {
        index,
        met: true,
        reason: `Evidence addresses the criterion; key terms present: ${found.slice(0, 4).join(', ')}.`,
      }
    }
    if (coverage <= 0.15 && evWords.length < 40) {
      return {
        index,
        met: false,
        reason: `EXPECTED: evidence does not address the criterion; missing: ${terms.filter((t) => !evSet.has(t)).slice(0, 4).join(', ')}.`,
      }
    }
    const met = coverage >= 0.34 || hashBool(criterion + '|' + evidence.slice(0, 200))
    return {
      index,
      met,
      reason: met
        ? `Criterion judged satisfied on substance despite partial term overlap (${found.length}/${terms.length}).`
        : `EXPECTED: only ${found.length} of ${terms.length} required elements are evidenced.`,
    }
  }

  const met = hashBool(criterion + '|' + evidence.slice(0, 200))
  return {
    index,
    met,
    reason: met ? 'Criterion judged satisfied on review of the deliverable.' : 'EXPECTED: criterion not evidenced in the deliverable.',
  }
}

export function adjudicate(criteria: string[], evidence: string): JudgeOutput | JudgeSoftError {
  // Simulation triggers
  if (/\[\[force:soft_error\]\]/i.test(evidence)) {
    return {
      kind: 'soft_error',
      tag: 'LLM_ERROR',
      detail: 'LLM_ERROR: validators did not converge after 2 retries (verdict enum mismatch across quorum).',
    }
  }

  const injectionDetected = INJECTION_PATTERNS.some((p) => p.test(evidence))

  const force = evidence.match(/\[\[force:(met|partial|not_met)\]\]/i)?.[1]?.toLowerCase()

  let criteriaResults: CriterionResult[]
  if (force) {
    criteriaResults = criteria.map((_, i) => {
      const met = force === 'met' ? true : force === 'not_met' ? false : i < Math.ceil(criteria.length / 2)
      return {
        index: i,
        met,
        reason: met
          ? 'Criterion judged satisfied on review of the deliverable.'
          : 'EXPECTED: criterion not satisfied by the submitted evidence.',
      }
    })
  } else {
    criteriaResults = criteria.map((c, i) => judgeCriterion(i, c, evidence))
  }

  if (injectionDetected && !force) {
    // The injected instruction is *data*. Judgment proceeds on actual content;
    // instruction-shaped evidence weighs against substantive compliance.
    criteriaResults = criteriaResults.map((r) => ({
      ...r,
      met: false,
      reason:
        'EXPECTED: evidence consists of instructions addressed to the adjudicator rather than deliverable content. ' +
        'Injected directives were treated as untrusted data and not executed.',
    }))
  }

  const metCount = criteriaResults.filter((r) => r.met).length
  const verdict: VerdictKind =
    metCount === criteria.length ? 'MET' : metCount === 0 ? 'NOT_MET' : 'PARTIAL'

  const confidence: Confidence = injectionDetected
    ? 'HIGH'
    : metCount === criteria.length || metCount === 0
      ? 'HIGH'
      : 'MEDIUM'

  return { kind: 'verdict', verdict, criteriaResults, confidence, injectionDetected }
}
