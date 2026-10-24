import { describe, expect, test } from 'vitest';
import type { RunRecord, RunStep } from '@railwalker/scanner';
import { initialReplay, replayReducer } from '../lib/replay';
import { makeFinding, type Verdict } from '@railwalker/core';
import { STATIONS, scanOutcome, scanStations, stationsFor } from '../lib/stations';

const step = (stage: RunStep['stage'], ok: boolean | null): RunStep => ({ t: 0, stage, ok, label: `${stage} step` });
const run = (steps: RunStep[]): RunRecord => ({ id: '0123456789abcdef', kind: 'buy', startedAt: '2026-10-22T12:00:00.000Z', endpoint: { url: 'https://gateway.usebuy.ai/v1/x', method: 'POST' }, steps, verdicts: [], payments: [] });
const full = run([step('challenge', true), step('lints', true), step('wallet', true), step('sign', true), step('settle', true), step('deliver', false), step('verdict', false)]);
const scanOnly = run([step('challenge', true), step('lints', false), step('verdict', false)]);
const at = (r: RunRecord, shown: number) => {
  let s = initialReplay(r);
  s = replayReducer(s, { type: 'seek', to: shown }, r);
  return stationsFor(s.chips);
};

describe('the seven stations', () => {
  test('in the order a payment goes through them, each with one word', () => {
    expect(STATIONS.map((s) => s.stage)).toEqual(['challenge', 'lints', 'wallet', 'sign', 'settle', 'deliver', 'verdict']);
    expect(STATIONS.map((s) => s.word)).toEqual(['Price', 'Rules', 'Wallet', 'Sign', 'Settle', 'Deliver', 'Verdict']);
  });
});

describe('stationsFor', () => {
  test('before the first step every station is waiting and the walker has not left the start', () => {
    const { stations, walkerAt } = at(full, 0);
    expect(stations.map((s) => s.state)).toEqual(Array(7).fill('pending'));
    expect(walkerAt).toBe(-1);
  });

  test('part way, the reached stations say how they went and the walker stands on the last one', () => {
    const { stations, walkerAt } = at(full, 4);
    expect(stations.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'pending', 'pending', 'pending']);
    expect(walkerAt).toBe(3);
  });

  test('at the end a failed station says so', () => {
    const { stations, walkerAt } = at(full, 7);
    expect(stations.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'fail', 'fail']);
    expect(walkerAt).toBe(6);
  });

  test('a stage that is reached but undecided is reached, not ok', () => {
    const r = run([step('challenge', true), step('wallet', null)]);
    expect(at(r, 2).stations.map((s) => s.state)).toEqual(['ok', 'absent', 'reached', 'absent', 'absent', 'absent', 'absent']);
    expect(at(r, 2).walkerAt).toBe(2); // an undecided station is still where the walker has got to
  });

  test('stages the run never went through are absent, and the walker skips them', () => {
    const early = at(scanOnly, 2);
    expect(early.stations.map((s) => s.state)).toEqual(['ok', 'fail', 'absent', 'absent', 'absent', 'absent', 'pending']);
    expect(early.walkerAt).toBe(1);
    const done = at(scanOnly, 3);
    expect(done.stations.map((s) => s.state)).toEqual(['ok', 'fail', 'absent', 'absent', 'absent', 'absent', 'fail']);
    expect(done.walkerAt).toBe(6);
  });

  test('each station carries its stage and its word', () => {
    const { stations } = at(full, 7);
    expect(stations.map((s) => [s.stage, s.word])).toEqual(STATIONS.map((s) => [s.stage, s.word]));
  });

  test('no chips at all is seven absent stations and a walker at the start', () => {
    expect(stationsFor([])).toEqual({ stations: STATIONS.map((s) => ({ ...s, state: 'absent' })), walkerAt: -1 });
  });
});

