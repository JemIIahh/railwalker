import { describe, expect, test } from 'vitest';
import { FINDING_ORDER, FINDING_SEVERITY, type Finding, type FindingCode } from '../src/findings';
import { verdictFromFindings } from '../src/verdict';
import type { AssetSymbol } from '../src/assets';

const finding = (code: FindingCode, assetSymbol?: AssetSymbol): Finding => ({
  code,
  severity: FINDING_SEVERITY[code],
  basis: 'PREDICTED',
  message: '',
  evidence: {},
  ...(assetSymbol ? { assetSymbol } : {}),
});

describe('verdictFromFindings', () => {
  test('no findings or info only -> PASS', () => {
    expect(verdictFromFindings({ basis: 'PREDICTED', findings: [] }).kind).toBe('PASS');
    expect(verdictFromFindings({ basis: 'PREDICTED', findings: [finding('v1_challenge'), finding('no_output_schema')] }).kind).toBe('PASS');
  });

  test('a warn -> PASS_WITH_WARNINGS', () => {
    const v = verdictFromFindings({ basis: 'PREDICTED', findings: [finding('v1_challenge'), finding('timeout_too_short')] });
    expect(v.kind).toBe('PASS_WITH_WARNINGS');
    expect(v.code).toBeUndefined();
  });

  test('an error -> FAIL with the highest-priority code per FINDING_ORDER', () => {
    const v = verdictFromFindings({ basis: 'PREDICTED', findings: [finding('permit2_gas_sponsorship_missing'), finding('payto_zero')] });
    expect(v).toMatchObject({ kind: 'FAIL', code: 'payto_zero' });
  });

  test('FINDING_ORDER lists every code exactly once', () => {
    expect(new Set(FINDING_ORDER).size).toBe(FINDING_ORDER.length);
    expect([...FINDING_ORDER].sort()).toEqual(Object.keys(FINDING_SEVERITY).sort());
  });

  test('ambiguous_after_payment -> AMBIGUOUS even next to errors', () => {
    const v = verdictFromFindings({ basis: 'CONFIRMED', findings: [finding('ambiguous_after_payment'), finding('delivered_empty')] });
    expect(v).toMatchObject({ kind: 'AMBIGUOUS', code: 'ambiguous_after_payment', basis: 'CONFIRMED' });
  });

  test('basis and assetSymbol pass through and the findings are kept', () => {
    const f = [finding('eip712_domain_mismatch', 'USDT')];
    const v = verdictFromFindings({ basis: 'CONFIRMED', findings: f, assetSymbol: 'USDT' });
    expect(v).toMatchObject({ kind: 'FAIL', basis: 'CONFIRMED', assetSymbol: 'USDT' });
    expect(v.findings).toEqual(f);
  });
});
