import type { Finding, Verdict } from '@railwalker/core';
import type { RunStage } from '@railwalker/scanner';
import type { ReplayChip } from './replay';

/** The seven places a payment passes through, in order, each named with one word. */
export const STATIONS: readonly { stage: RunStage; word: string }[] = [
  { stage: 'challenge', word: 'Price' },
  { stage: 'lints', word: 'Rules' },
  { stage: 'wallet', word: 'Wallet' },
  { stage: 'sign', word: 'Sign' },
  { stage: 'settle', word: 'Settle' },
  { stage: 'deliver', word: 'Deliver' },
  { stage: 'verdict', word: 'Verdict' },
];

/** absent: this run never went there. pending: not reached yet. reached: reached, nothing decided. ok and fail: reached, and how it went. */
export type StationState = 'absent' | 'pending' | 'reached' | 'ok' | 'fail';

export interface Station {
  stage: RunStage;
  word: string;
  state: StationState;
}

/** All seven stations for what a replay shows so far, and the one the walker stands on (-1: still at the start). */
export function stationsFor(chips: ReplayChip[]): { stations: Station[]; walkerAt: number } {
  const stations = STATIONS.map((s): Station => {
    const chip = chips.find((c) => c.stage === s.stage);
    const state: StationState = chip === undefined ? 'absent' : !chip.reached ? 'pending' : chip.ok === true ? 'ok' : chip.ok === false ? 'fail' : 'reached';
    return { ...s, state };
  });
  let walkerAt = -1;
  stations.forEach((s, i) => {
    if (s.state === 'ok' || s.state === 'fail' || s.state === 'reached') walkerAt = i;
  });
  return { stations, walkerAt };
}

/** What a free scan found: was there a price, were there errors, is the verdict a failing one, or was the scan refused before it began. */
export interface ScanOutcome {
  challenge: boolean;
  errors: number;
  failing: boolean;
  /** Not scanned at all (an address that is not safe to visit, say): nothing was read, so nothing can be said to have passed. */
  skipped: boolean;
}

const SCAN_STAGES: readonly RunStage[] = ['challenge', 'lints', 'verdict'];

/**
 * The walk of a free scan has three stations. While the request is out the walker waits at the first; when the answer is in, the
 * stations are shown one at a time, each saying how it went, and the walker stands on the last one shown.
 */
export function scanStations(input: { phase: 'loading' } | { phase: 'done'; outcome: ScanOutcome; revealed: number }): { stations: Station[]; walkerAt: number } {
  const words = STATIONS.filter((s) => SCAN_STAGES.includes(s.stage));
  if (input.phase === 'loading') return { stations: words.map((s, i): Station => ({ ...s, state: i === 0 ? 'reached' : 'pending' })), walkerAt: 0 };
  const shown = Math.max(0, Math.min(words.length, Math.floor(input.revealed)));
  const good = [input.outcome.challenge, input.outcome.errors === 0, !input.outcome.failing];
  const decided: StationState[] = input.outcome.skipped ? ['fail', 'absent', 'reached'] : good.map((g): StationState => (g ? 'ok' : 'fail'));
  return { stations: words.map((s, i): Station => ({ ...s, state: i >= shown ? 'pending' : decided[i]! })), walkerAt: shown - 1 };
}

/** The outcome of a scan report. No x402 answer, or none in time, is "no price" and is not also counted among the errors of the rules. */
export function scanOutcome(report: { findings: Pick<Finding, 'code' | 'severity'>[]; verdicts: Pick<Verdict, 'kind'>[] }): ScanOutcome {
  const noPrice = (f: Pick<Finding, 'code'>) => f.code === 'not_x402' || f.code === 'challenge_timeout';
  return {
    challenge: !report.findings.some(noPrice),
    errors: report.findings.filter((f) => f.severity === 'error' && !noPrice(f)).length,
    failing: report.verdicts.some((v) => v.kind === 'FAIL'),
    skipped: report.verdicts.some((v) => v.kind === 'SKIPPED'),
  };
}
