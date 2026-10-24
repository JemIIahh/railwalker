import { describe, expect, test } from 'vitest';
import { countAt, easeOutCubic, formatCount } from '../lib/count';

describe('easeOutCubic', () => {
  test('starts at 0, ends at 1, never goes backwards, and is fastest at the start', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(0.1)).toBeGreaterThan(0.1);
  });

  test('outside zero to one it is clamped, and a number that is not one is zero', () => {
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(7)).toBe(1);
    expect(easeOutCubic(Number.NaN)).toBe(0);
  });
});

describe('countAt', () => {
  test('counts up to the target and lands on it exactly, whatever the rounding', () => {
    expect(countAt(0, 61)).toBe(0);
    expect(countAt(1, 61)).toBe(61);
    expect(countAt(2, 61)).toBe(61);
    expect(countAt(1, 75.4, 1)).toBe(75.4);
    expect(countAt(1, 0.29, 2)).toBe(0.29);
  });

  test('part way it is the eased share of the target, to the decimals asked for', () => {
    expect(countAt(0.5, 100)).toBe(88); // 87.5 rounds up
    expect(countAt(0.5, 100, 1)).toBe(87.5);
    expect(countAt(0.5, 75.4, 1)).toBe(66);
  });

  test('it lands on the target as it is, even with more decimals than the counter shows on the way', () => {
    expect(countAt(1, 75.43, 1)).toBe(75.43);
    expect(countAt(5, 61.5)).toBe(61.5);
    expect(countAt(0.999, 75.43, 1)).toBe(75.4);
  });

  test('a target that is not a number is zero, and a negative progress is the start', () => {
    expect(countAt(0.5, Number.NaN)).toBe(0);
    expect(countAt(0.5, Number.POSITIVE_INFINITY)).toBe(0);
    expect(countAt(-1, 61)).toBe(0);
  });
});

describe('formatCount', () => {
  test('whole numbers have no decimals, thousands are grouped, and decimals are kept to the digit', () => {
    expect(formatCount(61)).toBe('61');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(75.4, 1)).toBe('75.4');
    expect(formatCount(75, 1)).toBe('75.0');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(75.46, 1)).toBe('75.5');
    expect(formatCount(61.9)).toBe('62');
  });
});
