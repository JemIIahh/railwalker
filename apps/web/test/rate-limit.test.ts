import { describe, expect, test } from 'vitest';
import { tokenBucket } from '../lib/rate-limit';

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms), set: (ms: number) => void (t = ms) };
};
/** The production setting: ten requests, refilling ten a minute. */
const tenPerMinute = (c: ReturnType<typeof clock>, extra: { maxKeys?: number } = {}) => tokenBucket({ capacity: 10, refillPerSec: 10 / 60, now: c.now, ...extra });

describe('tokenBucket', () => {
  test('starts full: ten requests pass and the eleventh is refused with the seconds to wait', () => {
    const b = tenPerMinute(clock());
    for (let i = 0; i < 10; i++) expect(b.take('1.2.3.4')).toEqual({ ok: true, retryAfterSec: 0 });
    expect(b.take('1.2.3.4')).toEqual({ ok: false, retryAfterSec: 6 });
  });

  test('refills with time: a token is back after six seconds, and not before', () => {
    const c = clock();
    const b = tenPerMinute(c);
    for (let i = 0; i < 10; i++) b.take('ip');
    c.advance(5_000);
    expect(b.take('ip')).toEqual({ ok: false, retryAfterSec: 1 });
    c.advance(1_000);
    expect(b.take('ip')).toEqual({ ok: true, retryAfterSec: 0 });
    expect(b.take('ip')).toMatchObject({ ok: false });
  });

  test('a refused request costs nothing: asking again does not push the wait out', () => {
    const b = tenPerMinute(clock());
    for (let i = 0; i < 10; i++) b.take('ip');
    for (let i = 0; i < 50; i++) expect(b.take('ip')).toEqual({ ok: false, retryAfterSec: 6 });
  });

  test('never holds more than its capacity, however long it sits idle', () => {
    const c = clock();
    const b = tenPerMinute(c);
    b.take('ip');
    c.advance(3_600_000);
    for (let i = 0; i < 10; i++) expect(b.take('ip').ok).toBe(true);
    expect(b.take('ip').ok).toBe(false);
  });

  test('every key has its own allowance', () => {
    const b = tenPerMinute(clock());
    for (let i = 0; i < 10; i++) b.take('a');
    expect(b.take('a').ok).toBe(false);
    expect(b.take('b').ok).toBe(true);
  });

  test('a clock that steps backwards mints no tokens, now or when it comes back', () => {
    const c = clock(5_000_000);
    const b = tenPerMinute(c);
    for (let i = 0; i < 10; i++) b.take('ip');
    c.set(1_000_000);
    expect(b.take('ip').ok).toBe(false);
    c.set(5_001_000); // the clock is right again, one real second after the bucket emptied
    expect(b.take('ip').ok).toBe(false);
  });

  test('the wait is never zero for a refused request, even when tokens refill almost instantly', () => {
    const c = clock();
    const b = tokenBucket({ capacity: 1, refillPerSec: 1_000_000, now: c.now });
    expect(b.take('ip').ok).toBe(true);
    c.advance(0.0009995); // 0.9995 of a token
    const r = b.take('ip');
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(1);
  });

  test('the wait is always a whole number of seconds, at least one', () => {
    const c = clock();
    const b = tokenBucket({ capacity: 1, refillPerSec: 1 / 7, now: c.now });
    b.take('ip');
    c.advance(100);
    const r = b.take('ip');
    expect(r.ok).toBe(false);
    expect(Number.isInteger(r.retryAfterSec)).toBe(true);
    expect(r.retryAfterSec).toBe(7);
  });

  describe('memory is bounded', () => {
    test('tracks at most maxKeys keys, however many callers there are', () => {
      const b = tenPerMinute(clock(), { maxKeys: 100 });
      for (let i = 0; i < 5_000; i++) b.take(`ip-${i}`);
      expect(b.size()).toBeLessThanOrEqual(100);
    });

    test('the least recently used key is the one forgotten, so an active caller keeps its allowance', () => {
      const b = tokenBucket({ capacity: 1, refillPerSec: 0.001, now: clock().now, maxKeys: 2 });
      expect(b.take('a').ok).toBe(true);
      expect(b.take('a').ok).toBe(false);
      expect(b.take('b').ok).toBe(true);
      expect(b.take('a').ok).toBe(false); // a is touched again: now b is the older one
      expect(b.take('c').ok).toBe(true); // evicts b
      expect(b.take('a').ok).toBe(false); // a was kept, still empty
      expect(b.take('b').ok).toBe(true); // b was forgotten, so it starts full again
    });
  });

  test.each([
    ['a capacity of zero', { capacity: 0, refillPerSec: 1 }],
    ['a negative capacity', { capacity: -1, refillPerSec: 1 }],
    ['a non-finite capacity', { capacity: Infinity, refillPerSec: 1 }],
    ['a refill of zero', { capacity: 1, refillPerSec: 0 }],
    ['a NaN refill', { capacity: 1, refillPerSec: NaN }],
    ['no room for any key', { capacity: 1, refillPerSec: 1, maxKeys: 0 }],
  ] as const)('%s is refused at construction', (_name, opts) => {
    expect(() => tokenBucket({ now: () => 0, ...opts })).toThrow(RangeError);
  });
});
