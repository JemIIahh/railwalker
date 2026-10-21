import { describe, expect, test } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { isAddress } from 'viem';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { ASSETS, DEFAULT_POLICY, FINDING_ORDER, SpendLedger, emptySpendState, type AssetSymbol } from '@railwalker/core';
import { MOCK_TX_HASH, appFetch, mockFacilitator } from '@railwalker/testkit';
import { payEndpoint } from '@railwalker/chain';
import { confirmEndpoint, scanEndpoint } from '@railwalker/scanner';
import { Hono } from 'hono';
import { DEFAULT_SLOW_MS, FIXTURE_EXPECTATIONS, createFixtureApp, type FixtureDeps } from '../src';

const BASE = 'https://fixtures.example';
const PAY_TO = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B' as const;
const SEPOLIA_USDC = '0x01C5C0122039549AD1493B8220cABEdD739BC44E';
const account = privateKeyToAccount(`0x${'33'.repeat(32)}`);
const publicClient = { readContract: async () => 0n } as never;

const routes = Object.keys(FIXTURE_EXPECTATIONS);
const BAD = routes.filter((r) => r.startsWith('/bad/'));
const PAID = routes.filter((r) => r.startsWith('/paid/'));

function world(over: Partial<FixtureDeps> = {}) {
  const facilitator = mockFacilitator();
  const app = createFixtureApp({ facilitator, payTo: PAY_TO, network: 'eip155:42220', ...over });
  const fetchImpl = appFetch(app);
  const scan = (route: string) =>
    scanEndpoint({ fetchImpl, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 'test' }, { url: `${BASE}${route}`, method: 'GET' });
  const confirm = async (route: string, assets: AssetSymbol[] = ['USAT'], tooSlowMs?: number) => {
    const report = await scan(route);
    return confirmEndpoint(
      {
        pay: (req) => payEndpoint({ account, publicClient, fetchImpl }, req),
        verifyTransfer: async () => ({ ok: true }),
        ledger: new SpendLedger(DEFAULT_POLICY, emptySpendState()),
        payer: account.address,
        sellerKey: 'fixtures.example',
        balanceUsd: async () => 1,
        now: () => new Date(),
        tooSlowMs,
      },
      report,
      { stage: 'fixture', assets, facts: { url: `${BASE}${route}`, method: 'GET', source: 'fixture' }, optedOut: false },
    );
  };
  const get = (route: string, headers: Record<string, string> = {}) => fetchImpl(`${BASE}${route}`, { headers });
  return { facilitator, app, fetchImpl, scan, confirm, get };
}

const challengeOf = async (res: Response) => decodePaymentRequiredHeader(res.headers.get('payment-required')!);
const severe = (r: { findings: { severity: string }[] }) => r.findings.filter((f) => f.severity !== 'info');

describe('FIXTURE_EXPECTATIONS', () => {
  test('is exactly the twelve routes the plan names, each with a real finding code', () => {
    expect(FIXTURE_EXPECTATIONS).toEqual({
      '/bad/permit2-method': 'permit2_method_missing',
      '/bad/permit2-sponsorship': 'permit2_gas_sponsorship_missing',
      '/bad/adapter-asset': 'asset_is_fee_adapter',
      '/bad/decimals': 'decimals_mismatch',
      '/bad/domain-name': 'eip712_domain_mismatch',
      '/bad/payto-zero': 'payto_zero',
      '/bad/testnet-only': 'no_mainnet_accept',
      '/bad/no-cors': 'cors_missing',
      '/paid/500': 'paid_not_delivered',
      '/paid/empty': 'delivered_empty',
      '/paid/bad-json': 'delivered_invalid_json',
      '/paid/slow': 'too_slow',
    });
    for (const code of Object.values(FIXTURE_EXPECTATIONS)) expect(FINDING_ORDER).toContain(code);
  });

  test.each(Object.entries(FIXTURE_EXPECTATIONS))('%s says which finding it is built to trigger (x-fixture-expect: %s)', async (route, code) => {
    const res = await world().get(route);
    expect(res.status).toBe(402);
    expect(res.headers.get('x-fixture-expect')).toBe(code);
  });

  test('the correct seller makes no such claim', async () => {
    expect((await world().get('/ok')).headers.get('x-fixture-expect')).toBeNull();
  });
});

