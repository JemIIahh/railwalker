import type { Basis, VerdictKind } from '@railwalker/core';
import { statusOf, type Tone } from '../lib/status';
import { Icon, type IconName } from './icons';

const ICON: Record<Tone, IconName> = { good: 'check', warn: 'alert', bad: 'x', unsure: 'help', idle: 'minus' };

/**
 * How something did, in a few friendly words and a face. A solid face means a real paid test backs it; a hollow one means it is only a
 * quick look. The words never claim more than was done, and the basis can be written out beside it.
 */
export function StatusBadge({ verdict, basis, big = false, showBasis = false }: { verdict: VerdictKind; basis: Basis; big?: boolean; showBasis?: boolean }) {
  const s = statusOf(verdict, basis);
  const quick = basis !== 'CONFIRMED';
  return (
    <span className="status-wrap">
      <span className={`status tone-${s.tone}${quick ? ' quick' : ''}${big ? ' status-big' : ''}`} title={s.sentence}>
        <span className="status-ico">
          <Icon name={ICON[s.tone]} size={big ? 22 : 17} strokeWidth={2.6} />
        </span>
        {s.word}
      </span>
      {showBasis ? (
        <span className="basis">
          <Icon name={quick ? 'eye' : 'coins'} size={14} /> {s.basisWord}
        </span>
      ) : null}
    </span>
  );
}
