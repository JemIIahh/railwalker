import { describe, expect, test } from 'vitest';
import { noticeWords } from '../lib/notice';

describe('noticeWords agrees with what it names', () => {
  test('a plural thing has been, a single thing has', () => {
    expect(noticeWords({ state: 'empty' }, 'test results')).toBe('No test results have been published yet.');
    expect(noticeWords({ state: 'empty' }, 'ledger')).toBe('No ledger has been published yet.');
  });
});
