import { describe, expect, test } from 'vitest';
import type { MapCell } from '@railwalker/data';
import { ASSETS, type Verdict } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import { pickWalkRuns, walkToken, walkVerdict } from '../lib/walk';

let n = 0;
const id = () => (++n).toString(16).padStart(16, '0');
const cell = (over: Partial<MapCell> = {}): MapCell => ({ row: 'ok', group: 'fixture', asset: 'USAT', verdict: 'PASS', basis: 'CONFIRMED', runId: id(), at: '2026-10-22T12:00:00.000Z', ...over });
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 12, minutes)).toISOString();

describe('pickWalkRuns: which runs the hero walks through', () => {
  test('only runs a real payment backs: a prediction is never walked', () => {
    const real = cell({ at: at(1) });
    const guess = cell({ basis: 'PREDICTED', at: at(9) });
    expect(pickWalkRuns([guess, real])).toEqual([real.runId]);
    expect(pickWalkRuns([guess])).toEqual([]);
  });

  test('one of each kind of outcome comes first, pass, then fail, then warnings, then unclear, so the loop tells more than one story', () => {
    const warn = cell({ verdict: 'PASS_WITH_WARNINGS', at: at(5) });
    const fail = cell({ verdict: 'FAIL', code: 'delivered_empty', at: at(4) });
    const pass = cell({ verdict: 'PASS', at: at(3) });
    const extraPass = cell({ verdict: 'PASS', at: at(2) }); // more recent than the unclear one, so only the story order can put the unclear one in
    const unsure = cell({ verdict: 'AMBIGUOUS', code: 'ambiguous_after_payment', at: at(1) });
    expect(pickWalkRuns([warn, fail, pass, unsure, extraPass], 4)).toEqual([pass.runId, fail.runId, warn.runId, unsure.runId]);
  });

  test('the story is cut at the limit, not carried on past it', () => {
    const pass = cell({ verdict: 'PASS', at: at(3) });
    const fail = cell({ verdict: 'FAIL', code: 'delivered_empty', at: at(4) });
    const warn = cell({ verdict: 'PASS_WITH_WARNINGS', at: at(5) });
    expect(pickWalkRuns([pass, fail, warn], 1)).toEqual([pass.runId]);
    expect(pickWalkRuns([pass, fail, warn], 2)).toEqual([pass.runId, fail.runId]);
  });

  test('the most recent run of each kind is the one chosen, and the rest are filled in by recency', () => {
    const oldPass = cell({ verdict: 'PASS', at: at(1) });
    const newPass = cell({ verdict: 'PASS', at: at(8) });
    const midPass = cell({ verdict: 'PASS', at: at(5) });
    const fail = cell({ verdict: 'FAIL', code: 'delivered_empty', at: at(2) });
    expect(pickWalkRuns([oldPass, newPass, midPass, fail], 3)).toEqual([newPass.runId, fail.runId, midPass.runId]);
    expect(pickWalkRuns([oldPass, newPass, midPass, fail], 4)).toEqual([newPass.runId, fail.runId, midPass.runId, oldPass.runId]);
  });

  test('a run with several confirmed cells is one run, and what it is known by is the worst of them, whichever order they come in', () => {
    const shared = id();
    const fine = cell({ runId: shared, asset: 'USDC', verdict: 'PASS', at: at(3) });
    const broken = cell({ runId: shared, asset: 'USAT', verdict: 'FAIL', code: 'delivered_empty', at: at(3) });
    const other = cell({ verdict: 'PASS', at: at(1) });
    expect(pickWalkRuns([fine, broken, other], 2)).toEqual([other.runId, shared]); // pass first, then the fail the shared run stands for
    expect(pickWalkRuns([broken, fine, other], 2)).toEqual([other.runId, shared]);
    expect(pickWalkRuns([fine, broken], 5)).toEqual([shared]);
  });

  test('unclear outranks failing, failing outranks warnings, and warnings outrank passing, for a run with several', () => {
    const kinds = ['PASS', 'PASS_WITH_WARNINGS', 'FAIL', 'AMBIGUOUS'] as const;
    const mixed = id();
    const cells = kinds.map((verdict) => cell({ runId: mixed, verdict, at: at(1) }));
    const lonePass = cell({ verdict: 'PASS', at: at(0) });
    const loneUnsure = cell({ verdict: 'AMBIGUOUS', code: 'ambiguous_after_payment', at: at(0) });
    // the mixed run is an AMBIGUOUS one: it takes the unclear slot ahead of a more recent lone unclear run
    expect(pickWalkRuns([...cells, lonePass, { ...loneUnsure, at: at(9) }], 3)).toEqual([lonePass.runId, loneUnsure.runId, mixed]);
  });

  test('warnings outrank a pass for a run with both: it takes the warnings slot, not the pass one', () => {
    const mixed = id();
    const both = [cell({ runId: mixed, asset: 'USDC', verdict: 'PASS', at: at(9) }), cell({ runId: mixed, asset: 'USAT', verdict: 'PASS_WITH_WARNINGS', at: at(9) })];
    const lonePass = cell({ verdict: 'PASS', at: at(1) });
    expect(pickWalkRuns([...both, lonePass], 1)).toEqual([lonePass.runId]); // the pass slot goes to the run that only passed
    expect(pickWalkRuns([...both.reverse(), lonePass], 1)).toEqual([lonePass.runId]);
  });

  test('a run is as recent as its latest cell', () => {
    const shared = id();
    const old = cell({ runId: shared, asset: 'USDC', at: at(1) });
    const late = cell({ runId: shared, asset: 'USAT', at: at(7) });
    const mid = cell({ verdict: 'FAIL', code: 'delivered_empty', at: at(5) });
    // pass first (the shared run, which is the only pass), then the fail
    expect(pickWalkRuns([old, late, mid], 2)).toEqual([shared, mid.runId]);
    const midPass = cell({ verdict: 'PASS', at: at(5) });
    expect(pickWalkRuns([old, late, midPass], 2)).toEqual([shared, midPass.runId]);
    expect(pickWalkRuns([late, old, midPass], 2)).toEqual([shared, midPass.runId]); // whichever of its cells comes last
  });

  test('the limit is respected, and zero or less is nothing', () => {
    const cells = Array.from({ length: 6 }, (_, i) => cell({ at: at(i) }));
    expect(pickWalkRuns(cells, 2)).toHaveLength(2);
    expect(pickWalkRuns(cells, 0)).toEqual([]);
    expect(pickWalkRuns(cells, -3)).toEqual([]);
    expect(pickWalkRuns(cells)).toHaveLength(4); // the default
  });

  test('an unreadable time is the oldest, and equal times go in run-id order so the answer never shuffles', () => {
    const unreadable = cell({ at: 'not a date' });
    const dated = cell({ at: at(1) });
    expect(pickWalkRuns([unreadable, dated], 2)).toEqual([dated.runId, unreadable.runId]);
    const x = cell({ runId: 'aaaaaaaaaaaaaaaa', at: at(2) });
    const y = cell({ runId: 'bbbbbbbbbbbbbbbb', at: at(2) });
    expect(pickWalkRuns([y, x], 2)).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  });

  test('no cells, no runs', () => {
    expect(pickWalkRuns([])).toEqual([]);
  });
});

