import { describe, expect, test } from 'vitest';
import { ASSETS, DEFAULT_POLICY, SpendLedger, emptySpendState, shapeOf, type AssetSymbol } from '@railwalker/core';
import { fakeFetch, v2MultiAssetChallenge } from '@railwalker/testkit';
import type { PayFailureCode, PayOutcome, PayRequest } from '@railwalker/chain';
import { confirmEndpoint, scanEndpoint, type CheckReport, type ConfirmDeps, type ConfirmOptions } from '../src';

const URL_X = 'https://seller.example/api/data';
const PAY_TO = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const TX = `0x${'ab'.repeat(32)}` as const;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };

const withAmount = (amount: string) => ({ ...v2MultiAssetChallenge, accepts: v2MultiAssetChallenge.accepts.map((a) => ({ ...a, amount })) });
const raw = (symbol: AssetSymbol, over: Record<string, unknown> = {}) => ({
  scheme: 'exact',
  network: 'eip155:42220',
  amount: '500',
  asset: ASSETS[symbol].address,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { name: ASSETS[symbol].eip712Name, version: ASSETS[symbol].eip712Version, ...(ASSETS[symbol].method === 'permit2' ? { assetTransferMethod: 'permit2' } : {}) },
  ...over,
});
const challengeOf = (...accepts: unknown[]) => ({ x402Version: 2, resource: { url: URL_X, mimeType: 'application/json' }, accepts });

async function scan(challenge: unknown = v2MultiAssetChallenge, headers: Record<string, string> = CORS): Promise<CheckReport> {
  const f = fakeFetch({ [URL_X]: () => new Response('{}', { status: 402, headers: { 'payment-required': b64(challenge), ...headers } }) });
  return scanEndpoint(
    { fetchImpl: f, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 't' },
    { url: URL_X, method: 'GET' },
  );
}

const settled = (over: Partial<PayOutcome> = {}): PayOutcome => ({
  paid: true,
  status: 200,
  headers: { 'content-type': 'application/json' },
  bodyText: '{"posts":[{"id":1}]}',
  truncated: false,
  settlement: { txHash: TX, payer: PAYER, network: 'eip155:42220' },
  latencyMs: 900,
  ...over,
});
const refused = (code: PayFailureCode, over: Partial<PayOutcome> = {}): PayOutcome => ({
  paid: false,
  status: 402,
  headers: {},
  bodyText: '',
  truncated: false,
  latencyMs: 100,
  failure: { code, detail: `${code} detail` },
  ...over,
});

function setup(over: Partial<ConfirmDeps> = {}, outcomes: PayOutcome[] = [settled()], initial = emptySpendState()) {
  const requests: PayRequest[] = [];
  const verified: unknown[] = [];
  const queue = [...outcomes];
  let tick = 0;
  const ledger = new SpendLedger(DEFAULT_POLICY, initial);
  const deps: ConfirmDeps = {
    pay: async (req) => {
      requests.push(req);
      return queue.length > 1 ? queue.shift()! : queue[0]!;
    },
    verifyTransfer: async (a) => {
      verified.push(a);
      return { ok: true };
    },
    ledger,
    payer: PAYER,
    sellerKey: 'seller.example',
    balanceUsd: async () => 1,
    now: () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0, tick++ * 10)),
    ...over,
  };
  return { deps, requests, verified, ledger };
}

const opts = (over: Partial<ConfirmOptions> = {}): ConfirmOptions => ({ stage: 'fixture', assets: ['USAT'], facts: { url: URL_X, method: 'GET', source: 'fixture' }, optedOut: false, ...over });
const verdictFor = (r: CheckReport, symbol: AssetSymbol) => r.verdicts.find((v) => v.assetSymbol === symbol)!;
const codesOf = (r: CheckReport, symbol: AssetSymbol) => verdictFor(r, symbol).findings.map((f) => f.code);

