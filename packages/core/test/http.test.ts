import { describe, expect, test } from 'vitest';
import { DeadlineExceeded, createDeadline, discard, readCapped } from '../src/http';

const bytes = (n: number, fill = 65) => new Uint8Array(n).fill(fill);

/** A stream that hands out `total` bytes in `chunk`-sized pieces, one per read (highWaterMark 0), counting what was pulled. */
function counting(total: number, chunk: number, counter: { read: number }): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= total) return controller.close();
        const n = Math.min(chunk, total - sent);
        controller.enqueue(bytes(n));
        sent += n;
        counter.read += n;
      },
    },
    { highWaterMark: 0 },
  );
}

const hangingStream = () => new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }, { highWaterMark: 0 });

describe('createDeadline', () => {
  test('race settles like the promise while the deadline has not passed', async () => {
    const d = createDeadline(1000);
    expect(await d.race(Promise.resolve(7))).toBe(7);
    await expect(d.race(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(d.hasExpired()).toBe(false);
    d.clear();
  });

  test('race rejects with DeadlineExceeded when the promise never settles, and aborts the signal', async () => {
    const d = createDeadline(30);
    await expect(d.race(new Promise(() => {}))).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(d.hasExpired()).toBe(true);
    expect(d.signal.aborted).toBe(true);
  });

  test('the deadline wins even when the aborted work rejects first: the caller always sees DeadlineExceeded', async () => {
    const d = createDeadline(20);
    const work = new Promise((_, reject) => d.signal.addEventListener('abort', () => reject(new Error('AbortError'))));
    await expect(d.race(work)).rejects.toBeInstanceOf(DeadlineExceeded);
  });

  test('clear stops the timer, so a finished scan never aborts later', async () => {
    const d = createDeadline(20);
    d.clear();
    await new Promise((r) => setTimeout(r, 60));
    expect(d.signal.aborted).toBe(false);
    expect(d.hasExpired()).toBe(false);
  });

  test('a deadline nobody is racing is not an unhandled rejection', async () => {
    const d = createDeadline(10);
    await new Promise((r) => setTimeout(r, 40));
    expect(d.hasExpired()).toBe(true); // reaching here without vitest reporting an unhandled rejection is the assertion
  });
});

describe('readCapped (refuse)', () => {
  test('a small body is returned whole and not truncated', async () => {
    const d = createDeadline(1000);
    expect(await readCapped(new Response('{"a":1}'), 1024, d, 'refuse')).toEqual({ ok: true, text: '{"a":1}', truncated: false });
    d.clear();
  });

  test('an empty body is an empty string', async () => {
    const d = createDeadline(1000);
    expect(await readCapped(new Response(null, { status: 204 }), 1024, d, 'refuse')).toEqual({ ok: true, text: '', truncated: false });
    d.clear();
  });

  test('a body that outgrows the cap is refused after at most one chunk past it', async () => {
    const counter = { read: 0 };
    const d = createDeadline(1000);
    const r = await readCapped(new Response(counting(5 * 1024 * 1024, 64 * 1024, counter)), 256 * 1024, d, 'refuse');
    expect(r).toEqual({ ok: false });
    expect(counter.read).toBeLessThanOrEqual(256 * 1024 + 64 * 1024);
    d.clear();
  });

  test('a declared Content-Length over the cap is refused without reading anything', async () => {
    const counter = { read: 0 };
    const d = createDeadline(1000);
    const res = new Response(counting(5 * 1024 * 1024, 64 * 1024, counter), { headers: { 'content-length': String(5 * 1024 * 1024) } });
    expect(await readCapped(res, 256 * 1024, d, 'refuse')).toEqual({ ok: false });
    expect(counter.read).toBe(0);
    d.clear();
  });

  test('a never-ending stream ends at the deadline with DeadlineExceeded', async () => {
    const d = createDeadline(40);
    await expect(readCapped(new Response(hangingStream()), 1024, d, 'refuse')).rejects.toBeInstanceOf(DeadlineExceeded);
  });

  test('a stream that errors mid-body rejects with that error', async () => {
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(bytes(10));
          else controller.error(new TypeError('terminated'));
        },
      },
      { highWaterMark: 0 },
    );
    const d = createDeadline(1000);
    await expect(readCapped(new Response(broken), 1024, d, 'refuse')).rejects.toThrow('terminated');
    d.clear();
  });
});

describe('readCapped (truncate)', () => {
  test('keeps exactly the first cap bytes and says so', async () => {
    const d = createDeadline(1000);
    const r = await readCapped(new Response('a'.repeat(100)), 40, d, 'truncate');
    expect(r).toEqual({ ok: true, text: 'a'.repeat(40), truncated: true });
    d.clear();
  });

  test('a body exactly at the cap is not truncated', async () => {
    const d = createDeadline(1000);
    expect(await readCapped(new Response('b'.repeat(40)), 40, d, 'truncate')).toEqual({ ok: true, text: 'b'.repeat(40), truncated: false });
    d.clear();
  });

  test('a huge declared Content-Length does not stop it reading the head, and the rest is never pulled', async () => {
    const counter = { read: 0 };
    const d = createDeadline(1000);
    const res = new Response(counting(5 * 1024 * 1024, 64 * 1024, counter), { headers: { 'content-length': String(5 * 1024 * 1024) } });
    const r = await readCapped(res, 100, d, 'truncate');
    expect(r).toMatchObject({ ok: true, truncated: true });
    expect((r as { text: string }).text).toHaveLength(100);
    expect(counter.read).toBeLessThanOrEqual(64 * 1024);
    d.clear();
  });

  test('a never-ending stream still ends at the deadline', async () => {
    const d = createDeadline(40);
    await expect(readCapped(new Response(hangingStream()), 1024, d, 'truncate')).rejects.toBeInstanceOf(DeadlineExceeded);
  });
});

describe('discard', () => {
  test('cancels an unread body and never throws, even without a body', async () => {
    const counter = { read: 0 };
    const res = new Response(counting(1000, 100, counter));
    discard(res);
    discard(new Response(null));
    await new Promise((r) => setTimeout(r, 10));
    expect(counter.read).toBe(0);
  });
});
