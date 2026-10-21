import { describe, expect, test } from 'vitest';
import { RunRecorder } from '../src';

const endpoint = { url: 'https://seller.example/api/data', method: 'GET' as const };
const at = (ms: number) => () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0, ms));

describe('RunRecorder', () => {
  test('steps carry milliseconds since the start, from the injected clock', () => {
    const times = [0, 5, 20];
    let i = 0;
    const r = new RunRecorder(() => at(times[Math.min(i++, times.length - 1)]!)(), 'fixture', endpoint);
    r.step('challenge', true, 'a');
    r.step('lints', true, 'b');
    const run = r.finish([]);
    expect(run.steps.map((s) => s.t)).toEqual([5, 20]);
    expect(run.startedAt).toBe('2026-10-22T12:00:00.000Z');
  });

  test('t never goes backwards, even if the clock does', () => {
    const times = [0, 50, 10, 70];
    let i = 0;
    const r = new RunRecorder(() => at(times[i++]!)(), 'buy', endpoint);
    for (const s of ['challenge', 'lints', 'wallet'] as const) r.step(s, true, s);
    expect(r.finish([]).steps.map((s) => s.t)).toEqual([50, 50, 70]);
  });

  test('records stage, ok, label and optional detail exactly', () => {
    const r = new RunRecorder(at(0), 'fixture', endpoint);
    r.step('settle', null, 'waiting', { txHash: '0xabc' });
    r.step('verdict', false, 'no detail');
    const [a, b] = r.finish([]).steps;
    expect(a).toEqual({ t: 0, stage: 'settle', ok: null, label: 'waiting', detail: { txHash: '0xabc' } });
    expect(b).toEqual({ t: 0, stage: 'verdict', ok: false, label: 'no detail' });
    expect('detail' in b!).toBe(false);
  });

  test('the record carries the kind, endpoint, payments and verdicts it was given', () => {
    const r = new RunRecorder(at(0), 'customer', endpoint);
    r.payment({ asset: '0xabc', symbol: 'USAT', amountAtomic: '5000', payTo: '0xdef', txHash: '0x123' });
    const verdict = { kind: 'PASS' as const, basis: 'CONFIRMED' as const, findings: [] };
    const run = r.finish([verdict]);
    expect(run).toMatchObject({ kind: 'customer', endpoint, verdicts: [verdict], payments: [{ symbol: 'USAT', txHash: '0x123' }] });
  });

  test('the id is stable for one run and differs between runs and kinds', () => {
    const make = (kind: 'buy' | 'fixture', ms: number) => new RunRecorder(at(ms), kind, endpoint).finish([]).id;
    expect(make('buy', 0)).toBe(make('buy', 0));
    expect(make('buy', 0)).not.toBe(make('buy', 1));
    expect(make('buy', 0)).not.toBe(make('fixture', 0));
    expect(make('buy', 0)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('the record is a snapshot: later steps do not change a finished run', () => {
    const r = new RunRecorder(at(0), 'fixture', endpoint);
    r.step('challenge', true, 'a');
    const run = r.finish([]);
    r.step('lints', true, 'b');
    expect(run.steps).toHaveLength(1);
  });
});