describe('confirmEndpoint: a payment that works', () => {
  test('ok: paid, transfer verified, JSON delivered -> PASS CONFIRMED for that asset; other assets stay PREDICTED; steps in order', async () => {
    const report = await scan();
    const { deps, requests, verified, ledger } = setup();
    const { report: out, run } = await confirmEndpoint(deps, report, opts());

    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'PASS', basis: 'CONFIRMED' });
    for (const s of ['USDC', 'USDT'] as const) expect(verdictFor(out, s)).toEqual(verdictFor(report, s));
    expect(out.verdicts.map((v) => v.assetSymbol)).toEqual(report.verdicts.map((v) => v.assetSymbol));

    // The cap on the request is the quoted price, so a seller cannot charge more than was reserved.
    expect(requests).toEqual([expect.objectContaining({ url: URL_X, method: 'GET', asset: 'USAT', maxAtomic: '500', timeoutMs: 30_000 })]);
    expect(verified).toEqual([{ txHash: TX, asset: ASSETS.USAT.address, from: PAYER, to: PAY_TO, amountAtomic: '500' }]);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.0005, 6);

    expect(run.steps.map((s) => [s.stage, s.ok])).toEqual([
      ['challenge', true],
      ['lints', true],
      ['wallet', true],
      ['sign', true],
      ['settle', true],
      ['deliver', true],
      ['verdict', true],
    ]);
    expect(run.payments).toEqual([{ asset: ASSETS.USAT.address, symbol: 'USAT', amountAtomic: '500', payTo: PAY_TO, txHash: TX }]);
    expect(run).toMatchObject({ kind: 'fixture', endpoint: { url: URL_X, method: 'GET' }, verdicts: out.verdicts });
  });

  test('the report that came in is not modified; the one that comes out lists the new findings', async () => {
    const report = await scan();
    const before = structuredClone(report);
    const { deps } = setup({}, [settled({ status: 500, bodyText: 'x' })]);
    const { report: out } = await confirmEndpoint(deps, report, opts());
    expect(report).toEqual(before);
    expect(out).not.toBe(report);
    expect(out.findings.some((f) => f.code === 'paid_not_delivered')).toBe(true);
  });

  test('options are honoured: body, payTimeoutMs, duplicate assets paid once', async () => {
    const { deps, requests } = setup({ payTimeoutMs: 1234 });
    await confirmEndpoint(deps, await scan(), opts({ body: { q: 1 }, assets: ['USAT', 'USAT'] }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ body: { q: 1 }, timeoutMs: 1234 });
  });

  test('several assets are paid in turn, each its own reserved settlement and its own verdict', async () => {
    const { deps, requests, ledger } = setup();
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts({ assets: ['USDC', 'USAT'] }));
    expect(requests.map((r) => r.asset)).toEqual(['USDC', 'USAT']);
    expect(['USDC', 'USDT', 'USAT'].map((s) => verdictFor(out, s as AssetSymbol).basis)).toEqual(['CONFIRMED', 'PREDICTED', 'CONFIRMED']);
    expect(run.payments.map((p) => p.symbol)).toEqual(['USDC', 'USAT']);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.001, 6);
  });
});

