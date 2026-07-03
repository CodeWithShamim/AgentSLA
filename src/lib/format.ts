const WEI = 10n ** 18n

/** Format a wei-scale bigint as a GEN amount. Money math stays in bigint;
 *  only the rendered string is fractional. */
export function fmtGEN(wei: bigint, withUnit = true): string {
  const neg = wei < 0n
  const abs = neg ? -wei : wei
  const whole = abs / WEI
  const frac = abs % WEI
  let s = whole.toString()
  if (frac > 0n) {
    const fracStr = (frac + WEI).toString().slice(1).replace(/0+$/, '').slice(0, 4)
    s += '.' + fracStr
  }
  return `${neg ? '−' : ''}${s}${withUnit ? ' GEN' : ''}`
}

export function parseGEN(input: string): bigint | null {
  const m = input.trim().match(/^(\d+)(?:\.(\d{1,18}))?$/)
  if (!m) return null
  const whole = BigInt(m[1]) * WEI
  const frac = m[2] ? BigInt(m[2].padEnd(18, '0')) : 0n
  return whole + frac
}

export function pct(amount: bigint, percent: number): bigint {
  return (amount * BigInt(percent)) / 100n
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function caseNo(id: number): string {
  return `№${String(id).padStart(4, '0')}`
}

export function fmtIndex(i: number): string {
  return String(i + 1).padStart(2, '0')
}

export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().slice(0, 10)
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return '00:00:00'
  const s = Math.floor(msLeft / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(sec)}`
}
