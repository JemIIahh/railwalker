import { describe, expect, test } from 'vitest';
import { timeAgo } from '../lib/time';

const now = new Date('2026-10-22T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  test.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [MIN, '1 min ago'],
    [59 * MIN, '59 min ago'],
    [HOUR, '1 h ago'],
    [23 * HOUR + 59 * MIN, '23 h ago'],
    [DAY, '1 d ago'],
    [6 * DAY, '6 d ago'],
  ])('%d ms ago is “%s”', (ms, text) => {
    expect(timeAgo(ago(ms), now)).toBe(text);
  });

  test('part way between two steps it is the step already passed, not the next', () => {
    expect(timeAgo(ago(90_000), now)).toBe('1 min ago');
    expect(timeAgo(ago(90 * MIN), now)).toBe('1 h ago');
    expect(timeAgo(ago(36 * HOUR), now)).toBe('1 d ago');
  });

  test('the date is the one in UTC, whatever zone the visitor is in', () => {
    const before = process.env.TZ;
    process.env.TZ = 'Asia/Kathmandu'; // UTC+5:45: 23:30 UTC is already tomorrow there
    try {
      expect(new Date('2025-12-31T23:30:00Z').getDate(), 'the zone took effect').toBe(1);
      expect(timeAgo('2025-12-31T23:30:00Z', now)).toBe('31 Dec 2025');
      expect(timeAgo('2026-01-05T23:30:00Z', now)).toBe('5 Jan');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  test('a week or more is the date', () => {
    expect(timeAgo(ago(7 * DAY), now)).toBe('15 Oct');
    expect(timeAgo('2025-01-05T03:00:00.000Z', now)).toBe('5 Jan 2025');
  });

  test('a time in the future is just now, and one that cannot be read is a dash', () => {
    expect(timeAgo(new Date(now.getTime() + 5 * MIN).toISOString(), now)).toBe('just now');
    for (const bad of ['', 'yesterday', 'not a date']) expect(timeAgo(bad, now), bad).toBe('—');
  });
});