describe('confirmEndpoint: what delivery looks like', () => {
  test('paid then 500 -> FAIL paid_not_delivered (CONFIRMED), and the seller keeps the money', async () => {
    const { deps, ledger } = setup({}, [settled({ status: 500, bodyText: '{"error":"x"}' })]);
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code: 'paid_not_delivered', basis: 'CONFIRMED' });
    expect(out.findings.find((f) => f.code === 'paid_not_delivered')).toMatchObject({ basis: 'CONFIRMED', assetSymbol: 'USAT' });
    expect(run.steps.filter((s) => s.stage === 'deliver').map((s) => s.ok)).toEqual([false]);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.0005, 6);
  });

  test.each([
    ['200 with an empty body', settled({ bodyText: '' }), 'delivered_empty'],
    ['invalid JSON when the challenge promised application/json', settled({ bodyText: 'not json' }), 'delivered_invalid_json'],
  ] as const)('%s', async (_name, outcome, code) => {
    const { deps } = setup({}, [outcome]);
    const { report: out } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code, basis: 'CONFIRMED' });
  });

  test('shape drift against learnedShape -> schema_mismatch (warn); slower than tooSlowMs -> too_slow (warn)', async () => {
    const { deps } = setup({ learnedShape: shapeOf({ other: 1 }), tooSlowMs: 500 });
    const { report: out } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'PASS_WITH_WARNINGS', basis: 'CONFIRMED' });
    expect(codesOf(out, 'USAT')).toEqual(expect.arrayContaining(['schema_mismatch', 'too_slow']));
  });

  test('lab: deliveries 3 learns the shape from the first delivery and compares the next two; drift on the third -> schema_mismatch; each delivery is its own reserved settlement', async () => {
    const bodies = ['{"a":1,"b":"x"}', '{"a":2,"b":"y"}', '{"a":"drift"}'];
    const { deps, requests, ledger } = setup({}, bodies.map((bodyText) => settled({ bodyText })));
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 3 }));

    expect(requests).toHaveLength(3);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.0015, 6);
    expect(ledger.snapshot().settlementsBySeller['seller.example']).toBe(3);
    const v = verdictFor(out, 'USAT');
    expect(v).toMatchObject({ kind: 'PASS_WITH_WARNINGS', basis: 'CONFIRMED' });
    const drift = v.findings.filter((f) => f.code === 'schema_mismatch');
    expect(drift).toHaveLength(1);
    expect(drift[0]!.evidence.missingKeys).toEqual(['a', 'b']);
    expect(run.payments).toHaveLength(3);
    expect(run.steps.filter((s) => s.stage === 'settle')).toHaveLength(3);
  });

  test('lab: a shape that was already learned is used from the first delivery', async () => {
    const { deps } = setup({ learnedShape: shapeOf({ a: 1 }) }, [settled({ bodyText: '{"nope":1}' }), settled({ bodyText: '{"nope":1}' })]);
    const { report: out } = await confirmEndpoint(deps, await scan(), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 2 }));
    expect(verdictFor(out, 'USAT').findings.filter((f) => f.code === 'schema_mismatch')).toHaveLength(2);
  });

  test('lab: nothing more is paid after a DELIVERY fails either: a seller that took money and gave nothing is not paid again', async () => {
    const { deps, requests } = setup({}, [settled({ status: 500, bodyText: 'oops' }), settled(), settled()]);
    const { report: out } = await confirmEndpoint(deps, await scan(), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 3 }));
    expect(requests).toHaveLength(1);
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code: 'paid_not_delivered' });
  });

  test('lab: nothing more is paid after a delivery fails', async () => {
    const { deps, requests } = setup({}, [settled(), refused('settle_failed'), settled()]);
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 3 }));
    expect(requests).toHaveLength(2);
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code: 'settle_failed', basis: 'CONFIRMED' });
    expect(run.payments).toHaveLength(1);
  });
});

describe('confirmEndpoint: the seller’s settlement is checked on chain', () => {
  test.each([
    ['transfer_mismatch', 'transfer_mismatch'],
    ['reverted', 'settle_failed'],
    ['tx_not_found', 'tx_not_found'],
    [undefined, 'transfer_mismatch'],
  ] as const)('verifyTransfer %s -> FAIL %s (CONFIRMED), and delivery is not judged', async (reason, code) => {
    const { deps, ledger } = setup({ verifyTransfer: async () => ({ ok: false, reason }) });
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code, basis: 'CONFIRMED' });
    expect(run.steps.map((s) => s.stage)).not.toContain('deliver');
    expect(run.steps.find((s) => s.stage === 'settle')!.ok).toBe(false);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.0005, 6); // the receipt said money moved; the ledger does not take it back
  });

  test('verifyTransfer failing to answer is AMBIGUOUS: the seller says it settled and nobody can check', async () => {
    const { deps, ledger } = setup({
      verifyTransfer: async () => {
        throw new Error('rpc down');
      },
    });
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'AMBIGUOUS', basis: 'CONFIRMED' });
    expect(out.findings.find((f) => f.code === 'ambiguous_after_payment')!.message).toContain('rpc down');
    expect(run.payments).toEqual([expect.objectContaining({ symbol: 'USAT', txHash: TX })]);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.0005, 6);
  });
});

