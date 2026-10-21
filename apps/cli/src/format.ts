import type { Finding, Verdict } from '@railwalker/core';

export const usd = (n: number) => `$${n.toFixed(4)}`;

/** An atomic amount as a fixed-point string. Numbers are precise enough here: these are balances, not accounting. */
export const fixed = (atomic: bigint, decimals: number, places = 6) => (Number(atomic) / 10 ** decimals).toFixed(places);

const label = (v: Verdict) => (v.code ? `${v.kind}:${v.code}` : v.kind);

/** One line per verdict, in the notation the spec uses: PASS, FAIL:<code>, SKIPPED:<reason>, AMBIGUOUS. */
export function verdictLines(verdicts: Verdict[]): string {
  return verdicts.map((v) => `${(v.assetSymbol ?? 'endpoint').padEnd(9)}${label(v).padEnd(36)}(${v.basis})\n`).join('');
}

/** The findings that need attention: errors and warnings. */
export function findingLines(findings: Finding[]): string {
  return findings
    .filter((f) => f.severity !== 'info')
    .map((f) => `  ${f.severity === 'error' ? '!' : '~'} ${f.code}${f.assetSymbol ? ` (${f.assetSymbol})` : ''}: ${f.message}\n`)
    .join('');
}
