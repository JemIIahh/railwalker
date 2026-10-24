import { describe, expect, test } from 'vitest';
import { statusOf } from '../lib/status';

describe('statusOf: what a verdict is called to someone who is not a developer', () => {
  test.each([
    ['PASS', 'CONFIRMED', 'good', 'Works', 'Paid test', 'Passed a real paid test'],
    ['PASS', 'PREDICTED', 'good', 'Looks ready', 'Quick look', 'No problems found in the quick look'],
    ['PASS_WITH_WARNINGS', 'CONFIRMED', 'warn', 'Works, needs polish', 'Paid test', 'Passed the paid test, with things to improve'],
    ['PASS_WITH_WARNINGS', 'PREDICTED', 'warn', 'Mostly ready', 'Quick look', 'A few things to improve'],
    ['FAIL', 'CONFIRMED', 'bad', 'Broken', 'Paid test', 'Failed a real paid test'],
    ['FAIL', 'PREDICTED', 'bad', 'Will likely break', 'Quick look', 'Problems found in the quick look'],
    ['AMBIGUOUS', 'CONFIRMED', 'unsure', 'Not sure', 'Paid test', 'We paid, but could not tell what came back'],
    ['AMBIGUOUS', 'PREDICTED', 'unsure', 'Not sure', 'Quick look', 'We paid, but could not tell what came back'],
    ['SKIPPED', 'PREDICTED', 'idle', 'Not tested', 'Quick look', 'We did not test this one'],
    ['SKIPPED', 'CONFIRMED', 'idle', 'Not tested', 'Paid test', 'We did not test this one'],
  ] as const)('%s + %s', (kind, basis, tone, word, basisWord, sentence) => {
    expect(statusOf(kind, basis)).toEqual({ tone, word, basisWord, sentence });
  });

  test('a real payment backs the word: only a paid test may say "Works" or "Broken", a quick look says "Looks ready" or "Will likely break"', () => {
    expect(statusOf('PASS', 'PREDICTED').word).not.toBe('Works');
    expect(statusOf('FAIL', 'PREDICTED').word).not.toBe('Broken');
    expect(statusOf('PASS', 'CONFIRMED').word).toBe('Works');
    expect(statusOf('FAIL', 'CONFIRMED').word).toBe('Broken');
  });
});