describe('confirmEndpoint: a payment that did not go through', () => {
  test('ambiguous: pay returns ambiguous_after_payment -> verdict AMBIGUOUS, pay called exactly once, spend stays recorded', async () => {
    const { deps, requests, verified, ledger } = setup({}, [refused('ambiguous_after_payment', { status: null })]);
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 3 }));
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'AMBIGUOUS', code: 'ambiguous_after_payment', basis: 'CONFIRMED' });
    expect(requests).toHaveLength(1); // never retried, and no further delivery is bought from a seller whose last payment is unknown
    expect(verified).toEqual([]);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.0005, 6);
    expect(run.payments).toEqual([{ asset: ASSETS.USAT.address, symbol: 'USAT', amountAtomic: '500', payTo: PAY_TO }]);
    expect(run.steps.find((s) => s.stage === 'settle')!.ok).toBeNull();
  });

  test.each([
    ['settle_failed', 'CONFIRMED'],
    ['permit2_allowance_required', 'CONFIRMED'],
    ['insufficient_credits', 'CONFIRMED'],
    ['facilitator_error', 'CONFIRMED'],
    ['no_matching_accept', 'PREDICTED'],
    ['challenge_timeout', 'PREDICTED'],
    ['not_x402', 'PREDICTED'],
  ] as const)('%s: FAIL (%s), and the reservation is given back because no money moved', async (code, basis) => {
    const { deps, ledger } = setup({}, [refused(code)]);
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code, basis });
    expect(out.findings.find((f) => f.code === code)).toMatchObject({ basis, assetSymbol: 'USAT' });
    expect(ledger.snapshot()).toMatchObject({ totalUsd: 0, settlementsBySeller: { 'seller.example': 0 } });
    expect(run.payments).toEqual([]);
  });

  test('a failure carries the detail the payer reported, as evidence', async () => {
    const { deps } = setup({}, [refused('settle_failed', { failure: { code: 'settle_failed', detail: 'insufficient_funds' } })]);
    const { report: out } = await confirmEndpoint(deps, await scan(), opts());
    expect(out.findings.find((f) => f.code === 'settle_failed')!.evidence).toMatchObject({ detail: 'insufficient_funds' });
  });

  test('nonce_race is inconclusive: our own collision says nothing about the seller, so the verdict is left as the scan had it', async () => {
    const report = await scan();
    const { deps, ledger } = setup({}, [refused('nonce_race')]);
    const { report: out } = await confirmEndpoint(deps, report, opts());
    expect(verdictFor(out, 'USAT')).toEqual(verdictFor(report, 'USAT'));
    expect(out.findings.some((f) => f.code === 'nonce_race')).toBe(true);
    expect(ledger.snapshot().totalUsd).toBe(0);
  });

  test('an endpoint that answers without asking for payment is not_x402 (PREDICTED), and nothing is spent', async () => {
    const free = { paid: false, status: 200, headers: {}, bodyText: 'free data', truncated: false, latencyMs: 50 } satisfies PayOutcome;
    const { deps, ledger } = setup({}, [free]);
    const { report: out, run } = await confirmEndpoint(deps, await scan(), opts());
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'FAIL', code: 'not_x402', basis: 'PREDICTED' });
    expect(out.findings.find((f) => f.code === 'not_x402')!.evidence).toMatchObject({ detail: expect.stringContaining('HTTP 200') });
    expect(ledger.snapshot().totalUsd).toBe(0);
    expect(run.payments).toEqual([]);
  });

  test('a confirmed permit2_allowance_required carries the same patch as the static lint for it: the sponsorship extension', async () => {
    const challenge = challengeOf(raw('wARS', { amount: '1000000000000000000' }));
    const { deps } = setup({ pesoRates: { wARS: 0.001 } }, [refused('permit2_allowance_required', { status: 412 })]);
    const { report: out } = await confirmEndpoint(deps, await scan(challenge), opts({ assets: ['wARS'] }));
    const patch = out.patches.find((p) => p.code === 'permit2_allowance_required');
    expect(patch?.after).toContain('eip2612GasSponsoring');
  });

  test('a payer that throws gives the reservation back and the error propagates', async () => {
    const { deps, ledger } = setup({
      pay: async () => {
        throw new Error('rpc down');
      },
    });
    await expect(confirmEndpoint(deps, await scan(), opts())).rejects.toThrow('rpc down');
    expect(ledger.snapshot().totalUsd).toBe(0);
  });
});

