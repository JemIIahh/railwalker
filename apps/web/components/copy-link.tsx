'use client';

import { CopyButton } from './copy-button';
import { useEffect, useState } from 'react';

/** Copies the address of the page it is on, so a replay can be sent to someone. */
export function CopyLink() {
  const [href, setHref] = useState('');
  useEffect(() => setHref(window.location.href), []);
  return href ? <CopyButton text={href} label="Copy link" /> : null;
}
