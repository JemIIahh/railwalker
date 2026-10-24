'use client';

import type { CSSProperties } from 'react';
import { Icon, type IconName } from './icons';
import { CountUp, useFill } from './motion';

/** One number, large, with what it counts underneath. What it means in full is on hover and for a screen reader. */
export function StatCard({ icon, label, hint, value, decimals = 0, prefix, suffix, ring }: { icon: IconName; label: string; hint: string; value: number; decimals?: number; prefix?: string; suffix?: string; ring?: number }) {
  const [ref, phase] = useFill<HTMLDivElement>(0.4);
  const style = { '--to': ring ?? 0 } as CSSProperties;
  return (
    <div className="stat card" ref={ref} title={hint}>
      {ring === undefined ? (
        <span className="stat-ico">
          <Icon name={icon} size={22} />
        </span>
      ) : (
        <span className="ring" data-phase={phase} style={style} aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      <div className="stat-num mono">
        <CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </div>
      <div className="stat-label">{label}</div>
      <p className="sr-only">{hint}</p>
    </div>
  );
}
