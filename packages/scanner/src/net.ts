import { lookup } from 'node:dns/promises';
import { RAILWALKER_USER_AGENT, discard } from '@railwalker/core';
import type { ScanDeps } from './types';

export const DEFAULT_USER_AGENT = RAILWALKER_USER_AGENT;
export const DEFAULT_SLOW_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 10_000;
/** A 402 challenge is a few KB; anything near this is not one. */
export const MAX_BODY_BYTES = 256 * 1024;

const OPT_OUT_PATH = '/.well-known/railwalker-optout';
const OPT_OUT_TIMEOUT_MS = 5000;

function optOutLookup(d: Pick<ScanDeps, 'fetchImpl' | 'userAgent'>): ScanDeps['isOptedOut'] {
  return async (host) => {
    try {
      const res = await d.fetchImpl(`https://${host}${OPT_OUT_PATH}`, {
        redirect: 'manual',
        headers: { 'user-agent': d.userAgent },
        signal: AbortSignal.timeout(OPT_OUT_TIMEOUT_MS),
      });
      discard(res);
      // Only a plain-text 200 counts: a catch-all app answers every path with 200 text/html.
      return res.status === 200 && (res.headers.get('content-type') ?? '').toLowerCase().startsWith('text/plain');
    } catch {
      return false; // can't tell, so scan: the scan's own request fails the same way if the host is down
    }
  };
}

export function defaultScanDeps(over: Partial<ScanDeps> = {}): ScanDeps {
  const deps: ScanDeps = {
    fetchImpl: (input, init) => fetch(input, init),
    resolveHost: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
    isOptedOut: async () => false,
    now: () => new Date(),
    userAgent: DEFAULT_USER_AGENT,
    slowMs: DEFAULT_SLOW_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...over,
  };
  // The default lookup goes through whichever fetch and User-Agent the caller settled on.
  return over.isOptedOut ? deps : { ...deps, isOptedOut: optOutLookup(deps) };
}
