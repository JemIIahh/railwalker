'use client';

import { useEffect, useReducer, useState } from 'react';
import type { RunRecord, RunStep } from '@railwalker/scanner';
import { currentStep, initialReplay, receiptShown, replayReducer, seekToStage, shouldAnimate, stepDelayMs, type ReplayEvent, type ReplayState } from '../lib/replay';
import { stationsFor } from '../lib/stations';
import { walkToken } from '../lib/walk';
import { Coin } from './coin';
import { Icon } from './icons';
import { useReducedMotion } from './motion';
import { Receipt } from './receipt';
import { STAGE_ICON, StationRail } from './station-rail';

const SPEEDS = [1, 2] as const;

function Step({ step }: { step: RunStep }) {
  const state = step.ok === true ? 'ok' : step.ok === false ? 'fail' : '';
  const detail = step.detail ? JSON.stringify(step.detail, null, 2) : null;
  return (
    <li className={`tl-step ${state}`}>
      <span className="tl-node">
        <Icon name={STAGE_ICON[step.stage]} size={15} />
      </span>
      <div className="tl-main">
        <span className="tl-label">{step.label}</span>
        {detail ? (
          <details className="tl-detail">
            <summary>details</summary>
            <pre>{detail.length > 900 ? `${detail.slice(0, 900)}…` : detail}</pre>
          </details>
        ) : null}
      </div>
      <span className="tl-time mono">+{(step.t / 1000).toFixed(1)}s</span>
    </li>
  );
}

/**
 * The replay of one run: the stations with the coin walking through them, play, scrub and speed, the steps as they happen, and the
 * receipt that appears when the payment goes out. It plays itself once (unless the visitor asked for less motion) and any
 * station can be clicked to jump there.
 */
export function RunStage({ run }: { run: RunRecord }) {
  const total = run.steps.length;
  const [state, dispatch] = useReducer((s: ReplayState, e: ReplayEvent) => replayReducer(s, e, run), run, (r) => initialReplay(r));
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!shouldAnimate(reduced)) {
      dispatch({ type: 'seek', to: total }); // the whole story at once, to be played by hand
      return;
    }
    if (total > 0) dispatch({ type: 'play' });
  }, [reduced, total]);

  useEffect(() => {
    if (!state.playing) return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), stepDelayMs(speed));
    return () => clearInterval(timer);
  }, [state.playing, speed]);

  const { stations, walkerAt } = stationsFor(state.chips);
  const shown = run.steps.slice(0, state.index);
  const latest = currentStep(state, run);
  const finished = total > 0 && state.index >= total;
  const label = state.playing ? 'Pause' : finished ? 'Replay' : 'Play';

  return (
    <>
      <section className="replay card" aria-label="Replay of this run">
        <StationRail
          stations={stations}
          walkerAt={walkerAt}
          walker={<Coin symbol={walkToken(run)} size={36} />}
          onPick={(stage) => {
            const to = seekToStage(run, stage);
            if (to !== null) dispatch({ type: 'seek', to });
          }}
        />
        <div className="controls">
          <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })} disabled={total === 0}>
            <Icon name={state.playing ? 'pause' : finished ? 'replay' : 'play'} size={14} />
            {label}
          </button>
          <input className="scrub" type="range" min={0} max={total} value={state.index} onChange={(e) => dispatch({ type: 'seek', to: Number(e.target.value) })} aria-label="Step of the replay" disabled={total === 0} style={{ '--fill': total === 0 ? 0 : (state.index / total) * 100 } as React.CSSProperties} />
          <button type="button" className="chip chip-plain speed" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)} aria-label={`Speed ${speed} times, change`}>
            {speed}×
          </button>
          <span className="counter mono">
            {state.index} / {total}
          </span>
        </div>
      </section>

      <div className="stage-grid">
        <section className="timeline-card card" aria-label="Steps so far">
          {shown.length === 0 ? (
            <p className="tl-idle">{total === 0 ? 'No steps were recorded.' : 'Press play, or drag the slider.'}</p>
          ) : (
            <ol className="timeline">
              {shown.map((step, i) => (
                <Step key={`${i}-${step.stage}`} step={step} />
              ))}
            </ol>
          )}
          <p className="sr-only" aria-live="polite">
            {latest ? `Step ${state.index} of ${total}: ${latest.label}` : ''}
          </p>
        </section>
        <Receipt run={run} shown={receiptShown(run, state.index)} stamped={finished} />
      </div>
    </>
  );
}
