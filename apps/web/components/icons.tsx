import type { ReactNode, SVGProps } from 'react';

/**
 * One small set of line icons, drawn on a 24-point grid with a round 1.75 stroke so they all look like one family.
 * They are drawn here rather than pulled in from a library: each is a few lines of path.
 */
const d = (path: string, key = path) => <path key={key} d={path} />;

const ICONS = {
  tag: [d('M3.5 4.5a1 1 0 0 1 1-1h7.2a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z'), <circle key="c" cx="8.2" cy="8.2" r="1.15" />],
  checklist: [d('M10 6.5h10.5'), d('M10 12h10.5'), d('M10 17.5h10.5'), d('M3.5 6.2l1.5 1.5L7.4 5'), d('M3.5 11.7l1.5 1.5 2.4-2.7'), d('M3.5 17.2l1.5 1.5 2.4-2.7')],
  wallet: [d('M3.5 8A2.5 2.5 0 0 1 6 5.5h11.5a2 2 0 0 1 2 2V9'), d('M3.5 8v9a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2v-2.5'), d('M20.5 9.5h-4.2a2.5 2.5 0 0 0 0 5h4.2z'), <circle key="c" cx="16.6" cy="12" r="0.55" fill="currentColor" />],
  pen: [d('M4 20h3.8L19 8.8a2.3 2.3 0 0 0-3.3-3.3L4.5 16.7z'), d('M14.3 6.9l3.3 3.3')],
  swap: [d('M4 8.5h14.5'), d('M15 5l3.5 3.5L15 12'), d('M20 15.5H5.5'), d('M9 12l-3.5 3.5L9 19')],
  box: [d('M3.5 7.8 12 3.2l8.5 4.6v8.4L12 20.8l-8.5-4.6z'), d('M3.6 7.9 12 12.4l8.4-4.5'), d('M12 12.4v8.3')],
  flag: [d('M5.5 21V3.8'), d('M5.5 4.5h11.3l-2.3 4 2.3 4H5.5')],
  play: [d('M7.5 4.6v14.8c0 .8.9 1.3 1.6.8l11-7.4a1 1 0 0 0 0-1.6l-11-7.4c-.7-.5-1.6 0-1.6.8z')],
  pause: [d('M7.5 5h3v14h-3z'), d('M13.5 5h3v14h-3z')],
  replay: [d('M4 12a8 8 0 1 0 2.6-5.9'), d('M4 4.2v4.3h4.3')],
  arrowRight: [d('M4.5 12h15'), d('M13.5 6l6 6-6 6')],
  arrowDown: [d('M12 4.5v15'), d('M6 13.5l6 6 6-6')],
  arrowUpRight: [d('M7 17 17 7'), d('M8.5 7H17v8.5')],
  chevronDown: [d('M6.5 9.5l5.5 5.5 5.5-5.5')],
  copy: [<rect key="r" x="9" y="9" width="11.5" height="11.5" rx="2.5" />, d('M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5.5A2 2 0 0 1 5.5 3.5h8A1.5 1.5 0 0 1 15 5v.5')],
  check: [d('M5 12.8l4.4 4.4L19 7.4')],
  x: [d('M6 6l12 12'), d('M18 6 6 18')],
  info: [<circle key="c" cx="12" cy="12" r="9" />, d('M12 11v5.2'), <circle key="d" cx="12" cy="7.9" r="0.6" fill="currentColor" />],
  search: [<circle key="c" cx="11" cy="11" r="6.5" />, d('M16 16l4.5 4.5')],
  scan: [d('M4 8.5V6a2 2 0 0 1 2-2h2.5'), d('M15.5 4H18a2 2 0 0 1 2 2v2.5'), d('M20 15.5V18a2 2 0 0 1-2 2h-2.5'), d('M8.5 20H6a2 2 0 0 1-2-2v-2.5'), d('M7.5 12h9')],
  coins: [<circle key="o" cx="12" cy="12" r="8.5" />, <circle key="i" cx="12" cy="12" r="4.6" />, d('M12 9.9v4.2')],
  shield: [d('M12 3.2 4.8 6v5.4c0 4.5 3 8.2 7.2 9.4 4.2-1.2 7.2-4.9 7.2-9.4V6z'), d('M8.8 12l2.2 2.2 4.2-4.4')],
  eye: [d('M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z'), <circle key="c" cx="12" cy="12" r="2.7" />],
  lock: [<rect key="r" x="5" y="10.5" width="14" height="10" rx="2.5" />, d('M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5')],
  cursor: [d('M5.5 4.5l5 14.5 2.4-6 6-2.4z')],
  receipt: [d('M6 3.5h12v17l-2.4-1.6-2.4 1.6L12 18.9l-1.2 1.6-2.4-1.6L6 20.5z'), d('M9 8.5h6'), d('M9 12h6')],
  gate: [d('M4.5 4.5V20'), d('M2.8 20h3.4'), <rect key="r" x="4.5" y="8" width="16" height="4.4" rx="1.3" />, d('M9 8l-2 4.4'), d('M13.5 8l-2 4.4'), d('M18 8l-2 4.4')],
  unlock: [<rect key="r" x="5" y="10.5" width="14" height="10" rx="2.5" />, d('M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6')],
  arrowDownLeft: [d('M17 7 7 17'), d('M15.5 17H7V8.5')],
  clock: [<circle key="c" cx="12" cy="12" r="9" />, d('M12 7v5.3l3.3 2')],
  link: [d('M10 14a3.8 3.8 0 0 0 5.4 0l3-3a3.8 3.8 0 0 0-5.4-5.4l-.9.9'), d('M14 10a3.8 3.8 0 0 0-5.4 0l-3 3a3.8 3.8 0 0 0 5.4 5.4l.9-.9')],
  bolt: [d('M13 3 5.5 13.2h5.3L10 21l7.5-10.2h-5.3z')],
  alert: [<circle key="c" cx="12" cy="12" r="9" />, d('M12 7.5v5'), <circle key="d" cx="12" cy="16.2" r="0.7" fill="currentColor" />],
  help: [<circle key="c" cx="12" cy="12" r="9" />, d('M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5'), <circle key="d" cx="12" cy="16.6" r="0.7" fill="currentColor" />],
  minus: [d('M6 12h12')],
  menu: [d('M4.5 7h15'), d('M4.5 12h15'), d('M4.5 17h15')],
  logout: [d('M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10'), d('M15 8l4 4-4 4'), d('M19 12H9.5')],
  plug: [d('M9 3v5'), d('M15 3v5'), d('M6.5 8h11v3a5.5 5.5 0 0 1-11 0z'), d('M12 16.5V21')],
  sparkle: [d('M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z'), d('M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z')],
  user: [<circle key="c" cx="12" cy="8.5" r="3.5" />, d('M5.5 19.5c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5')],
  globe: [<circle key="c" cx="12" cy="12" r="9" />, d('M3 12h18'), d('M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9S9.4 5.8 12 3z')],
  heart: [d('M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z')],
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
const FILLED = new Set<IconName>(['play']);

export function Icon({ name, size = 20, strokeWidth = 1.75, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const filled = FILLED.has(name);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {ICONS[name]}
    </svg>
  );
}
