import { beforeEach, describe, expect, test } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { ASSETS, FINDING_ORDER, UnsafeUrlError } from '@railwalker/core';
import { buyV1Challenge, fakeFetch } from '@railwalker/testkit';
import { mockFacilitator } from '@railwalker/testkit';
import { PAY_FAILURE_CODES, loadConfig, makeClients, payEndpoint, type PayerDeps, type PayRequest } from '../src';
import { fakeCeloRpc } from './fake-rpc';
import { MOCK_TX_HASH, SELLER_PAY_TO, SELLER_URL, manualSeller, paymentOf, realSeller, settlementHeaderFor } from './sellers';

const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);
let reads: string[] = [];
/** allowance 0, nonce 0: the wallet has never approved Permit2. */
const publicClient = {
  readContract: async (a: { functionName: string }) => {
    reads.push(a.functionName);
    return 0n;
  },
} as never;
beforeEach(() => {
  reads = [];
});

const payer = (fetchImpl: typeof fetch): PayerDeps => ({ account, publicClient, fetchImpl });
const request = (over: Partial<PayRequest> = {}): PayRequest => ({ url: SELLER_URL, method: 'GET', asset: 'USAT', maxAtomic: '50000', timeoutMs: 5000, ...over });

const V2_USAT = { scheme: 'exact', network: 'eip155:42220', amount: '5000', asset: ASSETS.USAT.address, payTo: SELLER_PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'Tether America USD', version: '1' } };
const V2_USDC = { ...V2_USAT, asset: ASSETS.USDC.address, extra: { name: 'USDC', version: '2' } };
const SANDBOX_USDC = { ...V2_USDC, network: 'eip155:11142220', asset: '0x01C5C0122039549AD1493B8220cABEdD739BC44E' };

