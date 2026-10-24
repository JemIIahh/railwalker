import type { CSSProperties, ReactNode } from 'react';
import type { RunStage } from '@railwalker/scanner';
import type { Station } from '../lib/stations';
import { Icon, type IconName } from './icons';

export const STAGE_ICON: Record<RunStage, IconName> = { challenge: 'tag', lints: 'checklist', wallet: 'wallet', sign: 'pen', settle: 'swap', deliver: 'box', verdict: 'flag' };
const SAID: Record<Station['state'], string> = { absent: 'not part of this run', pending: 'not reached yet', reached: 'reached', ok: 'passed', fail: 'failed' };

/**
 * The seven stations a payment passes through, as a line of small tiles on a track. A walker (a coin) stands on the one the run
 * has reached. Presentational only: what to show comes from `stationsFor`.
 */
export function StationRail({ stations, walkerAt, walker, size = 'lg', onPick }: { stations: Station[]; walkerAt: number; walker?: ReactNode; size?: 'lg' | 'md'; onPick?: (stage: RunStage) => void }) {
  const n = stations.length;
  const style = { '--n': n, '--fill': walkerAt <= 0 ? 0 : walkerAt / (n - 1), '--at': walkerAt } as CSSProperties;
  return (
    <div className={`rail-wrap rail-${size}`} style={style}>
      <ol className="rail" aria-label="Stations of a payment">
        {stations.map((s, i) => (
          <li key={s.stage} className="station" data-state={s.state} data-active={i === walkerAt ? '' : undefined}>
            {onPick ? (
              <button type="button" className="tile" onClick={() => onPick(s.stage)} aria-label={`${s.word}: ${SAID[s.state]}`}>
                <Icon name={STAGE_ICON[s.stage]} size={size === 'lg' ? 24 : 20} />
                <Badge state={s.state} />
              </button>
            ) : (
              <span className="tile">
                <Icon name={STAGE_ICON[s.stage]} size={size === 'lg' ? 24 : 20} />
                <Badge state={s.state} />
              </span>
            )}
            <span className="word">{s.word}</span>
            {onPick ? null : <span className="sr-only">{SAID[s.state]}</span>}
          </li>
        ))}
      </ol>
      {walker ? (
        <span className="walker" aria-hidden="true">
          {walker}
        </span>
      ) : null}
    </div>
  );
}

function Badge({ state }: { state: Station['state'] }) {
  if (state !== 'ok' && state !== 'fail') return null;
  return (
    <span className="badge" aria-hidden="true">
      <Icon name={state === 'ok' ? 'check' : 'x'} size={12} strokeWidth={3} />
    </span>
  );
}
