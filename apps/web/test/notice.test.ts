import { describe, expect, test } from 'vitest';
import { noticeWords } from '../lib/notice';

describe('noticeWords: what to say instead of a section whose data is not there', () => {
  test('nothing published yet, data that cannot be read, and data that cannot be reached are three different things', () => {
    const empty = noticeWords({ state: 'empty' }, 'ledger');
    const invalid = noticeWords({ state: 'broken', why: 'invalid' }, 'ledger');
    const unavailable = noticeWords({ state: 'broken', why: 'unavailable' }, 'ledger');
    expect(empty).toBe('No ledger has been published yet.');
    expect(invalid).toBe('The published ledger could not be read, so nothing is shown rather than something wrong.');
    expect(unavailable).toBe('The published ledger could not be reached just now. It will show here when it can.');
    expect(new Set([empty, invalid, unavailable]).size).toBe(3);
  });

  test('it says what is missing in the caller’s words', () => {
    expect(noticeWords({ state: 'empty' }, 'reality map')).toContain('reality map');
    expect(noticeWords({ state: 'broken', why: 'invalid' }, 'run')).toContain('published run');
    expect(noticeWords({ state: 'broken', why: 'unavailable' }, 'numbers')).toContain('published numbers');
  });
});
