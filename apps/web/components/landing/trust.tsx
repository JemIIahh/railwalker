'use client';

import type { CSSProperties } from 'react';
import { Icon, type IconName } from '../icons';
import { useFill } from '../motion';

export interface TrustItem {
  icon: IconName;
  value: string;
  of: string;
}

/** The hard spending limits as three big numbers, the guards as small pills, and the whole budget as a meter that fills to what has been used. */
export function Trust({ items, guards, budget }: { items: TrustItem[]; guards: { icon: IconName; text: string }[]; budget: { used: number; of: number; usedText: string; ofText: string } | null }) {
  const [ref, phase] = useFill<HTMLDivElement>(0.4);
  const share = budget === null || budget.of <= 0 ? 0 : Math.min(1, budget.used / budget.of);
  return (
    <>
      <ul className="trust-grid">
        {items.map((i) => (
          <li key={i.of} className="trust-card">
            <span className="trust-ico">
              <Icon name={i.icon} size={24} />
            </span>
            <span className="trust-num">{i.value}</span>
            <span className="trust-of">{i.of}</span>
          </li>
        ))}
      </ul>
      {budget === null ? null : (
        <div className="meter" ref={ref} data-phase={phase} style={{ '--w': Math.max(share * 100, 0.8) } as CSSProperties}>
          <div className="meter-top">
            <span>Spent so far</span>
            <span>
              <strong>{budget.usedText}</strong> of {budget.ofText}
            </span>
          </div>
          <div className="meter-track" role="img" aria-label={`${budget.usedText} of ${budget.ofText} spent`}>
            <span className="meter-fill" />
          </div>
        </div>
      )}
      <ul className="guards">
        {guards.map((g) => (
          <li key={g.text}>
            <Icon name={g.icon} size={16} /> {g.text}
          </li>
        ))}
      </ul>
    </>
  );
}