describe('confirmEndpoint: the ledger decides what may be paid', () => {
  const skipped = async (over: Partial<ConfirmOptions>, depsOver: Partial<ConfirmDeps> = {}, challenge: unknown = v2MultiAssetChallenge, initial = emptySpendState()) => {
    const report = await scan(challenge);
    const s = setup(depsOver, [settled()], initial);
    const result = await confirmEndpoint(s.deps, report, opts(over));
    return { ...s, ...result, before: report };
  };

  test('a route that is not read-style is never paid: SKIPPED not_read_style, and pay is never called', async () => {
    const r = await skipped({ facts: { url: 'https://seller.example/api/send-payment', method: 'GET', source: 'visitor' } });
    expect(verdictFor(r.report, 'USAT')).toMatchObject({ kind: 'SKIPPED', code: 'not_read_style', basis: 'PREDICTED' });
    expect(r.requests).toEqual([]);
    expect(r.ledger.snapshot().totalUsd).toBe(0);
  });

  test('a skipped verdict keeps the static findings the scan made, so nothing is lost', async () => {
    const r = await skipped({ optedOut: true });
    expect(verdictFor(r.report, 'USAT').findings).toEqual(verdictFor(r.before, 'USAT').findings);
  });

  test.each([
    ['an opted-out seller', { optedOut: true }, {}, undefined, 'opted_out'],
    ['a price over the per-probe cap ($0.06)', {}, {}, withAmount('60000'), 'over_probe_cap'],
    ['a balance that would fall under the reserve', {}, { balanceUsd: async () => 0.1 }, undefined, 'below_reserve'],
    ['an unsolicited price under $0.005', { stage: 'unsolicited' }, {}, undefined, 'price_below_unsolicited_minimum'],
  ] as const)('%s -> SKIPPED %s', async (_name, over, depsOver, challenge, reason) => {
    const r = await skipped(over as Partial<ConfirmOptions>, depsOver as Partial<ConfirmDeps>, challenge);
    expect(verdictFor(r.report, 'USAT')).toMatchObject({ kind: 'SKIPPED', code: reason });
    expect(r.requests).toEqual([]);
  });

  test('an unsolicited seller that already took its three settlements is not paid again', async () => {
    const initial = { ...emptySpendState(), settlementsBySeller: { 'seller.example': 3 } };
    const r = await skipped({ stage: 'unsolicited' }, {}, withAmount('5000'), initial);
    expect(verdictFor(r.report, 'USAT')).toMatchObject({ kind: 'SKIPPED', code: 'seller_settlement_limit' });
    expect(r.requests).toEqual([]);
  });

  test('customer stage: feePaidUsd 0.02 and target price 0.012 -> SKIPPED customer_fee_fraction_exceeded', async () => {
    const r = await skipped({ stage: 'customer', feePaidUsd: 0.02 }, {}, withAmount('12000'));
    expect(verdictFor(r.report, 'USAT')).toMatchObject({ kind: 'SKIPPED', code: 'customer_fee_fraction_exceeded' });
    expect(r.requests).toEqual([]);
  });

  test('customer stage: what this check already spent counts against its share of the fee', async () => {
    // fee $0.02 -> $0.01 to spend; two targets at $0.006 each: the first fits, the second does not
    const { deps, requests } = setup();
    const { report: out } = await confirmEndpoint(deps, await scan(withAmount('6000')), opts({ stage: 'customer', feePaidUsd: 0.02, assets: ['USDC', 'USAT'] }));
    expect(requests.map((r) => r.asset)).toEqual(['USDC']);
    expect(verdictFor(out, 'USDC')).toMatchObject({ kind: 'PASS', basis: 'CONFIRMED' });
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'SKIPPED', code: 'customer_fee_fraction_exceeded' });
  });

  test('customer stage: a second delivery that no longer fits stops the lab run and keeps the first delivery’s verdict', async () => {
    const { deps, requests } = setup();
    const { report: out } = await confirmEndpoint(deps, await scan(withAmount('6000')), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 3 }));
    expect(requests).toHaveLength(1);
    expect(verdictFor(out, 'USAT')).toMatchObject({ kind: 'PASS', basis: 'CONFIRMED' });
  });

  test('customer stage: a price inside half the fee is paid', async () => {
    const r = await skipped({ stage: 'customer', feePaidUsd: 0.02 }, {}, withAmount('9000'));
    expect(verdictFor(r.report, 'USAT').kind).toBe('PASS');
    expect(r.requests).toHaveLength(1);
  });

  test('peso asset without a rate -> SKIPPED unpriced_asset, and with a rate it is paid at the quoted price', async () => {
    const challenge = challengeOf(raw('wARS', { amount: '1000000000000000000' }));
    const a = await skipped({ assets: ['wARS'] }, {}, challenge);
    expect(verdictFor(a.report, 'wARS')).toMatchObject({ kind: 'SKIPPED', code: 'unpriced_asset' });
    expect(a.requests).toEqual([]);

    const b = await skipped({ assets: ['wARS'] }, { pesoRates: { wARS: 0.001 } }, challenge);
    expect(b.requests).toEqual([expect.objectContaining({ asset: 'wARS', maxAtomic: '1000000000000000000' })]);
    expect(b.ledger.snapshot().totalUsd).toBeCloseTo(0.001, 6);
  });

  test('two concurrent confirms for one unsolicited seller never exceed 3 settlements', async () => {
    const report = await scan(withAmount('5000'));
    const { deps, requests, ledger } = setup();
    const lab = opts({ stage: 'unsolicited', deliveries: 2, facts: { url: URL_X, method: 'GET', source: 'erc8004' } });
    const [a, b] = await Promise.all([confirmEndpoint(deps, report, lab), confirmEndpoint(deps, report, lab)]);
    expect(requests).toHaveLength(3);
    expect(ledger.snapshot().settlementsBySeller['seller.example']).toBe(3);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.015, 6);
    expect([a, b].flatMap((r) => r.run.payments)).toHaveLength(3);
  });

  test('the balance is read fresh for every reservation', async () => {
    let reads = 0;
    const { deps } = setup({ balanceUsd: async () => ++reads }, [settled(), settled()]);
    await confirmEndpoint(deps, await scan(), opts({ stage: 'customer', feePaidUsd: 0.02, deliveries: 2 }));
    expect(reads).toBe(2);
  });
});

