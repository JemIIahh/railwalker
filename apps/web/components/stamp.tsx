import type { Basis, VerdictKind } from '@railwalker/core';
import { VERDICT_SHORT } from '../lib/labels';

/**
 * A verdict as a stamp. Solid means a real payment backs it; dashed and hatched means it is only a prediction, and the stamp says
 * which in words as well, so the difference never rests on colour or texture alone.
 */
export function Stamp({ verdict, basis, large = false, tilt = false, animate = false }: { verdict: VerdictKind; basis: Basis; large?: boolean; tilt?: boolean; animate?: boolean }) {
  const confirmed = basis === 'CONFIRMED';
  const classes = ['stamp', `v-${verdict.toLowerCase()}`, confirmed ? 'confirmed' : 'predicted', large ? 'stamp-lg' : '', tilt ? 'tilt' : '', animate ? 'stamp-pop' : ''].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {VERDICT_SHORT[verdict]}
      <small>{confirmed ? 'confirmed' : 'predicted'}</small>
    </span>
  );
}
