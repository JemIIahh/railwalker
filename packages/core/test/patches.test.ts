import { describe, expect, test } from 'vitest';
import { ASSETS, type AssetSymbol } from '../src/assets';
import { FINDING_SEVERITY, type Finding, type FindingCode } from '../src/findings';
import { patchFor } from '../src/patches';

const finding = (code: FindingCode, assetSymbol?: AssetSymbol): Finding => ({
  code,
  severity: FINDING_SEVERITY[code],
  basis: 'PREDICTED',
  message: '',
  evidence: {},
  ...(assetSymbol ? { assetSymbol } : {}),
});

describe('patchFor', () => {
  test('patches carry the exact fix', () => {
    expect(patchFor(finding('permit2_gas_sponsorship_missing'))!.after).toContain('eip2612GasSponsoring');
    expect(patchFor(finding('permit2_method_missing', 'wARS'))!.after).toContain('assetTransferMethod: "permit2"');
    expect(patchFor(finding('eip712_domain_mismatch', 'USDT'))!.after).toContain('Tether USD');
    expect(patchFor(finding('no_output_schema'))).toBeNull();
  });

  test('a confirmed permit2_allowance_required carries the sponsorship patch: it is that missing extension, seen at runtime', () => {
    const p = patchFor(finding('permit2_allowance_required', 'wARS'))!;
    expect(p.code).toBe('permit2_allowance_required');
    expect(p.after).toContain('eip2612GasSponsoring');
  });

  test('the fee-adapter patch names the token address, not the adapter', () => {
    const p = patchFor(finding('asset_is_fee_adapter', 'USDT'))!;
    expect(p.after).toContain(ASSETS.USDT.address);
    expect(p.after).not.toContain(ASSETS.USDT.feeAdapter!);
  });

  test('payto, network, timeout and cors patches', () => {
    expect(patchFor(finding('payto_zero'))!.after).toContain('getAddress(process.env.SELLER_PAY_TO!)');
    expect(patchFor(finding('payto_invalid'))!.after).toContain('getAddress(process.env.SELLER_PAY_TO!)');
    expect(patchFor(finding('no_mainnet_accept'))!.after).toContain('eip155:42220');
    expect(patchFor(finding('timeout_too_short'))!.after).toContain('maxTimeoutSeconds: 300');
    expect(patchFor(finding('cors_missing'))!.after).toContain('payment-required');
    expect(patchFor(finding('cors_header_not_exposed'))!.after).toContain('exposeHeaders');
  });

  test('decimals patch states the decimals of the asset', () => {
    expect(patchFor(finding('decimals_mismatch', 'wARS'))!.after).toContain('18 decimals');
    expect(patchFor(finding('decimals_mismatch', 'USDC'))!.after).toContain('6 decimals');
  });

  test('every patch has a title and a reason', () => {
    const patchable: FindingCode[] = ['permit2_method_missing', 'permit2_gas_sponsorship_missing', 'eip712_domain_mismatch', 'asset_is_fee_adapter', 'decimals_mismatch', 'payto_zero', 'payto_invalid', 'no_mainnet_accept', 'timeout_too_short', 'cors_missing', 'cors_header_not_exposed', 'zero_amount'];
    for (const code of patchable) {
      const p = patchFor(finding(code, code === 'decimals_mismatch' || code === 'eip712_domain_mismatch' || code === 'permit2_method_missing' || code === 'asset_is_fee_adapter' ? 'USDC' : undefined));
      expect(p, code).not.toBeNull();
      expect(p!.title.length, code).toBeGreaterThan(3);
      expect(p!.why.length, code).toBeGreaterThan(10);
      expect(p!.code).toBe(code);
    }
  });

  test('findings without a template have no patch', () => {
    for (const code of ['v1_challenge', 'testnet_entry_present', 'paid_not_delivered', 'ambiguous_after_payment'] as FindingCode[]) {
      expect(patchFor(finding(code)), code).toBeNull();
    }
  });
});
