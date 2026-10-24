import { describe, expect, test } from 'vitest';
import type { Verdict } from '@railwalker/core';
import type { RunRecord, RunStep } from '@railwalker/scanner';
import { makeFinding } from '@railwalker/core';
import { GATES, easeInOutCubic, gatesFor, gatesForScan, timeline } from '../lib/diorama';

const step = (stage: RunStep['stage'], ok: boolean | null): RunStep => ({ t: 0, stage, ok, label: `${stage} step` });
const verdict = (kind: Verdict['kind']): Verdict => ({ kind, basis: 'CONFIRMED', assetSymbol: 'USAT', findings: [] });
const run = (steps: RunStep[], kind: Verdict['kind'] | null = 'PASS'): RunRecord => ({ id: '0123456789abcdef', kind: 'fixture', startedAt: '2026-10-22T12:00:00.000Z', endpoint: { url: 'https://x.example/ok', method: 'GET' }, steps, verdicts: kind ? [verdict(kind)] : [], payments: [] });
const full = (over: Partial<Record<RunStep['stage'], boolean | null>> = {}) =>
  (['challenge', 'lints', 'wallet', 'sign', 'settle', 'deliver', 'verdict'] as const).map((stage) => step(stage, stage in over ? over[stage]! : true));

describe('the five gates', () => {
  test('are Price, Rules, Pay, Answer and Result', () => {
    expect([...GATES]).toEqual(['Price', 'Rules', 'Pay', 'Answer', 'Result']);
  });
});

