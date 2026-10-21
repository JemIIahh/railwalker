import { describe, expect, test } from 'vitest';
import { buyV1Challenge, makeAccept, makeChallenge, v2MultiAssetChallenge } from '@railwalker/testkit';
import { parseChallenge } from '../src/challenge';
import { runLints } from '../src/lints';
import { verdictFromFindings } from '../src/verdict';
import type { Severity } from '../src/findings';

const parse = (json: unknown) => {
  const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify(json) });
  if (!r.ok) throw new Error(r.detail);
  return r.challenge;
};
const codes = (c: ReturnType<typeof makeChallenge>, ctx?: Parameters<typeof runLints>[1]) => runLints(c, ctx).map((f) => f.code);

describe('runLints on real challenges', () => {
  test('no false positives on real challenges', () => {
    const f = runLints(parse(buyV1Challenge));
    expect(f.filter((x) => x.severity !== 'info')).toEqual([]);
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(['v1_challenge', 'testnet_entry_present', 'no_output_schema']));
  });

  test('sandbox entry mixed with mainnet is info only, never FAIL', () => {
    expect(verdictFromFindings({ basis: 'PREDICTED', findings: runLints(parse(buyV1Challenge)) }).kind).toBe('PASS');
  });

  test('a clean v2 multi-asset challenge has nothing above info', () => {
    const f = runLints(parse(v2MultiAssetChallenge));
    expect(f.filter((x) => x.severity !== 'info')).toEqual([]);
    expect(f.map((x) => x.code)).not.toContain('v1_challenge');
  });
});

describe('runLints per accept', () => {
  test.each<[string, ReturnType<typeof makeAccept>, Severity]>([
    ['permit2_method_missing', makeAccept('wARS', { extra: { name: 'Peso Argentino', version: '1' } }), 'error'],
    ['asset_is_fee_adapter', makeAccept('USDT', { asset: '0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72' }), 'error'],
    ['decimals_mismatch', makeAccept('USDC', { amountAtomic: '1000000000000000000' }), 'warn'],
    ['decimals_mismatch', makeAccept('wARS', { amountAtomic: '1000000' }), 'warn'],
    ['eip712_domain_mismatch', makeAccept('USDT', { extra: { name: 'USDT', version: '1' } }), 'error'],
    ['eip712_domain_mismatch', makeAccept('USDC', { extra: { name: 'USDC', version: 2 } }), 'error'],
    ['payto_zero', makeAccept('USDC', { payTo: '0x0000000000000000000000000000000000000000' }), 'error'],
    ['payto_invalid', makeAccept('USDC', { payTo: 'not-an-address' }), 'error'],
    ['zero_amount', makeAccept('USDC', { amountAtomic: '0' }), 'error'],
    ['zero_amount', makeAccept('USDC', { amountAtomic: '' }), 'error'],
    ['timeout_too_short', makeAccept('USDC', { maxTimeoutSeconds: 10 }), 'warn'],
    ['price_above_default_buyer_cap', makeAccept('USDC', { amountAtomic: '2000000' }), 'info'],
    ['asset_unknown', makeAccept('USDC', { asset: '0x1234567890123456789012345678901234567890', assetInfo: null }), 'info'],
  ])('%s (%#)', (code, accept, severity) => {
    const findings = runLints(makeChallenge({ accepts: [accept] }));
    const hit = findings.find((f) => f.code === code);
    expect(hit, `expected ${code} among ${findings.map((f) => f.code).join(',')}`).toBeDefined();
    expect(hit).toMatchObject({ severity, basis: 'PREDICTED' });
  });

  test('a price of exactly $1 is not above the default buyer cap', () => {
    expect(codes(makeChallenge({ accepts: [makeAccept('USDC', { amountAtomic: '1000000' })] }))).not.toContain('price_above_default_buyer_cap');
  });

  test('payTo checksum: a mixed-case address with a wrong checksum is invalid, all-lowercase is fine', () => {
    const good = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B';
    const bad = good.replace('faA', 'FaA');
    expect(codes(makeChallenge({ accepts: [makeAccept('USDC', { payTo: bad })] }))).toContain('payto_invalid');
    expect(codes(makeChallenge({ accepts: [makeAccept('USDC', { payTo: good })] }))).not.toContain('payto_invalid');
    expect(codes(makeChallenge({ accepts: [makeAccept('USDC', { payTo: good.toLowerCase() })] }))).not.toContain('payto_invalid');
  });

  test('permit2 route without eip2612GasSponsoring is an error; with it, none; cNGN gets cngn_needs_one_time_approve (info)', () => {
    const without = runLints(makeChallenge({ accepts: [makeAccept('wARS')] }));
    expect(without).toContainEqual(expect.objectContaining({ code: 'permit2_gas_sponsorship_missing', severity: 'error', assetSymbol: 'wARS' }));

    const withExt = codes(makeChallenge({ accepts: [makeAccept('wARS')], extensions: { eip2612GasSponsoring: { info: {} } } }));
    expect(withExt).not.toContain('permit2_gas_sponsorship_missing');

    const cngn = runLints(makeChallenge({ accepts: [makeAccept('cNGN')] }));
    expect(cngn.map((f) => f.code)).not.toContain('permit2_gas_sponsorship_missing');
    expect(cngn.find((f) => f.code === 'cngn_needs_one_time_approve')?.severity).toBe('info');
  });

  test('payto differing from ctx.agentWallet -> payto_agent_wallet_mismatch (warn); same wallet or no ctx -> none', () => {
    const c = makeChallenge({ accepts: [makeAccept('USDC', { payTo: '0x1111111111111111111111111111111111111111' })] });
    const hit = runLints(c, { agentWallet: '0x2222222222222222222222222222222222222222' }).find((f) => f.code === 'payto_agent_wallet_mismatch');
    expect(hit?.severity).toBe('warn');
    expect(codes(c, { agentWallet: '0x1111111111111111111111111111111111111111' })).not.toContain('payto_agent_wallet_mismatch');
    expect(codes(c)).not.toContain('payto_agent_wallet_mismatch');
  });
});