describe('/ok: the correct seller', () => {
  test('scans clean: nothing above info, with the real scanner', async () => {
    const r = await world().scan('/ok');
    expect(r.status).toBe(402);
    expect(severe(r)).toEqual([]);
    expect(r.verdicts.map((v) => [v.assetSymbol, v.kind, v.basis])).toEqual([
      ['USDC', 'PASS', 'PREDICTED'],
      ['USDT', 'PASS', 'PREDICTED'],
      ['USAT', 'PASS', 'PREDICTED'],
    ]);
  });

  test('advertises USDC, USDT and USAT at 5000 on the configured network, to the configured payee', async () => {
    const c = await challengeOf(await world().get('/ok'));
    expect(c.accepts.map((a) => [a.asset, a.amount, a.network, a.payTo])).toEqual(
      (['USDC', 'USDT', 'USAT'] as const).map((s) => [ASSETS[s].address, '5000', 'eip155:42220', PAY_TO]),
    );
  });

  test('its 402 is readable from a browser: CORS allows any origin and exposes payment-required', async () => {
    const res = await world().get('/ok', { origin: 'https://some.app' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect((res.headers.get('access-control-expose-headers') ?? '').toLowerCase()).toContain('payment-required');
  });

  test.each(['USDC', 'USDT', 'USAT'] as const)('confirms PASS CONFIRMED in %s with the real buyer and the mock facilitator', async (asset) => {
    const w = world();
    const { report, run } = await w.confirm('/ok', [asset]);
    expect(report.verdicts.find((v) => v.assetSymbol === asset)).toMatchObject({ kind: 'PASS', basis: 'CONFIRMED' });
    expect(run.payments).toEqual([expect.objectContaining({ symbol: asset, txHash: MOCK_TX_HASH, amountAtomic: '5000', payTo: PAY_TO })]);
    expect(w.facilitator).toMatchObject({ verifyCalls: 1, settleCalls: 1 });
  });

  test('anything else is a 404, not a challenge', async () => {
    expect((await world().get('/nope')).status).toBe(404);
  });
});

describe('/bad/*: static 402s with no payment path', () => {
  test.each(BAD.map((r) => [r, FIXTURE_EXPECTATIONS[r]!] as const))('scan %s triggers %s', async (route, code) => {
    const r = await world().scan(route);
    expect(r.status).toBe(402);
    expect(r.findings.map((f) => f.code)).toContain(code);
  });

  test('each route is broken in exactly the one way it names: that finding leads the verdict', async () => {
    const w = world();
    for (const route of BAD) {
      const r = await w.scan(route);
      const expected = FIXTURE_EXPECTATIONS[route]!;
      const errors = r.findings.filter((f) => f.severity === 'error').map((f) => f.code);
      if (['decimals_mismatch', 'cors_missing'].includes(expected)) expect(errors, route).toEqual([]); // warnings only
      else expect(errors[0], route).toBe(expected);
    }
  });

  test('the sandbox-only route lists a Celo Sepolia accept and no mainnet one', async () => {
    const c = await challengeOf(await world().get('/bad/testnet-only'));
    expect(c.accepts.map((a) => a.network)).toEqual(['eip155:11142220']);
  });

  test('the fee-adapter route advertises the 18-decimal ADAPTER as the asset', async () => {
    const c = await challengeOf(await world().get('/bad/adapter-asset'));
    expect(c.accepts[0]!.asset).toBe(ASSETS.USDC.feeAdapter);
  });

  test('only the no-cors route is unreadable from a browser', async () => {
    const w = world();
    expect((await w.get('/bad/no-cors', { origin: 'https://x.app' })).headers.get('access-control-allow-origin')).toBeNull();
    for (const route of routes.filter((r) => r !== '/bad/no-cors')) {
      expect((await w.get(route, { origin: 'https://x.app' })).headers.get('access-control-allow-origin'), route).toBe('*');
    }
  });

  test('/bad/* routes never accept a payment header: always 402, and the facilitator is never asked', async () => {
    const w = world();
    const payment = Buffer.from(JSON.stringify({ x402Version: 2, accepted: {}, payload: {} })).toString('base64');
    for (const route of BAD) {
      const attempts: Record<string, string>[] = [{ 'payment-signature': payment }, { 'x-payment': payment }, { 'payment-signature': 'garbage' }];
      for (const header of attempts) {
        expect((await w.get(route, header)).status, route).toBe(402);
      }
    }
    expect(w.facilitator).toMatchObject({ verifyCalls: 0, settleCalls: 0 });
  });

  test('a real buyer that tries to pay a /bad route is refused, and nothing settles', async () => {
    const w = world();
    const r = await w.confirm('/bad/no-cors');
    expect(w.facilitator.settleCalls).toBe(0);
    expect(r.report.verdicts.find((v) => v.assetSymbol === 'USAT')!.kind).not.toBe('PASS');
  });
});

describe('/paid/*: they take the payment, then misbehave', () => {
  test.each(PAID)('%s scans clean: the broken part only shows after a real payment', async (route) => {
    expect(severe(await world().scan(route))).toEqual([]);
  });

  test.each([
    ['/paid/500', 'paid_not_delivered', 500],
    ['/paid/empty', 'delivered_empty', 200],
    ['/paid/bad-json', 'delivered_invalid_json', 200],
  ] as const)('%s -> %s (CONFIRMED), after a payment that really settled', async (route, code, status) => {
    const w = world();
    const { report, run } = await w.confirm(route);
    const v = report.verdicts.find((x) => x.assetSymbol === 'USAT')!;
    expect(v).toMatchObject({ kind: 'FAIL', code, basis: 'CONFIRMED' });
    expect(run.payments).toEqual([expect.objectContaining({ txHash: MOCK_TX_HASH })]);
    expect(w.facilitator).toMatchObject({ verifyCalls: 1, settleCalls: 1 });
    expect(run.steps.find((s) => s.stage === 'deliver')).toMatchObject({ ok: false, detail: { status } });
  });

  test('/paid/slow -> too_slow (tooSlowMs lowered), and the delay is the one configured', async () => {
    const w = world({ slowMs: 120 });
    const { report } = await w.confirm('/paid/slow', ['USAT'], 60);
    const v = report.verdicts.find((x) => x.assetSymbol === 'USAT')!;
    expect(v).toMatchObject({ kind: 'PASS_WITH_WARNINGS', basis: 'CONFIRMED' });
    expect(v.findings.map((f) => f.code)).toContain('too_slow');
  });

  test('the default delay is 20 seconds', () => {
    expect(DEFAULT_SLOW_MS).toBe(20_000);
  });

  test('the receipt comes back even from a route that then fails: the buyer must see that the money moved', async () => {
    const w = world();
    const o = await payEndpoint({ account, publicClient, fetchImpl: w.fetchImpl }, { url: `${BASE}/paid/500`, method: 'GET', asset: 'USAT', maxAtomic: '5000', timeoutMs: 5000 });
    expect(o).toMatchObject({ paid: true, status: 500, settlement: { txHash: MOCK_TX_HASH } });
    expect(decodePaymentResponseHeader(o.headers['payment-response']!)).toMatchObject({ success: true, transaction: MOCK_TX_HASH });
    expect(o.headers['x-fixture-expect']).toBe('paid_not_delivered');
  });

  test('the order is verify, then settle, and the facilitator is shown the option that was paid', async () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    const base = mockFacilitator();
    const facilitator = {
      verify: async (...a: Parameters<typeof base.verify>) => {
        order.push('verify');
        seen.push(a[1]);
        return base.verify(...a);
      },
      settle: async (...a: Parameters<typeof base.settle>) => {
        order.push('settle');
        return base.settle(...a);
      },
      getSupported: () => base.getSupported(),
    };
    const w = world({ facilitator });
    await payEndpoint({ account, publicClient, fetchImpl: w.fetchImpl }, { url: `${BASE}/paid/empty`, method: 'GET', asset: 'USDT', maxAtomic: '5000', timeoutMs: 5000 });
    expect(order).toEqual(['verify', 'settle']);
    expect(seen).toEqual([expect.objectContaining({ asset: ASSETS.USDT.address, network: 'eip155:42220', amount: '5000', payTo: PAY_TO })]);
  });

  test('a payment the facilitator will not verify is a 402 and is never settled', async () => {
    const facilitator = mockFacilitator({ failVerify: true });
    const w = world({ facilitator });
    const o = await payEndpoint({ account, publicClient, fetchImpl: w.fetchImpl }, { url: `${BASE}/paid/500`, method: 'GET', asset: 'USAT', maxAtomic: '5000', timeoutMs: 5000 });
    expect(o).toMatchObject({ paid: false, status: 402, failure: { code: 'facilitator_error' } });
    expect(facilitator).toMatchObject({ verifyCalls: 1, settleCalls: 0 });
  });

  test('a payment the facilitator cannot settle is reported as a settlement failure, not delivered', async () => {
    const facilitator = mockFacilitator({ failSettle: true });
    const w = world({ facilitator });
    const o = await payEndpoint({ account, publicClient, fetchImpl: w.fetchImpl }, { url: `${BASE}/paid/empty`, method: 'GET', asset: 'USAT', maxAtomic: '5000', timeoutMs: 5000 });
    expect(o).toMatchObject({ paid: false, status: 402, failure: { code: 'settle_failed' } });
  });

  test.each(['verify', 'settle'] as const)('a facilitator that throws in %s is a 402 from the seller, not a crash', async (stage) => {
    const base = mockFacilitator();
    const facilitator = {
      verify: async (...a: Parameters<typeof base.verify>) => {
        if (stage === 'verify') throw new Error('facilitator down');
        return base.verify(...a);
      },
      settle: async (...a: Parameters<typeof base.settle>) => {
        if (stage === 'settle') throw new Error('facilitator down');
        return base.settle(...a);
      },
      getSupported: () => base.getSupported(),
    };
    const w = world({ facilitator });
    const o = await payEndpoint({ account, publicClient, fetchImpl: w.fetchImpl }, { url: `${BASE}/paid/500`, method: 'GET', asset: 'USAT', maxAtomic: '5000', timeoutMs: 5000 });
    expect(o).toMatchObject({ paid: false, status: 402, failure: { code: 'facilitator_error' } });
    expect(o.failure!.detail).toContain('unavailable');
  });

  test('a payment header that is not a payment is a 402, and the facilitator is never asked', async () => {
    const w = world();
    expect((await w.get('/paid/500', { 'payment-signature': 'garbage' })).status).toBe(402);
    expect(w.facilitator).toMatchObject({ verifyCalls: 0, settleCalls: 0 });
  });

  test('a payment that names an asset the route does not accept is a 402 too', async () => {
    const w = world();
    const wrong = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { asset: ASSETS.wARS.address, network: 'eip155:42220' }, payload: {} })).toString('base64');
    expect((await w.get('/paid/500', { 'payment-signature': wrong })).status).toBe(402);
    expect(w.facilitator.verifyCalls).toBe(0);
  });
});

