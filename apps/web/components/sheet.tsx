'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

/**
 * A panel that slides in over the page it was opened from. Escape, the scrim and the close button all go back; focus stays inside
 * while it is open and returns to what opened it; the page behind does not scroll. Opening the full page is an ordinary link.
 */
export function Sheet({ children, label }: { children: ReactNode; label: string }) {
  const router = useRouter();
  const path = usePathname();
  const panel = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab' || panel.current === null) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [close]);

  return (
    <div className="sheet-root">
      <div className="sheet-scrim" onClick={close} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={panel}>
        <div className="sheet-bar">
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
          <a className="btn btn-ghost btn-sm" href={path}>
            Open full page <Icon name="arrowUpRight" size={14} />
          </a>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