describe('runLints per challenge', () => {
  test('only testnet accepts -> no_mainnet_accept error; only base accepts -> no_mainnet_accept error plus wrong_network info', () => {
    const testnetOnly = makeChallenge({ accepts: [makeAccept('USDC', { network: 'eip155:11142220', chainId: 11142220 })] });
    expect(runLints(testnetOnly)).toContainEqual(expect.objectContaining({ code: 'no_mainnet_accept', severity: 'error' }));

    const baseOnly = makeChallenge({ accepts: [makeAccept('USDC', { network: 'eip155:8453', chainId: null })] });
    const got = runLints(baseOnly).map((x) => `${x.code}:${x.severity}`);
    expect(got).toEqual(expect.arrayContaining(['no_mainnet_accept:error', 'wrong_network:info']));
  });

  test('sandbox accepts are not linted as if they were production', () => {
    const c = makeChallenge({
      accepts: [makeAccept('USDC'), makeAccept('USDC', { network: 'eip155:11142220', chainId: 11142220, payTo: '0x0000000000000000000000000000000000000000' })],
    });
    expect(codes(c)).toContain('testnet_entry_present');
    expect(codes(c)).not.toContain('payto_zero');
  });

  test('no accepts at all -> no_accepts error', () => {
    const f = runLints(makeChallenge({ accepts: [] }));
    expect(f).toContainEqual(expect.objectContaining({ code: 'no_accepts', severity: 'error' }));
  });

  test('every finding is PREDICTED and carries evidence', () => {
    const f = runLints(makeChallenge({ accepts: [makeAccept('wARS', { extra: {} })] }));
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) {
      expect(x.basis).toBe('PREDICTED');
      expect(typeof x.message).toBe('string');
      expect(typeof x.evidence).toBe('object');
    }
  });
});
