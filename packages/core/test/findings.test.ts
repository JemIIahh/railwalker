import { describe, expect, test } from 'vitest';
import { FINDING_SEVERITY, makeFinding } from '../src/findings';

describe('makeFinding', () => {
  test('takes severity from the table and defaults to a PREDICTED basis', () => {
    const f = makeFinding('payto_zero', 'payTo is the zero address');
    expect(f).toEqual({ code: 'payto_zero', severity: FINDING_SEVERITY.payto_zero, basis: 'PREDICTED', message: 'payTo is the zero address', evidence: {} });
  });

  test('carries evidence, an asset symbol and an explicit basis', () => {
    const f = makeFinding('paid_not_delivered', 'HTTP 500 after payment', { status: 500 }, { assetSymbol: 'USAT', basis: 'CONFIRMED' });
    expect(f).toMatchObject({ code: 'paid_not_delivered', severity: 'error', basis: 'CONFIRMED', assetSymbol: 'USAT', evidence: { status: 500 } });
  });

  test('omits assetSymbol entirely when there is none', () => {
    expect('assetSymbol' in makeFinding('v1_challenge', 'legacy')).toBe(false);
  });
});