describe('network', () => {
  test('on Sepolia the correct seller advertises the sandbox USDC on eip155:11142220', async () => {
    const c = await challengeOf(await world({ network: 'eip155:11142220' }).get('/ok'));
    expect(c.accepts.map((a) => [a.network, a.asset, a.amount])).toEqual([['eip155:11142220', SEPOLIA_USDC, '5000']]);
  });

  test('a facilitator that does not support the network leaves /ok at 502, never a process exit, and the other routes keep answering', async () => {
    const none = { ...mockFacilitator(), getSupported: async () => ({ kinds: [], extensions: [], signers: {} }) };
    const w = world({ facilitator: none as never });
    expect((await w.get('/ok')).status).toBe(502);
    expect((await w.get('/bad/no-cors')).status).toBe(402);
    expect((await w.get('/paid/500')).status).toBe(402);
  });

  test('a startup failure is not cached: once the facilitator can be reached, /ok works', async () => {
    const base = mockFacilitator();
    let calls = 0;
    const flaky = {
      verify: base.verify,
      settle: base.settle,
      getSupported: async () => {
        if (calls++ === 0) throw new Error('facilitator down');
        return base.getSupported();
      },
    };
    const w = world({ facilitator: flaky });
    expect((await w.get('/ok')).status).toBe(502);
    const second = await w.get('/ok');
    expect(second.status).toBe(402);
    expect((await challengeOf(second)).accepts).toHaveLength(3);
  });

  test('the payee is validated: a fixture that would burn payments is refused at construction', () => {
    expect(isAddress(PAY_TO, { strict: true })).toBe(true);
    expect(() => createFixtureApp({ facilitator: mockFacilitator(), payTo: '0x0000000000000000000000000000000000000000', network: 'eip155:42220' })).toThrow(/payTo/);
    expect(() => createFixtureApp({ facilitator: mockFacilitator(), payTo: '0x123' as never, network: 'eip155:42220' })).toThrow(/payTo/);
  });
});