describe('scanStations: the three stations of a free scan', () => {
  const clean = { challenge: true, errors: 0, failing: false, skipped: false };
  const states = (r: ReturnType<typeof scanStations>) => r.stations.map((s) => s.state);

  test('they are Price, Rules and Verdict, in that order', () => {
    expect(scanStations({ phase: 'loading' }).stations.map((s) => [s.stage, s.word])).toEqual([['challenge', 'Price'], ['lints', 'Rules'], ['verdict', 'Verdict']]);
  });

  test('while the request is out, the walker is at Price and nothing is decided', () => {
    const r = scanStations({ phase: 'loading' });
    expect(states(r)).toEqual(['reached', 'pending', 'pending']);
    expect(r.walkerAt).toBe(0);
  });

  test('before a result is shown it is all still to come, and the walker has not started', () => {
    const r = scanStations({ phase: 'done', outcome: clean, revealed: 0 });
    expect(states(r)).toEqual(['pending', 'pending', 'pending']);
    expect(r.walkerAt).toBe(-1);
  });

  test('a result is shown one station at a time, the walker on the last one shown', () => {
    expect(scanStations({ phase: 'done', outcome: clean, revealed: 1 })).toMatchObject({ walkerAt: 0 });
    expect(states(scanStations({ phase: 'done', outcome: clean, revealed: 1 }))).toEqual(['ok', 'pending', 'pending']);
    expect(states(scanStations({ phase: 'done', outcome: clean, revealed: 2 }))).toEqual(['ok', 'ok', 'pending']);
    const all = scanStations({ phase: 'done', outcome: clean, revealed: 3 });
    expect(states(all)).toEqual(['ok', 'ok', 'ok']);
    expect(all.walkerAt).toBe(2);
  });

  test('part of a station is not the station: 1.9 shown is one shown', () => {
    const r = scanStations({ phase: 'done', outcome: clean, revealed: 1.9 });
    expect(states(r)).toEqual(['ok', 'pending', 'pending']);
    expect(r.walkerAt).toBe(0);
  });

  test('more than three is still three, and a negative count is none', () => {
    expect(scanStations({ phase: 'done', outcome: clean, revealed: 9 }).walkerAt).toBe(2);
    expect(scanStations({ phase: 'done', outcome: clean, revealed: -2 }).walkerAt).toBe(-1);
  });

  test('no 402 fails Price, an error found fails Rules, and a failing verdict fails Verdict, each on its own', () => {
    expect(states(scanStations({ phase: 'done', outcome: { challenge: false, errors: 0, failing: false, skipped: false }, revealed: 3 }))).toEqual(['fail', 'ok', 'ok']);
    expect(states(scanStations({ phase: 'done', outcome: { challenge: true, errors: 2, failing: false, skipped: false }, revealed: 3 }))).toEqual(['ok', 'fail', 'ok']);
    expect(states(scanStations({ phase: 'done', outcome: { challenge: true, errors: 1, failing: false, skipped: false }, revealed: 3 }))).toEqual(['ok', 'fail', 'ok']); // one is enough
    expect(states(scanStations({ phase: 'done', outcome: { challenge: true, errors: 0, failing: true, skipped: false }, revealed: 3 }))).toEqual(['ok', 'ok', 'fail']);
  });

  test('a scan that was refused is not a pass: no price was read, the rules never ran, and the verdict is undecided', () => {
    const skipped = { challenge: true, errors: 0, failing: false, skipped: true };
    expect(states(scanStations({ phase: 'done', outcome: skipped, revealed: 3 }))).toEqual(['fail', 'absent', 'reached']);
    expect(states(scanStations({ phase: 'done', outcome: skipped, revealed: 1 }))).toEqual(['fail', 'pending', 'pending']);
    expect(scanStations({ phase: 'done', outcome: skipped, revealed: 3 }).walkerAt).toBe(2);
  });

  test('a failure is not shown until its station is', () => {
    expect(states(scanStations({ phase: 'done', outcome: { challenge: true, errors: 1, failing: true, skipped: false }, revealed: 1 }))).toEqual(['ok', 'pending', 'pending']);
  });
});

describe('scanOutcome: what the three stations of a free scan are told', () => {
  const report = (codes: Parameters<typeof makeFinding>[0][], kinds: Verdict['kind'][] = ['PASS']) => ({
    findings: codes.map((c) => makeFinding(c, 'x')),
    verdicts: kinds.map((kind): Verdict => ({ kind, basis: 'PREDICTED', findings: [] })),
  });

  test('a clean scan has a price, no errors and nothing failing', () => {
    expect(scanOutcome(report([]))).toEqual({ challenge: true, errors: 0, failing: false, skipped: false });
  });

  test('no x402 answer, or no answer in time, is no price; and is not also counted as an error among the rules', () => {
    expect(scanOutcome(report(['not_x402'], ['FAIL']))).toEqual({ challenge: false, errors: 0, failing: true, skipped: false });
    expect(scanOutcome(report(['challenge_timeout'], ['FAIL']))).toEqual({ challenge: false, errors: 0, failing: true, skipped: false });
  });

  test('errors are counted, warnings and notes are not', () => {
    expect(scanOutcome(report(['payto_zero', 'asset_is_fee_adapter', 'cors_missing', 'no_output_schema'])).errors).toBe(2);
    expect(scanOutcome(report(['cors_missing', 'too_slow', 'v1_challenge'])).errors).toBe(0);
  });

  test('a price and errors together: the price is there, the rules are broken', () => {
    expect(scanOutcome(report(['payto_zero'], ['FAIL']))).toEqual({ challenge: true, errors: 1, failing: true, skipped: false });
  });

  test('a scan that was skipped is said so: a skipped verdict, and only that, is skipped', () => {
    expect(scanOutcome(report([], ['SKIPPED'])).skipped).toBe(true);
    expect(scanOutcome(report([], ['PASS', 'SKIPPED'])).skipped).toBe(true);
    expect(scanOutcome(report([], ['PASS', 'FAIL', 'PASS_WITH_WARNINGS'])).skipped).toBe(false);
    expect(scanOutcome(report([], [])).skipped).toBe(false);
  });

  test('failing is any verdict that failed; warnings and passes do not fail, and neither does a skip', () => {
    expect(scanOutcome(report([], ['PASS', 'PASS_WITH_WARNINGS', 'SKIPPED'])).failing).toBe(false);
    expect(scanOutcome(report([], ['PASS', 'FAIL'])).failing).toBe(true);
    expect(scanOutcome(report([], [])).failing).toBe(false);
  });
});