describe('payEndpoint: v2 seller on the real @x402/hono middleware', () => {
  const prices = { USDC: '5000', USDT: '5000', USAT: '5000' } as const;

  test('pays in the requested asset and captures the settlement', async () => {
    const s = realSeller({ prices });
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: true, status: 200, truncated: false, settlement: { txHash: MOCK_TX_HASH, payer: account.address, network: 'eip155:42220' } });
    expect(o.failure).toBeUndefined();
    expect(JSON.parse(o.bodyText)).toEqual({ ok: true });
    expect(o.headers['payment-response']).toBeTruthy();
    expect(o.latencyMs).toBeGreaterThanOrEqual(0);
    expect(s.paidCalls()).toHaveLength(1);
    expect(paymentOf(s.paidCalls()[0]!).accepted).toMatchObject({ network: 'eip155:42220', asset: ASSETS.USAT.address, amount: '5000' });
    expect(s.facilitator).toMatchObject({ verifyCalls: 1, settleCalls: 1 });
  });

  test.each(['USDC', 'USDT', 'USAT'] as const)('pays %s when asked for it, and only that', async (asset) => {
    const s = realSeller({ prices });
    const o = await payEndpoint(payer(s.fetch), request({ asset }));
    expect(o.paid).toBe(true);
    expect(paymentOf(s.paidCalls()[0]!).accepted.asset).toBe(ASSETS[asset].address);
  });

  test('a price above maxAtomic is refused before any payment header is sent', async () => {
    const s = realSeller({ prices: { USAT: '60000' } });
    const o = await payEndpoint(payer(s.fetch), request({ maxAtomic: '50000' }));
    expect(o).toMatchObject({ paid: false, status: 402, failure: { code: 'no_matching_accept' } });
    expect(o.failure!.detail).toMatch(/spendControls/);
    expect(s.fetch.calls).toHaveLength(1);
    expect(s.paidCalls()).toHaveLength(0);
    expect(s.facilitator.verifyCalls).toBe(0);
  });

  test('an asset the seller does not offer is no_matching_accept, with nothing paid', async () => {
    const s = realSeller({ prices: { USDC: '5000' } });
    const o = await payEndpoint(payer(s.fetch), request({ asset: 'USAT' }));
    expect(o).toMatchObject({ paid: false, failure: { code: 'no_matching_accept' } });
    expect(s.paidCalls()).toHaveLength(0);
  });

  test('a POST carries its JSON body on both the probe and the paid request', async () => {
    const s = realSeller({ prices: { USAT: '5000' } });
    const o = await payEndpoint(payer(s.fetch), request({ method: 'POST', body: { q: 'test' } }));
    expect(o.paid).toBe(true);
    expect(s.fetch.calls.map((c) => [c.method, c.body])).toEqual([['POST', '{"q":"test"}'], ['POST', '{"q":"test"}']]);
    expect(s.fetch.calls[1]!.headers['content-type']).toBe('application/json');
  });

  test('a method other than GET or POST is sent as GET: a payer never sends a side-effect verb', async () => {
    const s = realSeller({ prices: { USAT: '5000' } });
    await payEndpoint(payer(s.fetch), request({ method: 'DELETE' as 'GET' }));
    expect(s.fetch.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  test('a body over maxBodyBytes is truncated and flagged', async () => {
    const s = realSeller({ prices: { USAT: '5000' }, body: 'x'.repeat(1000) });
    const o = await payEndpoint(payer(s.fetch), request({ maxBodyBytes: 100 }));
    expect(o).toMatchObject({ paid: true, truncated: true });
    expect(o.bodyText).toHaveLength(100);
  });

  test('a Permit2 asset with the sponsorship extension builds its payload from the stubbed allowance and nonce', async () => {
    const s = realSeller({ prices: { wARS: '1000000000000000000' }, extensions: { eip2612GasSponsoring: { info: { description: 'sponsor', version: '1' } } } });
    const o = await payEndpoint(payer(s.fetch), request({ asset: 'wARS', maxAtomic: '2000000000000000000' }));
    expect(o).toMatchObject({ paid: true, status: 200 });
    const p = paymentOf(s.paidCalls()[0]!);
    expect(p.accepted.asset).toBe(ASSETS.wARS.address);
    expect(p.payload.permit2Authorization).toBeTruthy();
    expect(p.extensions.eip2612GasSponsoring.info.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(reads).toEqual(['allowance', 'nonces']);
  });

  test('a Permit2 asset is refused when its price is above the cap, like any other', async () => {
    const s = realSeller({ prices: { wARS: '3000000000000000000' } });
    const o = await payEndpoint(payer(s.fetch), request({ asset: 'wARS', maxAtomic: '2000000000000000000' }));
    expect(o.failure?.code).toBe('no_matching_accept');
    expect(s.paidCalls()).toHaveLength(0);
  });
});

describe('payEndpoint: v1 seller', () => {
  test.each(['USDC', 'USDT', 'USAT'] as const)('pays a v1 seller (network "celo", maxAmountRequired) in %s with the v1 client', async (asset) => {
    const s = manualSeller({ version: 1, accepts: buyV1Challenge.accepts });
    const o = await payEndpoint(payer(s.fetch), request({ asset }));
    expect(o).toMatchObject({ paid: true, status: 200, settlement: { txHash: MOCK_TX_HASH, network: 'celo' } });
    expect(o.headers['x-payment-response']).toBeTruthy();
    expect(paymentOf(s.paidCalls()[0]!)).toMatchObject({ x402Version: 1, network: 'celo' });
  });

  test.each(['USDC', 'USDT', 'USAT'] as const)('a v1 price above maxAtomic is refused in %s before any payment header is sent', async (asset) => {
    const s = manualSeller({ version: 1, accepts: buyV1Challenge.accepts });
    const o = await payEndpoint(payer(s.fetch), request({ asset, maxAtomic: '4999' }));
    expect(o).toMatchObject({ paid: false, failure: { code: 'no_matching_accept' } });
    expect(s.paidCalls()).toHaveLength(0);
  });
});

describe('payEndpoint: never pays the sandbox entry (Review Focus 3)', () => {
  const sandbox = buyV1Challenge.accepts.find((a) => a.network === 'celo-sepolia')!;
  const mainnet = buyV1Challenge.accepts.filter((a) => a.network === 'celo');

  test('v1: the celo-sepolia accept is listed first, and the payment still names celo', async () => {
    const s = manualSeller({ version: 1, accepts: [sandbox, ...mainnet] });
    const o = await payEndpoint(payer(s.fetch), request({ asset: 'USDC' }));
    expect(o.paid).toBe(true);
    expect(paymentOf(s.paidCalls()[0]!).network).toBe('celo');
  });

  test('v1: a sandbox accept that reuses the MAINNET asset address is still never chosen', async () => {
    const disguised = { ...sandbox, asset: ASSETS.USDC.address };
    const s = manualSeller({ version: 1, accepts: [disguised, ...mainnet] });
    await payEndpoint(payer(s.fetch), request({ asset: 'USDC' }));
    expect(paymentOf(s.paidCalls()[0]!).network).toBe('celo');
  });

  test('v2: the eip155:11142220 accept is listed first, and the payment still names eip155:42220', async () => {
    const s = manualSeller({ version: 2, accepts: [SANDBOX_USDC, V2_USDC] });
    const o = await payEndpoint(payer(s.fetch), request({ asset: 'USDC' }));
    expect(o.paid).toBe(true);
    expect(paymentOf(s.paidCalls()[0]!).accepted).toMatchObject({ network: 'eip155:42220', asset: ASSETS.USDC.address });
  });

  test('a challenge with only the sandbox entry is no_matching_accept and nothing is paid', async () => {
    for (const s of [manualSeller({ version: 1, accepts: [sandbox] }), manualSeller({ version: 2, accepts: [SANDBOX_USDC] })]) {
      const o = await payEndpoint(payer(s.fetch), request({ asset: 'USDC' }));
      expect(o).toMatchObject({ paid: false, failure: { code: 'no_matching_accept' } });
      expect(s.paidCalls()).toHaveLength(0);
    }
  });

  test('a payTo that is the zero address is never paid', async () => {
    const s = manualSeller({ version: 2, accepts: [{ ...V2_USAT, payTo: '0x0000000000000000000000000000000000000000' }] });
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: false, failure: { code: 'no_matching_accept' } });
    expect(s.paidCalls()).toHaveLength(0);
  });

  test('a payTo that is not an address is never paid', async () => {
    const s = manualSeller({ version: 2, accepts: [{ ...V2_USAT, payTo: 'not-an-address' }] });
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: false, failure: { code: 'no_matching_accept' } });
    expect(s.paidCalls()).toHaveLength(0);
  });
});