describe('confirmEndpoint: what is never requested', () => {
  test('the sandbox accept is never requested, even when it reuses the mainnet asset address', async () => {
    const sandbox = raw('USDC', { network: 'eip155:11142220' });
    const { deps, requests } = setup();
    const report = await scan(challengeOf(sandbox));
    const { report: out } = await confirmEndpoint(deps, report, opts({ assets: ['USDC'] }));
    expect(requests).toEqual([]);
    expect(out.verdicts).toEqual(report.verdicts);
  });

  test('an asset the seller does not offer is left alone', async () => {
    const { deps, requests } = setup();
    const report = await scan();
    const { report: out } = await confirmEndpoint(deps, report, opts({ assets: ['wBRL'] }));
    expect(requests).toEqual([]);
    expect(out.verdicts).toEqual(report.verdicts);
  });

  test('a scan that found no challenge has nothing to confirm', async () => {
    const f = fakeFetch({ [URL_X]: () => new Response('hello', { status: 200 }) });
    const report = await scanEndpoint(
      { fetchImpl: f, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 't' },
      { url: URL_X, method: 'GET' },
    );
    const { deps, requests } = setup();
    const { report: out, run } = await confirmEndpoint(deps, report, opts());
    expect(requests).toEqual([]);
    expect(out).toEqual(report);
    expect(run.steps.map((s) => [s.stage, s.ok])).toEqual([['challenge', false], ['verdict', false]]);
  });
});

describe('confirmEndpoint: the run record', () => {
  test('the run record has monotonic t and ends with a verdict step', async () => {
    const { deps } = setup();
    const { run } = await confirmEndpoint(deps, await scan(), opts());
    const ts = run.steps.map((s) => s.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(run.steps.at(-1)!.stage).toBe('verdict');
    expect(run.steps.at(-1)!.label).toContain('USAT');
  });

  test('t stays monotonic even if the clock steps backwards', async () => {
    let calls = 0;
    const { deps } = setup({ now: () => new Date(Date.UTC(2026, 9, 22, 12, 0, 0, calls++ % 2 === 0 ? 500 : 0)) });
    const { run } = await confirmEndpoint(deps, await scan(), opts());
    const ts = run.steps.map((s) => s.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  test('a skipped confirmation still ends in a verdict step that says why', async () => {
    const { deps } = setup();
    const { run } = await confirmEndpoint(deps, await scan(), opts({ optedOut: true }));
    expect(run.steps.map((s) => s.stage)).toEqual(['challenge', 'lints', 'wallet', 'verdict']);
    expect(run.steps.find((s) => s.stage === 'wallet')).toMatchObject({ ok: false, detail: { reason: 'opted_out' } });
    expect(run.verdicts.find((v) => v.assetSymbol === 'USAT')).toMatchObject({ kind: 'SKIPPED', code: 'opted_out' });
  });
});
