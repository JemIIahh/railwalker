import { describe, expect, test } from 'vitest';
import { FINDING_ORDER, INDEPENDENCE_REASONS, SKIP_REASONS, STAGES } from '@railwalker/core';
import { FINDING_LABELS, FINDING_PLAIN, REASON_LABELS, REASON_SHORT, SKIP_LABELS, SKIP_SHORT, STAGE_LABELS, VERDICT_LABELS, VERDICT_SHORT, codeLabel, shortLabel } from '../lib/labels';

describe('labels: nothing a visitor sees is left as an identifier', () => {
  test('every finding has a label in words', () => {
    for (const code of FINDING_ORDER) {
      expect(FINDING_LABELS[code], code).toBeTruthy();
      expect(FINDING_LABELS[code], code).not.toMatch(/_/);
      expect(FINDING_LABELS[code]!.length, code).toBeLessThanOrEqual(80);
    }
    expect(Object.keys(FINDING_LABELS).sort()).toEqual([...FINDING_ORDER].sort());
  });

  test('every reason a payment or a scan was refused has a label in words', () => {
    for (const reason of SKIP_REASONS) {
      expect(SKIP_LABELS[reason], reason).toBeTruthy();
      expect(SKIP_LABELS[reason], reason).not.toMatch(/_/);
    }
    expect(Object.keys(SKIP_LABELS).sort()).toEqual([...SKIP_REASONS].sort());
  });

  test('every verdict kind and every independence reason has a label in words', () => {
    expect(Object.keys(VERDICT_LABELS).sort()).toEqual(['AMBIGUOUS', 'FAIL', 'PASS', 'PASS_WITH_WARNINGS', 'SKIPPED']);
    for (const text of Object.values(VERDICT_LABELS)) expect(text).toBeTruthy();
    expect(Object.keys(REASON_LABELS).sort()).toEqual([...INDEPENDENCE_REASONS].sort());
    for (const reason of INDEPENDENCE_REASONS) expect(REASON_LABELS[reason], reason).not.toMatch(/_/);
  });

  test('a verdict kind’s words add something to the kind itself, and no two are alike', () => {
    for (const [kind, words] of Object.entries(VERDICT_LABELS)) {
      expect(words.toLowerCase(), kind).not.toBe(kind.toLowerCase().replace(/_/g, ' '));
      expect(words.length, kind).toBeGreaterThanOrEqual(8);
    }
    expect(new Set(Object.values(VERDICT_LABELS)).size).toBe(5);
    expect(VERDICT_LABELS.PASS).toBe('Works: nothing wrong found');
    expect(VERDICT_LABELS.FAIL).toBe('Broken: a buyer would hit a problem');
  });

  test('every kind of run has a label, and the two a visitor can see say whose endpoint it was', () => {
    expect(Object.keys(STAGE_LABELS).sort()).toEqual([...STAGES].sort());
    expect(STAGE_LABELS.fixture).toBe('Our own test seller');
    expect(STAGE_LABELS.buy).toBe('A real service we pay');
    for (const stage of STAGES) expect(STAGE_LABELS[stage], stage).not.toMatch(/_/);
  });

  test('codeLabel gives the finding’s words, else the refusal’s words, else the code read as words', () => {
    expect(codeLabel('cors_missing')).toBe(FINDING_LABELS.cors_missing);
    expect(codeLabel('over_event_cap')).toBe(SKIP_LABELS.over_event_cap);
    expect(codeLabel('some_future_code')).toBe('some future code');
    expect(codeLabel('')).toBe('');
  });

  test('no label is shared by two findings: they would be indistinguishable on a bar chart', () => {
    const labels = Object.values(FINDING_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('plain titles: what went wrong, in words a person would use, never a sentence and never an identifier', () => {
  test('every finding and every refusal has one, short, with no identifier left in it, and no two findings share one', () => {
    for (const code of FINDING_ORDER) {
      expect(FINDING_PLAIN[code], code).toBeTruthy();
      expect(FINDING_PLAIN[code].length, code).toBeLessThanOrEqual(32);
      expect(FINDING_PLAIN[code], code).not.toMatch(/_|\b402\b|CORS|x402|EIP|Permit2/i);
    }
    expect(Object.keys(FINDING_PLAIN).sort()).toEqual([...FINDING_ORDER].sort());
    expect(new Set(Object.values(FINDING_PLAIN)).size).toBe(FINDING_ORDER.length);
    for (const reason of SKIP_REASONS) {
      expect(SKIP_SHORT[reason], reason).toBeTruthy();
      expect(SKIP_SHORT[reason].length, reason).toBeLessThanOrEqual(18);
    }
    expect(Object.keys(SKIP_SHORT).sort()).toEqual([...SKIP_REASONS].sort());
  });

  test('a plain title is shorter than the sentence it stands for', () => {
    for (const code of FINDING_ORDER) expect(FINDING_PLAIN[code].length, code).toBeLessThanOrEqual(FINDING_LABELS[code].length + 6);
  });

  test('every verdict kind has one word', () => {
    expect(VERDICT_SHORT).toEqual({ PASS: 'Pass', PASS_WITH_WARNINGS: 'Warn', FAIL: 'Fail', AMBIGUOUS: 'Unsure', SKIPPED: 'Skip' });
  });

  test('shortLabel gives the finding’s plain title, else the refusal’s, else the code read as words', () => {
    expect(shortLabel('cors_missing')).toBe('Hidden from web apps');
    expect(shortLabel('delivered_empty')).toBe('Empty answer');
    expect(shortLabel('over_event_cap')).toBe(SKIP_SHORT.over_event_cap);
    expect(shortLabel('some_future_code')).toBe('some future code');
  });
});

describe('short reasons for a payer', () => {
  test('each independence reason has a few words, none an identifier, and no two the same', () => {
    expect(Object.keys(REASON_SHORT).sort()).toEqual([...INDEPENDENCE_REASONS].sort());
    for (const reason of INDEPENDENCE_REASONS) {
      expect(REASON_SHORT[reason], reason).toBeTruthy();
      expect(REASON_SHORT[reason].length, reason).toBeLessThanOrEqual(16);
      expect(REASON_SHORT[reason], reason).not.toMatch(/_/);
      expect(REASON_SHORT[reason].length, reason).toBeLessThan(REASON_LABELS[reason].length);
    }
    expect(new Set(Object.values(REASON_SHORT)).size).toBe(INDEPENDENCE_REASONS.length);
    expect(REASON_SHORT.counted).toBe('Counts');
  });
});
