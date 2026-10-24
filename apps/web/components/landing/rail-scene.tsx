'use client';

import type { AssetSymbol } from '@railwalker/core';
import { useEffect, useRef, useState } from 'react';
import { GATES, timeline, type GateState, type Outcome } from '../../lib/diorama';
import { Bird } from '../bird';
import { Coin } from '../coin';
import { Icon, type IconName } from '../icons';
import { useReducedMotion } from '../motion';

/** Where each stop stands along the rail, from 0 to 1. */
const STOPS = [0.12, 0.31, 0.5, 0.69, 0.88];
const WALK = timeline({ gates: STOPS, end: 0.97, secondsPerUnit: 6.5, lead: 0.6, pause: 0.7, hold: 3, fade: 0.6 });

const MARK: Record<GateState, IconName> = { ok: 'check', warn: 'alert', fail: 'x', unsure: 'help', off: 'minus' };

interface View {
  /** Which of the walks is on show. */
  walk: number;
  /** How many stops the bird has reached. */
  passed: number;
  /** The stop it is standing at, if any. */
  visiting: number | null;
  /** Whether the result is on show. */
  result: boolean;
}

/** What a walk comes to, in the few words the rest of the site uses. */
function verdictOf(gates: GateState[]): { tone: 'good' | 'warn' | 'bad' | 'unsure'; word: string; icon: IconName } {
  if (gates.includes('fail')) return { tone: 'bad', word: 'Broken', icon: 'x' };
  if (gates.includes('unsure')) return { tone: 'unsure', word: 'Not sure', icon: 'help' };
  if (gates.includes('warn')) return { tone: 'warn', word: 'Needs polish', icon: 'alert' };
  return { tone: 'good', word: gates.includes('off') ? 'Looks ready' : 'Works', icon: 'check' };
}

/**
 * The little bird walking its rail past the five stops. Each stop takes its mark as the bird reaches it, the result appears at the end,
 * and the walk starts again with the next story. It pauses when it is off screen or the tab is hidden, and shows the finished walk, still,
 * to a visitor who asked for less motion. The timing comes from lib/diorama, which the tests cover.
 */
export function RailScene({ outcomes, label, restartKey = 0, example = false }: { outcomes: Outcome[]; label: string; restartKey?: number; example?: boolean }) {
  const root = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const latest = useRef(outcomes);
  latest.current = outcomes;
  const origin = useRef(0);
  const [view, setView] = useState<View>({ walk: 0, passed: 0, visiting: null, result: false });

  // a new check, or new stories, start the walk from the beginning
  useEffect(() => {
    origin.current = performance.now();
  }, [restartKey, outcomes]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (reduced) {
      el.style.setProperty('--p', '0.97');
      el.style.setProperty('--fade', '0');
      setView({ walk: 0, passed: STOPS.length, visiting: null, result: true });
      return;
    }
    let raf = 0;
    let onScreen = false;
    let shown: View = { walk: -1, passed: -1, visiting: null, result: false };
    const frame = (now: number) => {
      const seconds = (now - origin.current) / 1000;
      const at = WALK.at(seconds);
      const walk = Math.floor(seconds / WALK.duration) % Math.max(1, latest.current.length);
      el.style.setProperty('--p', String(at.progress));
      el.style.setProperty('--fade', String(at.fade));
      if (walk !== shown.walk || at.passed !== shown.passed || at.visiting !== shown.visiting || at.result !== shown.result) {
        shown = { walk, passed: at.passed, visiting: at.visiting, result: at.result };
        setView(shown);
      }
      raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      const run = onScreen && !document.hidden;
      if (run && raf === 0) raf = requestAnimationFrame(frame);
      if (!run && raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const visible = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      sync();
    }, { threshold: 0.05 });
    visible.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      visible.disconnect();
      document.removeEventListener('visibilitychange', sync);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const outcome = outcomes[view.walk % Math.max(1, outcomes.length)];
  const gates = outcome?.gates ?? [];
  const verdict = outcome ? verdictOf(gates) : null;
  const paid = view.passed > 2 && gates[2] !== undefined && gates[2] !== 'off';
  const moving = view.visiting === null && !view.result;

  return (
    <div className="rs" ref={root} role="img" aria-label={label} data-moving={moving ? 'true' : 'false'}>
      <div className="rs-top" aria-hidden="true">
        <span className="rs-slot">
          {view.result && verdict ? (
            <span className={`status tone-${verdict.tone}`}>
              <span className="status-ico">
                <Icon name={verdict.icon} size={17} strokeWidth={2.6} />
              </span>
              {verdict.word}
            </span>
          ) : null}
        </span>
        <span className="rs-slot">
          {example ? (
            <span className="rs-paid">Example walk, no real payment</span>
          ) : paid && outcome ? (
            <span className="rs-paid">
              <Coin symbol={outcome.symbol as AssetSymbol} size={22} /> Paid in {outcome.symbol}
            </span>
          ) : null}
        </span>
      </div>
      <div className="rs-track" aria-hidden="true">
        <div className="rs-rail">
          <span className="rs-fill" />
        </div>
        {STOPS.map((position, i) => {
          const state = view.passed > i ? (gates[i] ?? 'off') : 'idle';
          return (
            <div key={GATES[i]} className="rs-stop" style={{ left: `${position * 100}%` }} data-state={state} data-visiting={view.visiting === i ? 'true' : 'false'}>
              <span className="rs-node">{state === 'idle' ? null : <Icon name={MARK[state]} size={16} strokeWidth={2.8} />}</span>
              <span className="rs-name">{GATES[i]}</span>
            </div>
          );
        })}
        <div className="rs-walker">
          <Bird size={76} />
        </div>
      </div>
    </div>
  );
}
