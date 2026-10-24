import type { RunRecord, RunStage, RunStep } from '@railwalker/scanner';

/** The order a payment goes through its stages, which is the order the chips are drawn in. */
const STAGE_ORDER: readonly RunStage[] = ['challenge', 'lints', 'wallet', 'sign', 'settle', 'deliver', 'verdict'];

export interface ReplayChip {
  stage: RunStage;
  /** What the steps shown so far say about this stage; null while undecided, or before it is reached. */
  ok: boolean | null;
  reached: boolean;
}

export interface ReplayState {
  /** How many steps of the run are shown: 0 before the first, the number of steps at the end. */
  index: number;
  playing: boolean;
  chips: ReplayChip[];
}

export type ReplayEvent = { type: 'play' } | { type: 'pause' } | { type: 'tick' } | { type: 'reset' } | { type: 'seek'; to?: number };

/** A visitor who asks for reduced motion is shown the whole story at once, and plays it by hand if they want to. */
export const shouldAnimate = (prefersReducedMotion: boolean): boolean => !prefersReducedMotion;

/** One chip for each stage the run went through. A stage with several steps is ok only if every step shown is, and failed if any is. */
function chipsAt(run: RunRecord, shown: number): ReplayChip[] {
  const stages = STAGE_ORDER.filter((stage) => run.steps.some((step) => step.stage === stage));
  return stages.map((stage) => {
    const revealed = run.steps.slice(0, shown).filter((step) => step.stage === stage);
    if (revealed.length === 0) return { stage, ok: null, reached: false };
    const ok = revealed.some((step) => step.ok === false) ? false : revealed.every((step) => step.ok === true) ? true : null;
    return { stage, ok, reached: true };
  });
}

export function initialReplay(run: RunRecord, animate = true): ReplayState {
  const index = animate ? 0 : run.steps.length;
  return { index, playing: false, chips: chipsAt(run, index) };
}

/** Pure: the same state and event always give the same answer, and nothing passed in is changed. */
export function replayReducer(state: ReplayState, event: ReplayEvent, run: RunRecord): ReplayState {
  const total = run.steps.length;
  const at = (index: number, playing: boolean): ReplayState => ({ index, playing, chips: chipsAt(run, index) });
  switch (event.type) {
    case 'play':
      if (total === 0) return state;
      return state.index >= total ? at(0, true) : at(state.index, true); // playing from the end starts again
    case 'pause':
      return at(state.index, false);
    case 'tick': {
      if (!state.playing || state.index >= total) return state;
      const next = state.index + 1;
      return at(next, next < total); // it stops by itself on the last step, which stays shown
    }
    case 'reset':
      return initialReplay(run);
    case 'seek': {
      const to = event.to;
      if (typeof to !== 'number' || Number.isNaN(to)) return state;
      const index = Math.max(0, Math.min(total, Math.floor(to)));
      return at(index, state.playing && index < total);
    }
  }
}

/** The classes a station on the rail wears. Named so that no other part of the page uses them. */
export function stationState(chip: ReplayChip): string {
  if (!chip.reached) return 'pending';
  return chip.ok === true ? 'reached ok' : chip.ok === false ? 'reached fail' : 'reached';
}

/** The step on screen: the last one shown, or none before the first. */
export function currentStep(state: ReplayState, run: RunRecord): RunStep | null {
  return run.steps[state.index - 1] ?? null; // before the first step the index is 0, and nothing is at -1
}

/** From zero to one. */
export function replayProgress(state: ReplayState, run: RunRecord): number {
  return run.steps.length === 0 ? 0 : state.index / run.steps.length;
}

/** How many steps to show so that a stage has just been reached: its first step is the last one shown. Null for a stage the run never went through. */
export function seekToStage(run: RunRecord, stage: RunStage): number | null {
  const at = run.steps.findIndex((step) => step.stage === stage);
  return at < 0 ? null : at + 1;
}

/** The receipt is on the table once the payment has been sent (the sign step is shown), or at the end if the run has no such step. Without a payment there is none. */
export function receiptShown(run: RunRecord, shown: number): boolean {
  if (run.payments.length === 0) return false;
  return shown >= (seekToStage(run, 'sign') ?? run.steps.length);
}

const STEP_MS = 950;

/** How long one step is shown for at a given speed (1 is normal). A speed that is not a positive number is the normal one. */
export function stepDelayMs(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? STEP_MS / speed : STEP_MS;
}
