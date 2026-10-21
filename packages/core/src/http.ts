/** Every request Railwalker makes identifies itself, so a seller can find who is knocking and how to opt out. */
export const RAILWALKER_USER_AGENT = 'Railwalker/0 (+https://github.com/JemIIahh/railwalker)';

export class DeadlineExceeded extends Error {
  constructor() {
    super('deadline exceeded');
    this.name = 'DeadlineExceeded';
  }
}

export interface Deadline {
  signal: AbortSignal;
  /** Settles like `p`, or rejects with DeadlineExceeded once the deadline passes, even when `p` never settles. */
  race<T>(p: Promise<T>): Promise<T>;
  hasExpired(): boolean;
  clear(): void;
}

/**
 * One deadline for a whole operation. Every await that talks to the outside world is raced against it, because a fetch that
 * ignores its abort signal, or a body stream that never ends, must not be able to hold the operation open.
 */
export function createDeadline(ms: number): Deadline {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new DeadlineExceeded()); // before abort(): the fetch's own AbortError must not win the race
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

export type CappedBody = { ok: true; text: string; truncated: boolean } | { ok: false };

/**
 * Reads at most `cap` bytes of a hostile body. With 'refuse' a body that outgrows the cap (declared or streamed) is `{ ok: false }`;
 * with 'truncate' the first `cap` bytes are kept and `truncated` says the rest was dropped. Either way the stream is cancelled.
 */
export async function readCapped(res: Response, cap: number, deadline: Deadline, overflow: 'refuse' | 'truncate'): Promise<CappedBody> {
  if (overflow === 'refuse') {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > cap) {
      discard(res);
      return { ok: false };
    }
  }
  if (!res.body) return { ok: true, text: '', truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await deadline.race(reader.read());
      if (done) return { ok: true, text: Buffer.concat(chunks).toString('utf8'), truncated: false };
      if (total + value.byteLength > cap) {
        if (overflow === 'refuse') return { ok: false };
        chunks.push(value.subarray(0, cap - total));
        return { ok: true, text: Buffer.concat(chunks).toString('utf8'), truncated: true };
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
