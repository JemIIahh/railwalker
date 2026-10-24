import { describe, expect, test } from 'vitest';
import type { RunRecord, RunStep } from '@railwalker/scanner';
import { currentStep, initialReplay, receiptShown, replayProgress, replayReducer, seekToStage, shouldAnimate, stationState, stepDelayMs, type ReplayState } from '../lib/replay';

const step = (stage: RunStep['stage'], ok: boolean | null, label = `${stage} step`): RunStep => ({ t: 0, stage, ok, label });
const run = (steps: RunStep[]): RunRecord => ({ id: '0123456789abcdef', kind: 'buy', startedAt: '2026-10-22T12:00:00.000Z', endpoint: { url: 'https://gateway.usebuy.ai/v1/x', method: 'POST' }, steps, verdicts: [], payments: [] });
const story = run([step('challenge', true), step('lints', true), step('wallet', true), step('sign', true), step('settle', true), step('deliver', false), step('verdict', true)]);
const at = (s: ReplayState, e: Parameters<typeof replayReducer>[1], r = story) => replayReducer(s, e, r);
const playing = (r = story) => at(initialReplay(r), { type: 'play' }, r);

describe('initialReplay', () => {
  test('starts at the beginning, paused, with nothing reached', () => {
    const s = initialReplay(story);
    expect(s).toMatchObject({ index: 0, playing: false });
    expect(s.chips.every((c) => !c.reached && c.ok === null)).toBe(true);
  });

  test('without animation everything is already shown: the end, paused, every stage reached', () => {
    const s = initialReplay(story, false);
    expect(s).toMatchObject({ index: 7, playing: false });
    expect(s.chips.every((c) => c.reached)).toBe(true);
  });

  test('a chip for each stage the run went through, in the order a payment goes through them, once each', () => {
    const twice = run([step('challenge', true), step('wallet', true), step('wallet', false), step('verdict', true)]);
    expect(initialReplay(twice).chips.map((c) => c.stage)).toEqual(['challenge', 'wallet', 'verdict']);
    const shuffled = run([step('verdict', true), step('challenge', true)]);
    expect(initialReplay(shuffled).chips.map((c) => c.stage)).toEqual(['challenge', 'verdict']);
  });

  test('a run with no steps has no chips and nothing to play', () => {
    const empty = run([]);
    expect(initialReplay(empty)).toEqual({ index: 0, playing: false, chips: [] });
    expect(at(initialReplay(empty), { type: 'play' }, empty)).toMatchObject({ index: 0, playing: false });
  });
});

describe('play, pause and tick', () => {
  test('play starts it, and a tick moves it on by one step', () => {
    const s = at(playing(), { type: 'tick' });
    expect(s).toMatchObject({ index: 1, playing: true });
  });

  test('a tick does nothing while it is paused', () => {
    const paused = at(playing(), { type: 'pause' });
    expect(at(paused, { type: 'tick' })).toEqual(paused);
    expect(at(initialReplay(story), { type: 'tick' })).toEqual(initialReplay(story));
  });

  test('pause freezes it where it is', () => {
    let s = playing();
    s = at(at(s, { type: 'tick' }), { type: 'tick' });
    s = at(s, { type: 'pause' });
    expect(s).toMatchObject({ index: 2, playing: false });
    expect(at(s, { type: 'tick' }).index).toBe(2);
  });

  test('it stops by itself at the last step, which stays shown', () => {
    let s = playing();
    for (let i = 0; i < 20; i++) s = at(s, { type: 'tick' });
    expect(s).toMatchObject({ index: 7, playing: false });
    expect(s.chips.every((c) => c.reached)).toBe(true);
  });

  test('play at the end starts it again from the beginning', () => {
    const done = at(initialReplay(story, false), { type: 'play' });
    expect(done).toMatchObject({ index: 0, playing: true });
    expect(done.chips.every((c) => !c.reached)).toBe(true);
  });

  test('play in the middle goes on from there', () => {
    let s = at(playing(), { type: 'tick' });
    s = at(at(s, { type: 'pause' }), { type: 'play' });
    expect(s).toMatchObject({ index: 1, playing: true });
  });

  test('playing again while it is playing changes nothing', () => {
    const s = at(playing(), { type: 'tick' });
    expect(at(s, { type: 'play' })).toEqual(s);
  });

  test('a tick at the end cannot go past it, even from a state that says it is still playing', () => {
    const odd: ReplayState = { ...initialReplay(story, false), playing: true };
    expect(at(odd, { type: 'tick' })).toEqual(odd);
  });

  test('pausing something already paused changes nothing', () => {
    const s = at(initialReplay(story), { type: 'seek', to: 2 });
    expect(at(s, { type: 'pause' })).toEqual(s);
  });

  test('reset goes back to the start, paused', () => {
    const s = at(at(playing(), { type: 'tick' }), { type: 'reset' });
    expect(s).toEqual(initialReplay(story));
  });
});