const verdict = (over: Partial<Verdict> = {}): Verdict => ({ kind: 'PASS', basis: 'CONFIRMED', assetSymbol: 'USAT', findings: [], ...over });
const run = (over: Partial<RunRecord> = {}): RunRecord => ({ id: '0123456789abcdef', kind: 'fixture', startedAt: '2026-10-22T12:00:00.000Z', endpoint: { url: 'https://x.example/ok', method: 'GET' }, steps: [], verdicts: [], payments: [], ...over });

describe('walkVerdict: the verdict a walk ends on', () => {
  test('what a payment confirmed, else the first thing said, else nothing', () => {
    const predicted = verdict({ basis: 'PREDICTED', assetSymbol: 'USDC' });
    const confirmed = verdict({ basis: 'CONFIRMED', kind: 'FAIL', code: 'delivered_empty' });
    expect(walkVerdict(run({ verdicts: [predicted, confirmed] }))).toBe(confirmed);
    expect(walkVerdict(run({ verdicts: [predicted, verdict({ basis: 'PREDICTED', assetSymbol: 'USDT' })] }))).toBe(predicted);
    expect(walkVerdict(run({ verdicts: [] }))).toBeNull();
  });
});

describe('walkToken: the coin that walks', () => {
  test('the token a payment confirmed, else the one that was paid, else the dollar one', () => {
    expect(walkToken(run({ verdicts: [verdict({ basis: 'PREDICTED', assetSymbol: 'USDC' }), verdict({ assetSymbol: 'USAT' })] }))).toBe('USAT');
    const paid = { asset: ASSETS.USDT.address, symbol: 'USDT', amountAtomic: '5000', payTo: ASSETS.USDC.address };
    expect(walkToken(run({ verdicts: [verdict({ basis: 'PREDICTED', assetSymbol: undefined })], payments: [paid] }))).toBe('USDT');
    expect(walkToken(run({ payments: [{ ...paid, asset: '0x1234567890123456789012345678901234567890' }] }))).toBe('USDC');
    expect(walkToken(run())).toBe('USDC');
  });

  test('a confirmed verdict that names no token is skipped for one that does', () => {
    const paid = { asset: ASSETS.USAT.address, symbol: 'USAT', amountAtomic: '5000', payTo: ASSETS.USDC.address };
    const whole = verdict({ assetSymbol: undefined });
    const named = verdict({ assetSymbol: 'USDT' });
    expect(walkToken(run({ verdicts: [whole, named], payments: [paid] }))).toBe('USDT');
  });

  test('a confirmed verdict about the whole endpoint has no token, so the payment decides', () => {
    const paid = { asset: ASSETS.USAT.address, symbol: 'USAT', amountAtomic: '5000', payTo: ASSETS.USDC.address };
    expect(walkToken(run({ verdicts: [verdict({ assetSymbol: undefined })], payments: [paid] }))).toBe('USAT');
  });
});
