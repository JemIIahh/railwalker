import { createHmac } from 'node:crypto';
import {
  ASSETS,
  CELO_MAINNET,
  DEFAULT_POLICY,
  FINDING_ORDER,
  classifyReadStyle,
  decidePay,
  emptySpendState,
  toUsd,
  type AssetSymbol,
  type FindingCode,
  type Stage,
} from '@railwalker/core';
import type { CheckReport, RunRecord } from '@railwalker/scanner';
import type { ScanSummary } from './schemas';

/**
 * A seller's host, made unrecognisable without the salt: HMAC-SHA256 keyed with the salt, first 16 hex characters.
 * The same host gives the same key (so limits and counts still work), but nobody holding only the key can find the host.
 */
export function sellerKeyOf(host: string, salt: string): string {
  if (!salt) throw new Error('sellerKeyOf needs a salt: without one the key is a plain hash of a guessable host');
  const normalised = host.toLowerCase().replace(/\.$/, '');
  return createHmac('sha256', salt).update(normalised).digest('hex').slice(0, 16);
}

/**
 * Would the policy let us pay this endpoint, as an unsolicited probe, with an empty ledger and a full wallet?
 * That is the question a share of "payable" answers: it is about the endpoint and the price, not today's balance.
 */
function isPayable(report: CheckReport, now: Date): boolean {
  if (!report.challenge) return false;
  const { readStyle } = classifyReadStyle({ url: report.endpoint.url, method: report.endpoint.method, source: 'erc8004' });
  return report.challenge.accepts.some((accept) => {
    if (accept.chainId !== CELO_MAINNET || !accept.assetInfo) return false;
    const priceUsd = toUsd(accept.assetInfo.symbol, accept.amountAtomic);
    const decision = decidePay(DEFAULT_POLICY, emptySpendState(), {
      stage: 'unsolicited',
      sellerKey: 'summary',
      priceUsd,
      readStyle,
      optedOut: false,
      balanceUsd: Number.POSITIVE_INFINITY,
      now,
    });
    return decision.allow;
  });
}

/**
 * Everything that may be said about sellers we were not asked to look at: how many, what went wrong how often, which assets they take.
 * Counts and shares only. No host, URL or address goes in, so there is nothing to take out.
 */
export function summarize(reports: CheckReport[], now: Date): ScanSummary {
  const findingCounts = new Map<FindingCode, number>();
  const assetCounts = new Map<AssetSymbol, number>();
  let payable = 0;
  let confirmed = 0;

  for (const report of reports) {
    // Once per endpoint however often a finding fires: ten assets with the same fault are still one broken seller.
    for (const code of new Set(report.findings.map((f) => f.code))) findingCounts.set(code, (findingCounts.get(code) ?? 0) + 1);

    const accepted = new Set<AssetSymbol>();
    for (const accept of report.challenge?.accepts ?? []) {
      if (accept.chainId === CELO_MAINNET && accept.assetInfo) accepted.add(accept.assetInfo.symbol);
    }
    for (const symbol of accepted) assetCounts.set(symbol, (assetCounts.get(symbol) ?? 0) + 1);

    if (isPayable(report, now)) payable++;
    if (report.verdicts.some((v) => v.basis === 'CONFIRMED')) confirmed++;
  }

  // Built in the declared order, so the same inputs always make the same file.
  const byFinding: ScanSummary['byFinding'] = {};
  for (const code of FINDING_ORDER) if (findingCounts.has(code)) byFinding[code] = findingCounts.get(code);
  const assetAcceptance: ScanSummary['assetAcceptance'] = {};
  for (const symbol of Object.keys(ASSETS) as AssetSymbol[]) if (assetCounts.has(symbol)) assetAcceptance[symbol] = assetCounts.get(symbol);

  return {
    generatedAt: now.toISOString(),
    endpointsScanned: reports.length,
    byFinding,
    assetAcceptance,
    payablePct: reports.length === 0 ? 0 : Math.round((payable / reports.length) * 1000) / 10,
    confirmedProbes: confirmed,
  };
}

/** Only what we did to our own fixtures, or bought with our own money, may be shown by name. Everything else stays private. */
const PUBLIC_STAGES: readonly Stage[] = ['buy', 'fixture'];
export const isPublicStage = (stage: Stage): boolean => PUBLIC_STAGES.includes(stage);

/** A copy that is safe to publish, or null when the run touched anyone else's endpoint. */
export function publicRun(run: RunRecord): RunRecord | null {
  return isPublicStage(run.kind) ? structuredClone(run) : null;
}

/** The same rule for a scan report: `stage` says whose endpoint it was. */
export function publicReport(report: CheckReport, stage: Stage): CheckReport | null {
  return isPublicStage(stage) ? structuredClone(report) : null;
}
