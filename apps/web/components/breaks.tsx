'use client';

import type { CSSProperties } from 'react';
import { FINDING_LABELS, FINDING_PLAIN } from '../lib/labels';
import type { AssetBar, FindingBar } from '../lib/view-models';
import { Coin } from './coin';
import { Icon } from './icons';
import { useFill } from './motion';

const percent = (share: number) => Math.round(share * 100);

/** What breaks most: one row for each finding, an icon for how serious it is, a bar for how many endpoints it touches. */
export function FindingBars({ bars }: { bars: FindingBar[] }) {
  const [ref, phase] = useFill<HTMLUListElement>();
  const top = Math.max(...bars.map((b) => b.count), 1); // the longest bar is the full track: bars are ranked against each other, the figure beside each is the share of endpoints
  if (bars.length === 0) {
    return (
      <div className="empty">
        <span className="ico">
          <Icon name="scan" size={22} />
        </span>
        <p>Nothing scanned yet</p>
      </div>
    );
  }
  return (
    <ul className="bars" ref={ref} data-phase={phase}>
      {bars.map((b, i) => (
        <li key={b.code} className={`bar-row sev-${b.severity}`} style={{ '--w': Math.max((b.count / top) * 100, 3), '--i': i } as CSSProperties} title={`${FINDING_LABELS[b.code]}: ${b.count} endpoints`}>
          <span className="bar-ico">{b.severity === 'error' ? <Icon name="x" size={14} strokeWidth={2.6} /> : <b>!</b>}</span>
          <span className="bar-label">{FINDING_PLAIN[b.code]}</span>
          <span className="track" aria-hidden="true">
            <span className="fill" />
          </span>
          <span className="bar-n mono">{percent(b.share)}%</span>
          <span className="sr-only">{`${FINDING_LABELS[b.code]}: ${b.count} endpoints`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Which tokens sellers take: a coin in a ring that fills to the share of endpoints that list it. */
export function TokenRings({ bars }: { bars: AssetBar[] }) {
  const [ref, phase] = useFill<HTMLUListElement>();
  if (bars.length === 0) {
    return (
      <div className="empty">
        <span className="ico">
          <Icon name="coins" size={22} />
        </span>
        <p>Nothing scanned yet</p>
      </div>
    );
  }
  return (
    <ul className="tokens" ref={ref} data-phase={phase}>
      {bars.map((b) => (
        <li key={b.symbol} className="tok" style={{ '--to': percent(b.share) } as CSSProperties} title={`${b.count} endpoints list ${b.symbol} on Celo mainnet`}>
          <span className="tok-ring">
            <Coin symbol={b.symbol} size={42} />
          </span>
          <span className="tok-sym">{b.symbol}</span>
          <span className="tok-pct mono">{percent(b.share)}%</span>
          <span className="sr-only">{`${b.count} endpoints list ${b.symbol} on Celo mainnet`}</span>
        </li>
      ))}
    </ul>
  );
}
