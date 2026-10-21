import { lookup } from 'node:dns/promises';
import type { ScanDeps } from './types';

export const DEFAULT_USER_AGENT = 'Railwalker/0 (+https://github.com/JemIIahh/railwalker)';
export const DEFAULT_SLOW_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 10_000;
/** A 402 challenge is a few KB; anything near this is not one. */
export const MAX_BODY_BYTES = 256 * 1024;

const OPT_OUT_PATH = '/.well-known/railwalker-optout';
const OPT_OUT_TIMEOUT_MS = 5000;

export class ScanTimeout extends Error {
  constructor() {
    super('scan deadline exceeded');
    this.name = 'ScanTimeout';
  }
}

export interface Deadline {
  signal: AbortSignal;
  /** Settles like `p`, or rejects with ScanTimeout once the deadline passes, even when `p` never settles. */
  race<T>(p: Promise<T>): Promise<T>;
  hasExpired(): boolean;
  clear(): void;
}

/**
 * One deadline for a whole scan. Every await that talks to the outside world is raced against it, because a fetch that ignores
 * its abort signal, or a body stream that never ends, must not be able to hold the scan open.
 */
export function createDeadline(ms: number): Deadline {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new ScanTimeout()); // before abort(): the fetch's own AbortError must not win the race
      controller.abort();
    }, ms);
  });
  timedOut.catch(() => {}); // a deadline nobody is racing at that moment is not an unhandled rejection
  return {
    signal: controller.signal,
    race: (p) => Promise.race([p, timedOut]),
    hasExpired: () => expired,
    clear: () => clearTimeout(timer),
  };
}

/** Stop caring about a response we will not read, so the socket is released. */
export function discard(res: Response): void {
  res.body?.cancel().catch(() => {});
}

export type CappedBody = { ok: true; text: string } | { ok: false };

/** Reads at most `cap` bytes: a declared Content-Length over the cap is refused unread, and a stream that outgrows it is cancelled. */
export async function readCapped(res: Response, cap: number, deadline: Deadline): Promise<CappedBody> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    discard(res);
    return { ok: false };
  }
  if (!res.body) return { ok: true, text: '' };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());
      if (done) return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
      total += value.byteLength;
      if (total > cap) return { ok: false };
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

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
