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

  test('a hostile target cannot make a finding large: the message and the evidence are bounded', () => {
    const f = makeFinding('payto_invalid', 'm'.repeat(5000), { payTo: 'p'.repeat(1_000_000), list: Array.from({ length: 1000 }, (_, i) => i), nested: { a: { b: { c: { d: { e: { f: 'too deep' } } } } } } });
    expect(f.message.length).toBeLessThanOrEqual(501);
    expect(JSON.stringify(f.evidence).length).toBeLessThan(2000);
    expect(f).toMatchObject({ code: 'payto_invalid', severity: 'error', basis: 'PREDICTED' });
  });

  test('evidence that is already small is kept exactly', () => {
    const e = { payTo: '0x1111111111111111111111111111111111111111', n: 3, ok: true, missingKeys: ['a', 'b.c'] };
    expect(makeFinding('payto_invalid', 'bad', e).evidence).toEqual(e);
  });
});
