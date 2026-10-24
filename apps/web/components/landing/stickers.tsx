'use client';

import { Icon, type IconName } from '../icons';
import { CountUp } from '../motion';

export interface Sticker {
  icon: IconName;
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  tint: string;
}

/** The three big numbers, as stickers: a figure that counts up and a few words. */
export function Stickers({ items }: { items: Sticker[] }) {
  return (
    <div className="stickers">
      {items.map((s) => (
        <div key={s.label} className={`sticker ${s.tint}`}>
          <Icon name={s.icon} size={28} />
          <span className="sticker-num">
            <CountUp value={s.value} decimals={s.decimals ?? 0} suffix={s.suffix ?? ''} />
          </span>
          <span className="sticker-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
