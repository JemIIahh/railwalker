import type { Finding, Verdict } from '@railwalker/core';
import type { RunRecord, RunStage } from '@railwalker/scanner';
import { scanOutcome } from './stations';
import { walkVerdict } from './walk';

/** The five stops the bird walks past, in the order a check goes: the price, the setup, the payment, the answer, the result. */
export const GATES = ['Price', 'Rules', 'Pay', 'Answer', 'Result'] as const;

/** How a run did at a gate. Off means the run never got there. */
export type GateState = 'ok' | 'warn' | 'fail' | 'unsure' | 'off';

/** One walk: how the bird fares at each stop, and the token that paid. */
export interface Outcome {
  gates: GateState[];
  symbol: string;
  glyph: string;
  color: string;
}

const RESULT: Record<Verdict['kind'], GateState> = { PASS: 'ok', PASS_WITH_WARNINGS: 'warn', FAIL: 'fail', AMBIGUOUS: 'unsure', SKIPPED: 'off' };

/** How a run did at each gate. The payment gate is passed only if the wallet, the signing and the settlement all went through. */
export function gatesFor(run: RunRecord): GateState[] {
  const at = (stages: RunStage[]): GateState => {
    const steps = run.steps.filter((s) => stages.includes(s.stage));
    if (steps.length === 0) return 'off';
    if (steps.some((s) => s.ok === false)) return 'fail';
    if (steps.some((s) => s.ok === null)) return 'unsure';
    return 'ok';
  };
  const verdict = walkVerdict(run);
  return [at(['challenge']), at(['lints']), at(['wallet', 'sign', 'settle']), at(['deliver']), verdict === null ? 'off' : RESULT[verdict.kind]];
}

/**
 * How a free scan did at each gate. It reads the price and the rules; the payment and the answer are left for a paid test, so those
 * gates stay off. A scan that was refused got no further than the price, and one that found no price never reached the rules.
 */
export function gatesForScan(report: { findings: Pick<Finding, 'code' | 'severity'>[]; verdicts: Pick<Verdict, 'kind'>[] }): GateState[] {
  const outcome = scanOutcome(report);
  if (outcome.skipped) return ['fail', 'off', 'off', 'off', 'off'];
  if (!outcome.challenge) return ['fail', 'off', 'off', 'off', 'fail'];
  const result: GateState = outcome.failing ? 'fail' : report.findings.some((f) => f.severity === 'warn') ? 'warn' : 'ok';
  return ['ok', outcome.errors > 0 ? 'fail' : 'ok', 'off', 'off', result];
}

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);

/** Slow at both ends: how the bird should leave and arrive. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

export interface TimelineOptions {
  /** Where each gate stands along the track, from 0 to 1. */
  gates?: number[];
  /** Where the bird comes to rest at the end. */
  end?: number;
  /** Seconds waiting at the start. */
  lead?: number;
  /** Seconds to travel the whole track without stopping. */
  secondsPerUnit?: number;
  /** Seconds stopped at each gate. */
  pause?: number;
  /** Seconds the result is shown. */
  hold?: number;
  /** Seconds the scene fades before it starts again. */
  fade?: number;
}

export interface TimelineAt {
  /** How far along the track, from 0 to 1. */
  progress: number;
  /** How many gates have been reached, counting the one it is stopped at. */
  passed: number;
  /** The gate it is stopped at, if any. */
  visiting: number | null;
  /** Whether the result is on show. */
  result: boolean;
  /** How far the scene has faded, from 0 to 1. */
  fade: number;
}

interface Segment {
  start: number;
  end: number;
  from: number;
  to: number;
  kind: 'lead' | 'travel' | 'pause' | 'hold' | 'fade';
  gate: number;
}

/**
 * When the bird is where, as a loop: it waits, travels to the first gate, stops, goes on to the next, and so on, comes to rest at the
 * end while the result is shown, fades, and starts again. Pure: the scene only asks it where to be at a given time.
 */
export function timeline(options: TimelineOptions = {}): { duration: number; resultAt: number; at: (seconds: number) => TimelineAt } {
  const { gates = [0.14, 0.32, 0.5, 0.68, 0.86], end = 0.97, lead = 0.8, secondsPerUnit = 8, pause = 0.8, hold = 2.6, fade = 0.7 } = options;
  const segments: Segment[] = [];
  let clock = 0;
  const add = (kind: Segment['kind'], seconds: number, from: number, to: number, gate: number) => {
    segments.push({ start: clock, end: clock + seconds, from, to, kind, gate });
    clock += seconds;
  };
  add('lead', lead, 0, 0, -1);
  let at = 0;
  gates.forEach((position, i) => {
    add('travel', Math.max(0, position - at) * secondsPerUnit, at, position, i);
    add('pause', pause, position, position, i);
    at = position;
  });
  add('travel', Math.max(0, end - at) * secondsPerUnit, at, end, gates.length);
  const resultAt = clock;
  add('hold', hold, end, end, gates.length);
  add('fade', fade, end, end, gates.length);
  const duration = clock;

  return {
    duration,
    resultAt,
    at(seconds: number): TimelineAt {
      const x = ((seconds % duration) + duration) % duration;
      const seg = segments.find((s) => x < s.end) ?? segments[segments.length - 1]!;
      const length = seg.end - seg.start;
      switch (seg.kind) {
        case 'lead':
          return { progress: 0, passed: 0, visiting: null, result: false, fade: 0 };
        case 'travel':
          return { progress: seg.from + (seg.to - seg.from) * easeInOutCubic(length === 0 ? 1 : (x - seg.start) / length), passed: seg.gate, visiting: null, result: false, fade: 0 };
        case 'pause':
          return { progress: seg.to, passed: seg.gate + 1, visiting: seg.gate, result: false, fade: 0 };
        case 'hold':
          return { progress: end, passed: gates.length, visiting: null, result: true, fade: 0 };
        case 'fade':
          return { progress: end, passed: gates.length, visiting: null, result: true, fade: length === 0 ? 1 : (x - seg.start) / length };
      }
    },
  };
}
