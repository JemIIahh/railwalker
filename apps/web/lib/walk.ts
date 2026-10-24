import { assetByAddress, type AssetSymbol, type Verdict, type VerdictKind } from '@railwalker/core';
import type { MapCell } from '@railwalker/data';
import type { RunRecord } from '@railwalker/scanner';

/** The kinds of outcome in the order the hero tells them: it works, it breaks, it works with a catch, nobody can tell, not checked. */
const STORY: readonly VerdictKind[] = ['PASS', 'FAIL', 'PASS_WITH_WARNINGS', 'AMBIGUOUS', 'SKIPPED'];
/** A run that was paid on several tokens is known by the worst thing it found. */
const WORST: Record<VerdictKind, number> = { AMBIGUOUS: 4, FAIL: 3, PASS_WITH_WARNINGS: 2, PASS: 1, SKIPPED: 0 };
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The runs the hero walks through, by id. Only runs a real payment backs, never a prediction. One of each kind of outcome comes
 * first, so the loop tells more than one story, then the most recent runs fill what is left. The answer never shuffles.
 */
export function pickWalkRuns(cells: MapCell[], limit = 4): string[] {
  const runs = new Map<string, { runId: string; verdict: VerdictKind; at: number }>();
  for (const cell of cells) {
    if (cell.basis !== 'CONFIRMED') continue;
    const parsed = Date.parse(cell.at);
    const at = Number.isFinite(parsed) ? parsed : 0; // a time that cannot be read counts as the oldest
    const held = runs.get(cell.runId) ?? { runId: cell.runId, verdict: cell.verdict, at };
    runs.set(cell.runId, { runId: cell.runId, verdict: WORST[cell.verdict] > WORST[held.verdict] ? cell.verdict : held.verdict, at: Math.max(held.at, at) });
  }
  const recent = [...runs.values()].sort((a, b) => b.at - a.at || compare(a.runId, b.runId));
  const picked: string[] = [];
  for (const kind of STORY) {
    const run = recent.find((r) => r.verdict === kind);
    if (run !== undefined && picked.length < limit) picked.push(run.runId);
  }
  for (const run of recent) if (picked.length < limit && !picked.includes(run.runId)) picked.push(run.runId);
  return picked;
}

/** The verdict a walk ends on: what a real payment confirmed, else the first thing the run said. */
export function walkVerdict(run: RunRecord): Verdict | null {
  return run.verdicts.find((v) => v.basis === 'CONFIRMED') ?? run.verdicts[0] ?? null;
}

/** The coin that does the walking: the token a payment confirmed, else the one that was paid, else the dollar token everyone has. */
export function walkToken(run: RunRecord): AssetSymbol {
  const confirmed = run.verdicts.find((v) => v.basis === 'CONFIRMED' && v.assetSymbol !== undefined)?.assetSymbol;
  if (confirmed !== undefined) return confirmed;
  const paid = run.payments[0] === undefined ? undefined : assetByAddress(run.payments[0].asset)?.symbol;
  return paid ?? 'USDC';
}
