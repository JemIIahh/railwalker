'use client';

import { useCallback, useState } from 'react';
import type { CheckReport } from '@railwalker/scanner';

export type ScanState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; report: CheckReport; truncated: boolean };

/** Asks the server to read an endpoint's price tag, free, and keeps what came back: an answer, an error to show, or nothing yet. */
export function useScan(): { state: ScanState; scan: (url: string, method: 'GET' | 'POST', body: string) => Promise<void>; reset: () => void } {
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const scan = useCallback(async (url: string, method: 'GET' | 'POST', body: string) => {
    setState({ phase: 'loading' });
    const query = new URLSearchParams({ url: url.trim(), method, ...(method === 'POST' && body.trim() ? { body } : {}) });
    try {
      const res = await fetch(`/api/scan?${query}`);
      const data = await res.json();
      if (!res.ok) {
        setState({ phase: 'error', message: res.status === 429 ? `Too many checks. Try again in ${data.retryAfterSec} seconds.` : (data.error ?? 'Something went wrong.') });
      } else {
        setState({ phase: 'done', report: data as CheckReport, truncated: data.truncated === true });
      }
    } catch {
      setState({ phase: 'error', message: 'We could not reach the checker. Try again.' });
    }
  }, []);
  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, scan, reset };
}