describe('payEndpoint: what a failed payment is called', () => {
  const seller = (onPaid: Parameters<typeof manualSeller>[0]['onPaid']) => manualSeller({ version: 2, accepts: [V2_USAT], onPaid });
  const json = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const receipt = (over: Record<string, unknown>) => settlementHeaderFor(2, { success: true, payer: account.address, transaction: MOCK_TX_HASH, network: 'eip155:42220', ...over });

  test.each([
    ['412 permit2_allowance_required', () => json({ error: 'permit2_allowance_required' }, 412), 412, 'permit2_allowance_required'],
    ['402 insufficient_credits', () => json({ error: 'insufficient_credits' }, 402), 402, 'insufficient_credits'],
    ['402 the facilitator rejected the signature', () => json({}, 402, { 'payment-required': encodePaymentRequiredHeader({ x402Version: 2, error: 'invalid_exact_evm_payload_signature', accepts: [V2_USAT] } as never) }), 402, 'facilitator_error'],
    ['400 bad request', () => json({ error: 'bad request' }, 400), 400, 'facilitator_error'],
    ['a settlement receipt that says failure', () => json({}, 402, receipt({ success: false, errorReason: 'insufficient_funds', transaction: '' })), 402, 'settle_failed'],
    ['a nonce collision', () => json({}, 402, receipt({ success: false, errorReason: 'nonce too low', transaction: '' })), 402, 'nonce_race'],
    ['500 with no receipt', () => json({ error: 'boom' }, 500), 500, 'ambiguous_after_payment'],
    ['200 with no receipt', () => json({ ok: true }, 200), 200, 'ambiguous_after_payment'],
    ['200 with a receipt whose hash is malformed', () => json({ ok: true }, 200, receipt({ transaction: '0x1234' })), 200, 'ambiguous_after_payment'],
    ['200 with a receipt that has no success flag', () => json({ ok: true }, 200, receipt({ success: undefined })), 200, 'ambiguous_after_payment'],
    ['200 with an unreadable receipt', () => json({ ok: true }, 200, { 'payment-response': 'not base64 json!!' }), 200, 'ambiguous_after_payment'],
    ['a redirect after payment (never followed)', () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } }), 302, 'ambiguous_after_payment'],
  ] as const)('%s', async (_name, answer, status, code) => {
    const s = seller(async () => answer());
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: false, status, failure: { code } });
    expect(s.paidCalls()).toHaveLength(1);
  });

  test('a real middleware whose facilitator fails to settle is settle_failed, with the reason', async () => {
    const s = realSeller({ prices: { USAT: '5000' }, facilitator: mockFacilitator({ failSettle: true }) });
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: false, status: 402, failure: { code: 'settle_failed' } });
    expect(o.failure!.detail).toContain('mock_settle_failure');
  });

  test('a receipt without a network falls back to the network the payment itself named', async () => {
    const s = seller(async () => json({ ok: true }, 200, receipt({ network: undefined })));
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: true, settlement: { txHash: MOCK_TX_HASH, network: 'eip155:42220' } });
  });

  test('a settled payment followed by a 500 is paid: the seller took the money, delivery is the prober’s question', async () => {
    const s = seller(async () => json({ error: 'handler crashed' }, 500, receipt({})));
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: true, status: 500, settlement: { txHash: MOCK_TX_HASH } });
    expect(o.failure).toBeUndefined();
  });
});

