import { describe, expect, test } from 'vitest';
import { ASSETS } from '@railwalker/core';
import { MOCK_TX_HASH, mockFacilitator } from '../src';

const PAYER = '0x3333333333333333333333333333333333333333';
const eip3009 = { x402Version: 2, accepted: {}, payload: { authorization: { from: PAYER } } } as never;
const permit2 = { x402Version: 2, accepted: {}, payload: { permit2Authorization: { from: PAYER } } } as never;
const requirements = { scheme: 'exact', network: 'eip155:42220' } as never;

describe('mockFacilitator', () => {
  test('verify accepts and names the payer, for both payload shapes', async () => {
    const f = mockFacilitator();
    expect(await f.verify(eip3009, requirements)).toEqual({ isValid: true, payer: PAYER });
    expect(await f.verify(permit2, requirements)).toEqual({ isValid: true, payer: PAYER });
    expect(f.verifyCalls).toBe(2);
  });

  test('failVerify rejects with a reason', async () => {
    expect(await mockFacilitator({ failVerify: true }).verify(eip3009, requirements)).toMatchObject({ isValid: false, invalidReason: 'mock_verify_failure' });
  });

  test('settle succeeds with the default transaction hash and echoes the network', async () => {
    const f = mockFacilitator();
    expect(await f.settle(eip3009, requirements)).toEqual({ success: true, payer: PAYER, transaction: MOCK_TX_HASH, network: 'eip155:42220' });
    expect(f.settleCalls).toBe(1);
  });

  test('failSettle reports the failure, and txHash is overridable', async () => {
    expect(await mockFacilitator({ failSettle: true }).settle(eip3009, requirements)).toMatchObject({ success: false, errorReason: 'mock_settle_failure' });
    const txHash = `0x${'cd'.repeat(32)}` as const;
    expect(await mockFacilitator({ txHash }).settle(eip3009, requirements)).toMatchObject({ transaction: txHash });
  });

  test('settleDelayMs delays settlement, and only settlement', async () => {
    const f = mockFacilitator({ settleDelayMs: 40 });
    const t0 = Date.now();
    await f.verify(eip3009, requirements);
    expect(Date.now() - t0).toBeLessThan(30);
    await f.settle(eip3009, requirements);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  test('getSupported lists the ten assets of the facilitator table and the gas-sponsorship extension', async () => {
    const supported = await mockFacilitator().getSupported();
    const kind = supported.kinds[0]!;
    expect(kind).toMatchObject({ scheme: 'exact', network: 'eip155:42220' });
    const assets = (kind.extra as { supportedAssets: { symbol: string; asset: string }[] }).supportedAssets;
    expect(assets.map((a) => a.symbol)).toEqual(Object.keys(ASSETS));
    expect(assets[0]!.asset).toBe(ASSETS.USDC.address);
    expect(supported.extensions).toContain('eip2612GasSponsoring');
  });
});
