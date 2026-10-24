'use client';

import { useEffect, useState } from 'react';
import { formatWhen } from '../lib/view-models';
import { timeAgo } from '../lib/time';

/** How long ago, in words. It is the plain date until the page is in the browser, so the server and the browser never disagree. */
export function TimeAgo({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(timeAgo(iso, new Date())), [iso]);
  return <time dateTime={iso} title={formatWhen(iso)} suppressHydrationWarning>{text ?? formatWhen(iso).split(',')[0]}</time>;
}