describe('payEndpoint: a payment is sent at most once (Review Focus 4)', () => {
  test('payment sent, response never arrives -> ambiguous_after_payment, and exactly one paid request', async () => {
    const s = realSeller({ prices: { USAT: '5000' }, facilitator: mockFacilitator({ settleDelayMs: 400 }) });
    const o = await payEndpoint(payer(s.fetch), request({ timeoutMs: 80 }));
    expect(o).toMatchObject({ paid: false, status: null, failure: { code: 'ambiguous_after_payment' } });
    expect(s.paidCalls()).toHaveLength(1);
    expect(s.facilitator.verifyCalls).toBe(1);
  });

  test('a paid response whose body never ends is ambiguous too, but keeps the receipt it did get', async () => {
    const hang = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }, { highWaterMark: 0 });
    const s = manualSeller({
      version: 2,
      accepts: [V2_USAT],
      onPaid: async ({ settle }) => new Response(hang, { status: 200, headers: settlementHeaderFor(2, await settle()) }),
    });
    const o = await payEndpoint(payer(s.fetch), request({ timeoutMs: 80 }));
    expect(o).toMatchObject({ paid: true, status: 200, settlement: { txHash: MOCK_TX_HASH }, failure: { code: 'ambiguous_after_payment' } });
    expect(s.paidCalls()).toHaveLength(1);
  });

  test('a seller that answers every request with a fresh challenge gets exactly one payment', async () => {
    const challenge = () => new Response('{}', { status: 402, headers: { 'payment-required': encodePaymentRequiredHeader({ x402Version: 2, error: 'pay again', accepts: [V2_USAT] } as never) } });
    const s = manualSeller({ version: 2, accepts: [V2_USAT], onPaid: async () => challenge() });
    const o = await payEndpoint(payer(s.fetch), request());
    expect(o).toMatchObject({ paid: false, status: 402, failure: { code: 'facilitator_error' } });
    expect(s.paidCalls()).toHaveLength(1);
    expect(s.fetch.calls).toHaveLength(2);
  });

  test('a deadline that expires while the payload is still being built never leads to a late payment', async () => {
    const slow = {
      readContract: async () => {
        await new Promise((r) => setTimeout(r, 120));
        return 0n;
      },
    } as never;
    const s = realSeller({ prices: { wARS: '1000000000000000000' }, extensions: { eip2612GasSponsoring: { info: { description: 'sponsor', version: '1' } } } });
    const o = await payEndpoint({ account, publicClient: slow, fetchImpl: s.fetch }, request({ asset: 'wARS', maxAtomic: '2000000000000000000', timeoutMs: 40 }));
    expect(o).toMatchObject({ paid: false, failure: { code: 'challenge_timeout' } });
    await new Promise((r) => setTimeout(r, 300)); // the signing finishes long after we gave up
    expect(s.paidCalls()).toHaveLength(0);
    expect(s.fetch.calls).toHaveLength(1);
  });

  test('redirects are never followed, so a payment header can never be forwarded to another host', async () => {
    const seen: string[] = [];
    const spy = (async (input: Parameters<typeof fetch>[0]) => {
      const r = input as Request;
      seen.push(r.redirect);
      return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } });
    }) as typeof fetch;
    const o = await payEndpoint(payer(spy), request());
    expect(o).toMatchObject({ paid: false, status: 302 });
    expect(o.failure).toBeUndefined();
    expect(seen).toEqual(['manual']);
  });
});

