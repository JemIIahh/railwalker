'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** A link in the main navigation, marked as the current page when it is. */
export function NavLink({ href, children, also = [] }: { href: string; children: ReactNode; also?: string[] }) {
  const path = usePathname();
  const current = path === href || path.startsWith(`${href}/`) || also.some((a) => path === a || path.startsWith(`${a}/`));
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