describe('gatesFor: how a run did at each gate', () => {
  test('a clean paid run passes every gate', () => {
    expect(gatesFor(run(full()))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
  });

  test('the result gate takes its colour from the verdict: warnings, a failure, not sure, and not tested', () => {
    expect(gatesFor(run(full(), 'PASS_WITH_WARNINGS'))[4]).toBe('warn');
    expect(gatesFor(run(full(), 'FAIL'))[4]).toBe('fail');
    expect(gatesFor(run(full(), 'AMBIGUOUS'))[4]).toBe('unsure');
    expect(gatesFor(run(full(), 'SKIPPED'))[4]).toBe('off');
    expect(gatesFor(run(full(), null))[4]).toBe('off');
  });

  test('an answer that was empty fails the answer gate and leaves the earlier ones alone', () => {
    expect(gatesFor(run(full({ deliver: false }), 'FAIL'))).toEqual(['ok', 'ok', 'ok', 'fail', 'fail']);
  });

  test('the pay gate is passed only if the wallet, the signing and the settlement all went through', () => {
    expect(gatesFor(run(full({ wallet: false }), 'FAIL'))[2]).toBe('fail');
    expect(gatesFor(run(full({ sign: false }), 'FAIL'))[2]).toBe('fail');
    expect(gatesFor(run(full({ settle: false }), 'FAIL'))[2]).toBe('fail');
    expect(gatesFor(run(full({ settle: null }), 'AMBIGUOUS'))[2]).toBe('unsure');
  });

  test('a gate where one step failed and another is undecided has failed', () => {
    expect(gatesFor(run(full({ wallet: false, settle: null }), 'FAIL'))[2]).toBe('fail');
  });

  test('a run that never paid has its pay and answer gates off, whatever the scan said', () => {
    const scanOnly = run([step('challenge', true), step('lints', true), step('verdict', true)], 'PASS');
    expect(gatesFor(scanOnly)).toEqual(['ok', 'ok', 'off', 'off', 'ok']);
  });

  test('a price that could not be read fails the price gate, and failed rules fail the rules gate', () => {
    expect(gatesFor(run([step('challenge', false), step('verdict', false)], 'FAIL'))).toEqual(['fail', 'off', 'off', 'off', 'fail']);
    expect(gatesFor(run([step('challenge', true), step('lints', false), step('verdict', false)], 'FAIL'))).toEqual(['ok', 'fail', 'off', 'off', 'fail']);
  });

  test('a run with no steps at all has every gate off', () => {
    expect(gatesFor(run([], null))).toEqual(['off', 'off', 'off', 'off', 'off']);
  });
});

describe('easeInOutCubic', () => {
  test('is 0 at the start, 1 at the end, a half at the middle, and held at the ends outside zero to one', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(Number.NaN)).toBe(0);
  });

  test('is slow at both ends and never goes backwards', () => {
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe('timeline: when the cart is where', () => {
  const gates = [0.2, 0.4, 0.6, 0.8, 0.9];
  const tl = timeline({ gates, end: 1, lead: 1, secondsPerUnit: 10, pause: 1, hold: 2, fade: 1 });
  // lead 1 | travel 2 | pause 1 | travel 2 | pause 1 | travel 2 | pause 1 | travel 2 | pause 1 | travel 1 | pause 1 | travel 1 | hold 2 | fade 1

  test('the loop is the lead, every travel, every pause, the hold and the fade added up', () => {
    expect(tl.duration).toBeCloseTo(1 + (0.2 + 0.2 + 0.2 + 0.2 + 0.1 + 0.1) * 10 + 5 * 1 + 2 + 1, 9);
  });

  test('it says when the result starts to show: after the lead, every travel and every pause', () => {
    expect(tl.resultAt).toBeCloseTo(1 + 10 + 5, 9);
    expect(tl.at(tl.resultAt - 0.01).result).toBe(false);
    expect(tl.at(tl.resultAt + 0.01).result).toBe(true);
    expect(timeline().resultAt).toBeCloseTo(0.8 + 7.76 + 4, 9);
  });

  test('it waits at the start, then moves', () => {
    expect(tl.at(0)).toMatchObject({ progress: 0, passed: 0, visiting: null, result: false, fade: 0 });
    expect(tl.at(0.9)).toMatchObject({ progress: 0, visiting: null });
    expect(tl.at(1.5).progress).toBeGreaterThan(0);
    expect(tl.at(1.5).progress).toBeLessThan(0.2);
  });

  test('it stops at each gate for the pause, lighting that gate as it arrives', () => {
    // lead 1, travel to gate 0 takes 2 s, so it arrives at t = 3 and leaves at t = 4
    expect(tl.at(2.99).visiting).toBeNull();
    expect(tl.at(3.0)).toMatchObject({ progress: 0.2, visiting: 0, passed: 1 });
    expect(tl.at(3.5)).toMatchObject({ progress: 0.2, visiting: 0, passed: 1 });
    expect(tl.at(4.01)).toMatchObject({ visiting: null, passed: 1 });
    // gate 1: travel 4 → 6, pause 6 → 7
    expect(tl.at(6.5)).toMatchObject({ progress: 0.4, visiting: 1, passed: 2 });
  });

  test('it never goes backwards while it travels, and ends at the end of the track', () => {
    let last = 0;
    const travelEnds = 1 + 10 + 5; // the lead, all the travel including the last stretch, all the pauses
    for (let t = 0; t < travelEnds; t += 0.05) {
      const { progress } = tl.at(t);
      expect(progress).toBeGreaterThanOrEqual(last - 1e-9);
      last = progress;
    }
    expect(tl.at(travelEnds + 0.1).progress).toBe(1);
  });

  test('the result shows through the hold, then the scene fades, then it starts again', () => {
    const holdStart = tl.duration - 3; // hold 2 + fade 1
    expect(tl.at(holdStart - 0.01).result).toBe(false);
    expect(tl.at(holdStart + 0.5)).toMatchObject({ result: true, passed: 5, fade: 0 });
    const fading = tl.at(tl.duration - 0.5);
    expect(fading.fade).toBeCloseTo(0.5, 9);
    expect(fading.result).toBe(true);
    expect(tl.at(tl.duration + 0.5)).toMatchObject({ progress: 0, passed: 0, result: false });
  });

  test('time wraps around, and a time before zero is counted from the end', () => {
    expect(tl.at(tl.duration + 3.5)).toEqual(tl.at(3.5));
    expect(tl.at(-0.5)).toEqual(tl.at(tl.duration - 0.5));
  });

  test('the usual settings give a loop of a sensible length that stops at five gates', () => {
    const usual = timeline();
    expect(usual.duration).toBeGreaterThan(10);
    expect(usual.duration).toBeLessThan(22);
    let visited = new Set<number>();
    let most = 0;
    for (let t = 0; t < usual.duration; t += 0.05) {
      const now = usual.at(t);
      if (now.visiting !== null) visited.add(now.visiting);
      most = Math.max(most, now.passed);
    }
    expect([...visited].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(most).toBe(5);
  });

  test('the cart eases off: a quarter of the way through a stretch it has gone a sixteenth of it, not a quarter', () => {
    // lead 1, then 2 s to the first gate at 0.2: a quarter of that is 0.5 s in
    expect(tl.at(1.5).progress).toBeCloseTo(0.2 * 0.0625, 9);
  });

  test('gates given out of order never make time run backwards: the stretch back is no stretch at all', () => {
    const odd = timeline({ gates: [0.5, 0.3], end: 1, lead: 0, secondsPerUnit: 10, pause: 1, hold: 0, fade: 0 });
    // 5 s to the first gate, a pause, no travel to the second, a pause, 5 s on to the end
    expect(odd.duration).toBeCloseTo(5 + 1 + 0 + 1 + 7, 9);
  });
});

describe('gatesForScan: how a free scan did at each gate', () => {
  const scan = (codes: Parameters<typeof makeFinding>[0][], kinds: Verdict['kind'][] = ['PASS']) => ({
    findings: codes.map((c) => makeFinding(c, 'x')),
    verdicts: kinds.map((kind): Verdict => ({ kind, basis: 'PREDICTED', findings: [] })),
  });

  test('a clean scan passes the price and the rules, leaves the payment and the answer for a paid test, and looks ready', () => {
    expect(gatesForScan(scan([]))).toEqual(['ok', 'ok', 'off', 'off', 'ok']);
  });

  test('warnings make the result a warning, and notes that only inform do not', () => {
    expect(gatesForScan(scan(['cors_missing'], ['PASS_WITH_WARNINGS']))).toEqual(['ok', 'ok', 'off', 'off', 'warn']);
    expect(gatesForScan(scan(['no_output_schema', 'v1_challenge'], ['PASS']))).toEqual(['ok', 'ok', 'off', 'off', 'ok']);
  });

  test('an error in the rules fails the rules and the result', () => {
    expect(gatesForScan(scan(['payto_zero'], ['FAIL']))).toEqual(['ok', 'fail', 'off', 'off', 'fail']);
  });

  test('no price fails the price, and the rules never ran', () => {
    expect(gatesForScan(scan(['not_x402'], ['FAIL']))).toEqual(['fail', 'off', 'off', 'off', 'fail']);
    expect(gatesForScan(scan(['challenge_timeout'], ['FAIL']))).toEqual(['fail', 'off', 'off', 'off', 'fail']);
  });

  test('a scan that was refused is nothing at all', () => {
    expect(gatesForScan(scan([], ['SKIPPED']))).toEqual(['fail', 'off', 'off', 'off', 'off']);
  });
});
