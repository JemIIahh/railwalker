'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/proof', label: 'Proof' },
  { href: '/how', label: 'How it works' },
];

/** The navigation on a phone: a button, and a small list under it. It closes when you go somewhere or tap elsewhere. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className="mobile-menu" ref={box}>
      <button type="button" className="icon-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'x' : 'menu'} size={20} />
      </button>
      {open ? (
        <nav className="menu" aria-label="Main">
          <div className="menu-actions">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