describe('payEndpoint: before any payment', () => {
  test('a free endpoint (200 without a challenge) is not paid, and its body comes back', async () => {
    const f = fakeFetch({ [SELLER_URL]: () => new Response('free data', { status: 200 }) });
    const o = await payEndpoint(payer(f), request());
    expect(o).toMatchObject({ paid: false, status: 200, bodyText: 'free data', truncated: false });
    expect(o.failure).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });

  test('a network error on the first request is not_x402, with the reason, and nothing is paid', async () => {
    const f = fakeFetch({ [SELLER_URL]: () => { throw new TypeError('fetch failed'); } });
    const o = await payEndpoint(payer(f), request());
    expect(o).toMatchObject({ paid: false, status: null, failure: { code: 'not_x402', detail: expect.stringContaining('fetch failed') } });
  });

  test('a first request that never answers is challenge_timeout', async () => {
    const f = fakeFetch({ [SELLER_URL]: () => new Promise<Response>(() => {}) });
    const o = await payEndpoint(payer(f), request({ timeoutMs: 50 }));
    expect(o).toMatchObject({ paid: false, failure: { code: 'challenge_timeout' } });
  });

  test('an HTML 402 page is not_x402, and the status and text are kept as evidence', async () => {
    const f = fakeFetch({ [SELLER_URL]: () => new Response('<html>please log in</html>', { status: 402, headers: { 'content-type': 'text/html' } }) });
    const o = await payEndpoint(payer(f), request());
    expect(o).toMatchObject({ paid: false, status: 402, bodyText: '<html>please log in</html>', failure: { code: 'not_x402' } });
  });

  test('a hostile 5 MB 402 body is capped, never buffered whole', async () => {
    let pulled = 0;
    const huge = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (pulled >= 5 * 1024 * 1024) return c.close();
          c.enqueue(new Uint8Array(64 * 1024).fill(65));
          pulled += 64 * 1024;
        },
      },
      { highWaterMark: 0 },
    );
    const f = fakeFetch({ [SELLER_URL]: () => new Response(huge, { status: 402 }) });
    const o = await payEndpoint(payer(f), request());
    expect(o).toMatchObject({ paid: false, status: 402, truncated: true, failure: { code: 'not_x402' } });
    expect(o.bodyText).toHaveLength(256 * 1024);
    expect(pulled).toBeLessThanOrEqual(256 * 1024 + 64 * 1024);
  });

  test.each(['http://seller.example/api/data', 'https://127.0.0.1/api', 'https://user:pw@seller.example/api', 'https://localhost/api'])(
    '%s is refused outright and nothing is sent',
    async (url) => {
      const f = fakeFetch({});
      await expect(payEndpoint(payer(f), request({ url }))).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(f.calls).toHaveLength(0);
    },
  );

  test.each(['0.05', '-1', '0', '', '5e3', '1_000'])('maxAtomic %j is refused as a programming error', async (maxAtomic) => {
    const f = fakeFetch({});
    await expect(payEndpoint(payer(f), request({ maxAtomic }))).rejects.toThrow(RangeError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('wiring', () => {
  test('the clients makeClients builds are handed to payEndpoint as they are (a compile-time check as much as a runtime one)', () => {
    const cfg = loadConfig({ AGENT_PRIVATE_KEY: `0x${'22'.repeat(32)}` });
    const c = makeClients(cfg, { transport: fakeCeloRpc(cfg.chainId).transport });
    const deps: PayerDeps = { account: c.account, publicClient: c.publicClient };
    expect(deps.account.address).toBe(account.address);
  });
});

describe('PAY_FAILURE_CODES', () => {
  test('every code is a finding code, so a failed payment can become a finding without translation', () => {
    for (const code of PAY_FAILURE_CODES) expect(FINDING_ORDER).toContain(code);
    expect([...PAY_FAILURE_CODES].sort()).toEqual(
      ['ambiguous_after_payment', 'challenge_timeout', 'facilitator_error', 'insufficient_credits', 'no_matching_accept', 'nonce_race', 'not_x402', 'permit2_allowance_required', 'settle_failed'].sort(),
    );
  });
});