describe('seek', () => {
  test.each([
    [-5, 0],
    [0, 0],
    [3, 3],
    [7, 7],
    [99, 7],
    [2.9, 2],
    [Number.POSITIVE_INFINITY, 7],
    [Number.NEGATIVE_INFINITY, 0],
  ])('seeking to %f goes to step %i', (to, expected) => {
    expect(at(initialReplay(story), { type: 'seek', to }).index).toBe(expected);
  });

  test('a seek that is not a number is ignored', () => {
    const s = at(playing(), { type: 'tick' });
    expect(at(s, { type: 'seek', to: Number.NaN })).toEqual(s);
    expect(at(s, { type: 'seek' })).toEqual(s);
  });

  test('seeking in the middle keeps it playing or paused as it was', () => {
    expect(at(playing(), { type: 'seek', to: 3 })).toMatchObject({ index: 3, playing: true });
    expect(at(initialReplay(story), { type: 'seek', to: 3 })).toMatchObject({ index: 3, playing: false });
  });

  test('seeking to the end stops it', () => {
    expect(at(playing(), { type: 'seek', to: 7 })).toMatchObject({ index: 7, playing: false });
    expect(at(playing(), { type: 'seek', to: 500 })).toMatchObject({ index: 7, playing: false });
  });

  test('chips follow the seek, backwards as well as forwards', () => {
    const forward = at(initialReplay(story), { type: 'seek', to: 3 });
    expect(forward.chips.filter((c) => c.reached).map((c) => c.stage)).toEqual(['challenge', 'lints', 'wallet']);
    const back = at(forward, { type: 'seek', to: 1 });
    expect(back.chips.filter((c) => c.reached).map((c) => c.stage)).toEqual(['challenge']);
  });
});

describe('chips', () => {
  test('a stage is reached once one of its steps has been shown, and its mark is what those steps say', () => {
    const s = at(initialReplay(story), { type: 'seek', to: 6 }); // everything up to and including deliver
    expect(s.chips.map((c) => [c.stage, c.reached, c.ok])).toEqual([
      ['challenge', true, true],
      ['lints', true, true],
      ['wallet', true, true],
      ['sign', true, true],
      ['settle', true, true],
      ['deliver', true, false],
      ['verdict', false, null],
    ]);
  });

  test('a stage with several steps is ok only if all of those shown are; any failure fails it; an undecided one leaves it undecided', () => {
    const r = run([step('wallet', true), step('wallet', false), step('wallet', true), step('settle', true), step('settle', null), step('lints', null)]);
    const marks = (to: number) => Object.fromEntries(at(initialReplay(r), { type: 'seek', to }, r).chips.map((c) => [c.stage, c.ok]));
    expect(marks(1)).toMatchObject({ wallet: true });
    expect(marks(2)).toMatchObject({ wallet: false });
    expect(marks(3)).toMatchObject({ wallet: false }); // a later success does not undo a failure
    expect(marks(5)).toMatchObject({ settle: null });
    expect(marks(6)).toMatchObject({ lints: null });
  });

  test('only the steps that have been shown count: a failure later in the story is not known yet', () => {
    const r = run([step('wallet', true), step('wallet', false)]);
    expect(at(initialReplay(r), { type: 'seek', to: 1 }, r).chips[0]).toMatchObject({ reached: true, ok: true });
  });
});