describe('mounted under a base path (how the web app serves them)', () => {
  const MOUNT = '/api/fixtures';
  function mounted(over: Partial<FixtureDeps> = {}) {
    const facilitator = mockFacilitator();
    const app = new Hono().basePath(MOUNT).route('/', createFixtureApp({ facilitator, payTo: PAY_TO, network: 'eip155:42220', ...over }));
    const fetchImpl = appFetch(app);
    const scan = (route: string) =>
      scanEndpoint({ fetchImpl, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 'test' }, { url: `${BASE}${MOUNT}${route}`, method: 'GET' });
    return { facilitator, fetchImpl, scan, get: (route: string, headers: Record<string, string> = {}) => fetchImpl(`${BASE}${MOUNT}${route}`, { headers }) };
  }

  test('the correct seller is still a correct seller: a clean scan and a real 402 challenge', async () => {
    const m = mounted();
    const res = await m.get('/ok');
    expect(res.status).toBe(402);
    expect((await challengeOf(res)).accepts).toHaveLength(3);
    expect(severe(await m.scan('/ok'))).toEqual([]);
  });

  test('every route still triggers the finding it is built for, and says so', async () => {
    const m = mounted();
    for (const route of BAD) {
      expect((await m.get(route)).headers.get('x-fixture-expect'), route).toBe(FIXTURE_EXPECTATIONS[route]);
      expect((await m.scan(route)).findings.map((f) => f.code), route).toContain(FIXTURE_EXPECTATIONS[route]);
    }
  });

  test('only the no-cors route is unreadable from a browser, wherever the app is mounted', async () => {
    const m = mounted();
    expect((await m.get('/bad/no-cors', { origin: 'https://x.app' })).headers.get('access-control-allow-origin')).toBeNull();
    for (const route of ['/ok', '/bad/decimals', '/paid/500']) {
      expect((await m.get(route, { origin: 'https://x.app' })).headers.get('access-control-allow-origin'), route).toBe('*');
    }
  });

  test('a real payment still goes through a mounted paid route', async () => {
    const m = mounted();
    const o = await payEndpoint({ account, publicClient, fetchImpl: m.fetchImpl }, { url: `${BASE}${MOUNT}/paid/empty`, method: 'GET', asset: 'USAT', maxAtomic: '5000', timeoutMs: 5000 });
    expect(o).toMatchObject({ paid: true, status: 200, bodyText: '', settlement: { txHash: MOCK_TX_HASH } });
    expect(m.facilitator).toMatchObject({ verifyCalls: 1, settleCalls: 1 });
  });

  test('and the correct seller takes a real payment too', async () => {
    const m = mounted();
    const o = await payEndpoint({ account, publicClient, fetchImpl: m.fetchImpl }, { url: `${BASE}${MOUNT}/ok`, method: 'GET', asset: 'USDC', maxAtomic: '5000', timeoutMs: 5000 });
    expect(o).toMatchObject({ paid: true, status: 200 });
    expect(JSON.parse(o.bodyText)).toEqual({ ok: true });
  });
});