describe('currentStep and replayProgress', () => {
  test('the step on screen is the last one shown; nothing before the first', () => {
    expect(currentStep(initialReplay(story), story)).toBeNull();
    expect(currentStep(at(initialReplay(story), { type: 'seek', to: 3 }), story)).toBe(story.steps[2]);
    expect(currentStep(initialReplay(story, false), story)).toBe(story.steps[6]);
  });

  test('progress is the share of steps shown, from zero to one, and zero for a run with no steps', () => {
    expect(replayProgress(initialReplay(story), story)).toBe(0);
    expect(replayProgress(at(initialReplay(story), { type: 'seek', to: 3 }), story)).toBeCloseTo(3 / 7, 9);
    expect(replayProgress(initialReplay(story, false), story)).toBe(1);
    expect(replayProgress({ index: 0, playing: false, chips: [] }, run([]))).toBe(0);
  });
});

describe('shouldAnimate', () => {
  test('a visitor who asks for reduced motion gets none, and everyone else gets it', () => {
    expect(shouldAnimate(true)).toBe(false);
    expect(shouldAnimate(false)).toBe(true);
  });
});

describe('purity', () => {
  test('the state and the run are never changed, and every answer is a new state', () => {
    const before = initialReplay(story);
    const frozen = structuredClone(before);
    const runCopy = structuredClone(story);
    const after = at(before, { type: 'seek', to: 3 });
    expect(before).toEqual(frozen);
    expect(story).toEqual(runCopy);
    expect(after).not.toBe(before);
    expect(after.chips).not.toBe(before.chips);
  });
});

describe('stationState', () => {
  test('a station not yet reached is pending, and a reached one says how it went', () => {
    expect(stationState({ stage: 'sign', ok: null, reached: false })).toBe('pending');
    expect(stationState({ stage: 'sign', ok: true, reached: false })).toBe('pending');
    expect(stationState({ stage: 'sign', ok: true, reached: true })).toBe('reached ok');
    expect(stationState({ stage: 'sign', ok: false, reached: true })).toBe('reached fail');
    expect(stationState({ stage: 'sign', ok: null, reached: true })).toBe('reached');
  });
});

const pay = { asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', symbol: 'USDC', amountAtomic: '5000', payTo: '0x1111111111111111111111111111111111111111' };

describe('seekToStage', () => {
  test('is the number of steps to show for a stage to have just been reached: its first step is the last one shown', () => {
    expect(seekToStage(story, 'challenge')).toBe(1);
    expect(seekToStage(story, 'wallet')).toBe(3);
    expect(seekToStage(story, 'verdict')).toBe(7);
    const twice = run([step('challenge', true), step('wallet', true), step('wallet', false), step('verdict', true)]);
    expect(seekToStage(twice, 'wallet')).toBe(2);
  });

  test('a stage the run never went through is nowhere', () => {
    expect(seekToStage(run([step('challenge', true), step('verdict', true)]), 'settle')).toBeNull();
    expect(seekToStage(run([]), 'challenge')).toBeNull();
  });
});

describe('receiptShown', () => {
  const paid = { ...story, payments: [pay] };

  test('without a payment there is no receipt, however far the replay has got', () => {
    for (const shown of [0, 3, 7]) expect(receiptShown(story, shown)).toBe(false);
  });

  test('with one, it is on the table once the payment has been sent: the sign step shown', () => {
    expect(receiptShown(paid, 0)).toBe(false);
    expect(receiptShown(paid, 3)).toBe(false);
    expect(receiptShown(paid, 4)).toBe(true);
    expect(receiptShown(paid, 7)).toBe(true);
  });

  test('a payment recorded with no sign step is shown at the end', () => {
    const odd = { ...run([step('challenge', true), step('settle', true), step('verdict', true)]), payments: [pay] };
    expect(receiptShown(odd, 2)).toBe(false);
    expect(receiptShown(odd, 3)).toBe(true);
  });
});

describe('stepDelayMs', () => {
  test('a step takes a little under a second, and twice the speed takes half as long', () => {
    expect(stepDelayMs(1)).toBe(950);
    expect(stepDelayMs(2)).toBe(475);
    expect(stepDelayMs(0.5)).toBe(1900);
  });

  test('a speed that is not a positive number is the normal one', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(stepDelayMs(bad), String(bad)).toBe(950);
  });
});
