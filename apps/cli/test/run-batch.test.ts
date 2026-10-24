import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ASSETS, DEFAULT_POLICY, SpendLedger, type PayQuery, type Policy, type Stage, type Verdict } from '@railwalker/core';
import { FileDataStore, DiscoveryStateSchema, RotationStateSchema, RunRecordSchema, ScanSummarySchema, SpendStateSchema, sellerKeyFor, type DataStore, type DiscoveryState } from '@railwalker/data';
import type { Endpoint } from '@railwalker/discovery';
import { RunRecorder, scanEndpoint, type CheckReport } from '@railwalker/scanner';
import { fakeFetch, v2MultiAssetChallenge } from '@railwalker/testkit';
import { loadDiscoveryState, loadRotationState, loadSpendState, runBatch, type BatchDeps } from '../src';

const SALT = 'a-long-secret-salt-1234';
const START = Date.UTC(2026, 9, 22, 12, 0, 0);
const HOUR = 3_600_000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const payToFor = (seed: string) => `0x${sha(`payto ${seed}`).slice(0, 40)}`;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };

type Kind = 'fixture' | 'buy' | 'unsolicited';
function endpoint(kind: Kind, n: number, over: Partial<Endpoint> = {}): Endpoint {
  if (kind === 'fixture') return { url: `https://fixtures.example/api/fixtures/paid/${n}`, method: 'GET', source: 'fixture', ...over };
  if (kind === 'buy') return { url: `https://gateway.usebuy.ai/v1/social/x/search-${n}`, method: 'POST', source: 'buy', capabilityId: `x.search.${n}`, bodyTemplate: { query: 'test' }, ...over };
  return { url: `https://u${n}x.example/api/data`, method: 'GET', source: 'erc8004', agentId: String(9_900_000 + n), ...over };
}
const many = (kind: Kind, count: number, from = 1) => Array.from({ length: count }, (_, i) => endpoint(kind, from + i));
const keyOf = (e: Endpoint, stage: Stage) => sellerKeyFor(stage, new URL(e.url).hostname, SALT);
const byKey = (list: Endpoint[]) => [...list].sort((a, b) => (keyOf(a, 'unsolicited') < keyOf(b, 'unsolicited') ? -1 : 1));

interface World {
  dir: string;
  store: FileDataStore;
  time: number;
  now: () => Date;
}

/** The real scanner against a fake seller, so reports are the real thing: no network. */
type How = 'ok' | 'not-x402' | 'pesos' | 'opted-out' | 'usdc-only' | 'usat-only' | 'usdt-only' | 'testnet' | 'unknown-asset' | 'describes-action';

async function scanFake(e: Endpoint, world: World, how: How = 'ok'): Promise<CheckReport> {
  const payTo = payToFor(e.url);
  const pesos = { x402Version: 2, resource: { url: e.url }, accepts: [{ scheme: 'exact', network: 'eip155:42220', amount: '1000000000000000000', asset: ASSETS.wARS.address, payTo, maxTimeoutSeconds: 300, extra: { name: 'Peso Argentino', version: '1', assetTransferMethod: 'permit2' } }] };
  const offer = (symbols: ('USDC' | 'USDT' | 'USAT')[], over: Record<string, unknown> = {}) => ({
    ...v2MultiAssetChallenge,
    accepts: symbols.map((symbol) => ({ scheme: 'exact', network: 'eip155:42220', amount: '5000', asset: ASSETS[symbol].address, payTo, maxTimeoutSeconds: 300, extra: { name: ASSETS[symbol].eip712Name, version: ASSETS[symbol].eip712Version }, ...over })),
  });
  const challenges: Record<string, unknown> = {
    ok: offer(['USDC', 'USDT', 'USAT']),
    pesos,
    'usdc-only': offer(['USDC']),
    'usat-only': offer(['USAT']),
    'usdt-only': offer(['USDT']),
    testnet: offer(['USAT'], { network: 'eip155:11142220' }),
    'unknown-asset': offer(['USAT'], { asset: '0x1234567890123456789012345678901234567890' }),
    'describes-action': { ...offer(['USAT']), resource: { url: e.url, description: 'Create a booking for the customer' } },
  };
  const href = new URL(e.url).href;
  const f = fakeFetch({
    [href]: () => (how === 'not-x402' ? new Response('{}', { status: 200 }) : new Response('{}', { status: 402, headers: { 'payment-required': b64(challenges[how] ?? challenges.ok), ...CORS } })),
  });
  return scanEndpoint({ fetchImpl: f, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => how === 'opted-out', now: world.now, userAgent: 'test' }, { url: e.url, method: e.method });
}

interface Payer {
  balanceUsd?: number;
  priceUsd?: number;
  /** Let other work run while a payment is in progress, as a real one would. */
  delay?: boolean;
  /** Time a payment takes on the clock. */
  takesMs?: number;
  throws?: (e: Endpoint) => boolean;
  /** Put a field in the run record that the schema does not know. */
  stray?: boolean;
}

/** A payer that behaves like confirmEndpoint: it reserves through the shared ledger first, so the ledger decides. */
function payer(ledger: SpendLedger, world: World, o: Payer = {}) {
  const calls: { stage: Stage; url: string }[] = [];
  let counter = 0;
  const confirm: BatchDeps['confirm'] = async (e, report, stage) => {
    calls.push({ stage, url: e.url });
    if (o.delay) await new Promise((r) => setTimeout(r, 1));
    if (o.takesMs) world.time += o.takesMs;
    if (o.throws?.(e)) throw new Error('the payer failed');
    const q: PayQuery = { stage, sellerKey: keyOf(e, stage), priceUsd: o.priceUsd ?? 0.005, readStyle: true, optedOut: false, balanceUsd: o.balanceUsd ?? 5, now: world.now() };
    const decision = await ledger.reserve(q);
    const rec = new RunRecorder(world.now, stage, { url: e.url, method: e.method });
    const symbol = 'USAT' as const;
    if (!decision.allow) {
      rec.step('wallet', false, `${symbol}: payment refused (${decision.reason})`, { reason: decision.reason });
      const verdicts: Verdict[] = [{ kind: 'SKIPPED', code: decision.reason, basis: 'PREDICTED', assetSymbol: symbol, findings: [] }];
      return { report: { ...report, verdicts }, run: rec.finish(verdicts) };
    }
    const accept = report.challenge!.accepts.find((a) => a.assetInfo?.symbol === symbol)!;
    rec.step('wallet', true, `${symbol}: reserved $0.0050`);
    rec.step('settle', true, `${symbol}: settled`);
    rec.payment({ asset: ASSETS.USAT.address, symbol, amountAtomic: '5000', payTo: accept.payTo, txHash: `0x${sha(`tx ${e.url} ${stage} ${counter++} ${world.time}`)}` });
    const verdicts: Verdict[] = [{ kind: 'PASS', basis: 'CONFIRMED', assetSymbol: symbol, findings: [] }];
    const run = rec.finish(verdicts);
    return { report: { ...report, verdicts }, run: o.stray ? ({ ...run, privateKey: 'x' } as typeof run) : run };
  };
  return { confirm, calls };
}

interface RunOpts {
  policy?: Policy;
  ledger?: SpendLedger;
  store?: DataStore;
  payer?: Payer;
  maxPaidPerRun?: number;
  scanConcurrency?: number;
  budgetMs?: number;
  cursor?: DiscoveryState;
  scanHow?: (e: Endpoint) => How;
  scanTakesMs?: number;
  scanThrows?: (e: Endpoint) => boolean;
  deps?: Partial<BatchDeps>;
}

let world: World;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'railwalker-batch-'));
  const w: World = { dir, store: new FileDataStore(dir), time: START, now: () => new Date(w.time) };
  world = w;
});
afterEach(() => rm(world.dir, { recursive: true, force: true }));

/** One run, built the way the real command builds it: the ledger comes from the saved state. */
async function runOnce(endpoints: Endpoint[], o: RunOpts = {}) {
  const store = o.store ?? world.store;
  const ledger = o.ledger ?? new SpendLedger(o.policy ?? DEFAULT_POLICY, await loadSpendState(store));
  const { confirm, calls } = payer(ledger, world, o.payer);
  const scanned: string[] = [];
  const cursors: DiscoveryState[] = [];
  let inFlight = 0;
  let peak = 0;
  const deps: BatchDeps = {
    store,
    discover: async (cursor) => (cursors.push(cursor), { endpoints, cursor: o.cursor ?? cursor }),
    scan: async (e) => {
      scanned.push(e.url);
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 1));
        if (o.scanTakesMs) world.time += o.scanTakesMs;
        if (o.scanThrows?.(e)) throw new Error('scan blew up');
        return await scanFake(e, world, o.scanHow?.(e));
      } finally {
        inFlight--;
      }
    },
    confirm,
    ledger,
    salt: SALT,
    now: world.now,
    maxPaidPerRun: o.maxPaidPerRun ?? 3,
    scanConcurrency: o.scanConcurrency ?? 4,
    budgetMs: o.budgetMs ?? 600_000,
    ...o.deps,
  };
  const result = await runBatch(deps);
  return { result, calls, ledger, scanned, cursors, peak: () => peak };
}

/** Every file the store holds, as text. */
async function everything(store: DataStore = world.store): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of await store.list('')) out[path] = (await store.read(path))!;
  return out;
}

describe('runBatch: what it pays, and in what order', () => {
  test('pays in rounds, a fixture then a buy route then a registered seller, until maxPaidPerRun', async () => {
    const fixtures = many('fixture', 3);
    const buys = many('buy', 3);
    const sellers = byKey(many('unsolicited', 3)).reverse(); // discovered in the opposite order to the one they are taken in
    const r = await runOnce([...sellers, ...buys.reverse(), ...fixtures.reverse()], { maxPaidPerRun: 4 }); // the order of discovery does not matter
    expect(r.calls.map((c) => [c.stage, c.url])).toEqual([
      ['fixture', fixtures[2]!.url],
      ['buy', buys[2]!.url],
      ['unsolicited', byKey(sellers)[0]!.url],
      ['fixture', fixtures[1]!.url],
    ]);
    expect(r.result).toMatchObject({ scanned: 9, paid: 4 });
  });

  test('maxPaidPerRun is a hard stop, and zero means nothing is paid but everything is still scanned and summarised', async () => {
    const list = [...many('fixture', 2), ...many('buy', 2)];
    expect((await runOnce(list, { maxPaidPerRun: 1 })).result.paid).toBe(1);
    const none = await runOnce(list, { maxPaidPerRun: 0 });
    expect(none.calls).toEqual([]);
    expect(none.result).toMatchObject({ scanned: 4, paid: 0 });
    expect(await world.store.read('summary.json')).not.toBeNull();
  });

  test('a run that pays nothing still leaves its state behind, so the next run can tell it started from nothing', async () => {
    await runOnce(many('buy', 2), { maxPaidPerRun: 0 }); // a fresh store: nothing else could have written it
    expect(SpendStateSchema.parse(JSON.parse((await world.store.read('state/spend.json'))!)).totalUsd).toBe(0);
  });

  test('an endpoint with an absurdly long URL is still paid, and does not break the rotation file it cannot be listed in', async () => {
    const long = endpoint('buy', 1, { url: `https://gateway.usebuy.ai/${'x'.repeat(2500)}` });
    const r = await runOnce([long, ...many('buy', 2, 2)], { maxPaidPerRun: 3 });
    expect(r.result.paid).toBe(3);
    const rotation = await loadRotationState(world.store);
    expect(Object.keys(rotation.lastTried)).toHaveLength(2);
  });

  test('a registered seller is paid in the same round as a fixture and a buy route even with a budget of three', async () => {
    const r = await runOnce([...many('fixture', 5), ...many('buy', 5), ...many('unsolicited', 5)], { maxPaidPerRun: 3 });
    expect(r.calls.map((c) => c.stage)).toEqual(['fixture', 'buy', 'unsolicited']);
  });

  test('within a stage the endpoint tried longest ago goes first, so successive runs take them in turn', async () => {
    const buys = many('buy', 3);
    const order: string[] = [];
    for (let run = 0; run < 4; run++) {
      const r = await runOnce(buys, { maxPaidPerRun: 1 });
      order.push(...r.calls.map((c) => c.url));
      world.time += HOUR;
    }
    expect(order).toEqual([buys[0]!.url, buys[1]!.url, buys[2]!.url, buys[0]!.url]);
    const rotation = RotationStateSchema.parse(JSON.parse((await world.store.read('state/rotation.json'))!));
    expect(Object.keys(rotation.lastTried).sort()).toEqual(buys.map((b) => `POST ${b.url}`).sort());
  });

  test('an endpoint whose payment keeps failing goes to the back instead of blocking the rest', async () => {
    const [bad, good1, good2] = many('buy', 3);
    const throws = (e: Endpoint) => e.url === bad!.url;
    const first = await runOnce([bad!, good1!, good2!], { maxPaidPerRun: 1, payer: { throws } });
    expect(first.calls.map((c) => c.url)).toEqual([bad!.url, good1!.url]);
    expect(first.result).toMatchObject({ paid: 1, failed: 1 });
    world.time += HOUR;
    const second = await runOnce([bad!, good1!, good2!], { maxPaidPerRun: 1, payer: { throws } });
    expect(second.calls.map((c) => c.url)).toEqual([good2!.url]); // never tried yet, so first
  });

  test('endpoints with nothing to tell them apart are taken in a fixed order, whatever order they were discovered in', async () => {
    const buys = many('buy', 3);
    const r = await runOnce([...buys].reverse(), { maxPaidPerRun: 3 });
    expect(r.calls.map((c) => c.url)).toEqual(buys.map((b) => b.url));
  });

  test('a refusal about the wallet does not count as trying the endpoint: it is first in line again next run', async () => {
    const buys = many('buy', 3);
    await runOnce(buys, { maxPaidPerRun: 1, payer: { balanceUsd: 0.05 } });
    expect(Object.keys((await loadRotationState(world.store)).lastTried)).toEqual([]);
    world.time += HOUR;
    const next = await runOnce(buys, { maxPaidPerRun: 1 });
    expect(next.calls[0]!.url).toBe(buys[0]!.url);
  });

  test.each([[1.5, 1], [Number.NaN, 0], [-3, 0], [Number.POSITIVE_INFINITY, 0]])('a maxPaidPerRun of %f means %i payments', async (maxPaidPerRun, payments) => {
    const r = await runOnce(many('buy', 5), { maxPaidPerRun });
    expect(r.result.paid).toBe(payments);
  });

  test('only payments count against maxPaidPerRun: refusals and failures do not use it up', async () => {
    const [bad, good] = many('buy', 2);
    const r = await runOnce([bad!, good!], { maxPaidPerRun: 1, payer: { throws: (e) => e.url === bad!.url } });
    expect(r.result.paid).toBe(1);
  });

  test('a refusal that is about one seller does not stop the run', async () => {
    const policy = { ...DEFAULT_POLICY, perEndpointDayMaxUsd: 0.005 }; // one payment a day per host
    const [f1] = many('fixture', 1);
    const [b1, b2] = many('buy', 2); // the same host
    const [u1, u2] = many('unsolicited', 2);
    const r = await runOnce([f1!, b1!, b2!, u1!, u2!], { policy, maxPaidPerRun: 10 });
    const sellers = byKey([u1!, u2!]);
    expect(r.calls.map((c) => c.url)).toEqual([f1!.url, b1!.url, sellers[0]!.url, b2!.url, sellers[1]!.url]); // b2 was refused, u2 still paid
    expect(r.result.paid).toBe(4);
  });

  test('a refusal that is about the whole event or the wallet stops the run at once', async () => {
    const low = await runOnce([...many('fixture', 3), ...many('buy', 3)], { payer: { balanceUsd: 0.05 } }); // under the reserve
    expect(low.calls).toHaveLength(1);
    expect(low.result.paid).toBe(0);
    const capped = await runOnce([...many('fixture', 3), ...many('buy', 3)], { policy: { ...DEFAULT_POLICY, eventMaxUsd: 0.01 }, maxPaidPerRun: 10 });
    expect(capped.result.paid).toBe(2);
    expect(capped.calls).toHaveLength(3); // the third attempt hit the cap and nothing after it was tried
  });

  test('a run with the balance below the reserve pays nothing, spends nothing, and still writes the summary', async () => {
    const r = await runOnce([...many('fixture', 2), ...many('buy', 2), ...many('unsolicited', 2)], { payer: { balanceUsd: 0.05 } });
    expect(r.result).toMatchObject({ scanned: 6, paid: 0 });
    expect(ScanSummarySchema.parse(JSON.parse((await world.store.read('summary.json'))!)).endpointsScanned).toBe(4); // the fixtures are ours, not the ecosystem's
    expect(SpendStateSchema.parse(JSON.parse((await world.store.read('state/spend.json'))!)).totalUsd).toBe(0);
  });

  test('what cannot be paid is never offered to the payer: no x402 challenge, no asset we pay with, not read-style, a skipped scan, a visitor', async () => {
    const plain = endpoint('buy', 1);
    const noX402 = endpoint('buy', 2);
    const usdtOnly = endpoint('buy', 3); // USDT is never paid with
    const action = endpoint('buy', 4, { url: 'https://gateway.usebuy.ai/v1/send-payment' });
    const unsafe = endpoint('buy', 5, { url: 'http://gateway.usebuy.ai/v1/insecure' });
    const visitor = endpoint('buy', 6, { source: 'visitor' });
    const how = (e: Endpoint) => (e.url === noX402.url ? 'not-x402' : e.url === usdtOnly.url ? 'usdt-only' : 'ok');
    const r = await runOnce([plain, noX402, usdtOnly, action, unsafe, visitor], { maxPaidPerRun: 10, scanHow: how });
    expect(r.calls.map((c) => c.url)).toEqual([plain.url]);
    expect(r.result.scanned).toBe(6); // everything is still scanned, and counted in the summary
  });

  test('a seller that takes only pesos is offered to the payer: whether the wallet holds the pesos is the payer’s call', async () => {
    const pesoOnly = endpoint('buy', 1);
    const r = await runOnce([pesoOnly], { maxPaidPerRun: 10, scanHow: () => 'pesos' });
    expect(r.calls.map((c) => c.url)).toEqual([pesoOnly.url]);
  });

  test.each([
    ['USDC only', 'usdc-only', true],
    ['USAT only', 'usat-only', true],
    ['USDT only', 'usdt-only', false],
    ['an accept on a testnet that names a mainnet asset', 'testnet', false],
    ['an asset nobody has heard of', 'unknown-asset', false],
    ['a description that says it creates something', 'describes-action', false],
  ] as const)('a seller that offers %s is %s', async (_name, how, payable) => {
    const [a] = many('buy', 1);
    const r = await runOnce([a!], { scanHow: () => how });
    expect(r.calls.length).toBe(payable ? 1 : 0);
  });

  test('a capability id that says it creates something keeps an otherwise innocent route from being paid', async () => {
    const r = await runOnce([endpoint('buy', 1, { capabilityId: 'browser.sessions.create' })]);
    expect(r.calls).toEqual([]);
  });

  test('a caller can add its own rule for who may be paid', async () => {
    const [a, b] = many('buy', 2);
    const r = await runOnce([a!, b!], { maxPaidPerRun: 10, deps: { payable: (e) => e.url === b!.url } });
    expect(r.calls.map((c) => c.url)).toEqual([b!.url]);
  });

  test('the same endpoint discovered twice is scanned once and paid once', async () => {
    const [a] = many('buy', 1);
    const r = await runOnce([a!, { ...a! }, { ...a!, url: a!.url.replace('gateway.usebuy.ai', 'GATEWAY.usebuy.AI') }], { maxPaidPerRun: 10 });
    expect(r.scanned).toHaveLength(1);
    expect(r.calls).toHaveLength(1);
  });
});

describe('runBatch: sellers nobody asked us to look at', () => {
  test('are paid at most three times each, across consecutive runs that share state', async () => {
    const [seller] = many('unsolicited', 1);
    let paid = 0;
    let attempts = 0;
    for (let run = 0; run < 5; run++) {
      const r = await runOnce([seller!], { maxPaidPerRun: 5 });
      paid += r.result.paid;
      attempts += r.calls.length;
      world.time += HOUR;
    }
    expect(paid).toBe(3);
    expect(attempts).toBe(3); // from the fourth run on, nothing is even offered to the payer
    const state = await loadSpendState(world.store);
    expect(state.settlementsBySeller[keyOf(seller!, 'unsolicited')]).toBe(3);
  });

  test('the ones paid least so far come first', async () => {
    const [seasoned, fresh] = byKey(many('unsolicited', 2)); // the seasoned one would win a tie, so only the count puts the fresh one first
    await world.store.write('state/spend.json', JSON.stringify({ totalUsd: 0.01, byEndpointDay: {}, settlementsBySeller: { [keyOf(seasoned!, 'unsolicited')]: 2 } }));
    const r = await runOnce([seasoned!, fresh!], { maxPaidPerRun: 1 });
    expect(r.calls.map((c) => c.url)).toEqual([fresh!.url]);
  });

  test('one seller with many endpoints is paid once a run, so the evidence is spread over sellers', async () => {
    const [a, b, c] = [endpoint('unsolicited', 1), endpoint('unsolicited', 1, { url: 'https://u1x.example/api/other' }), endpoint('unsolicited', 1, { url: 'https://u1x.example/api/third' })];
    const other = endpoint('unsolicited', 2);
    const r = await runOnce([a, b, c, other], { maxPaidPerRun: 10 });
    expect(r.calls).toHaveLength(2);
    expect(new Set(r.calls.map((x) => new URL(x.url).hostname)).size).toBe(2);
  });

  test('a seller that opted out, or whose scan was refused, is never paid', async () => {
    const unsafe = endpoint('unsolicited', 1, { url: 'http://u1x.example/api/data' });
    const optedOut = endpoint('unsolicited', 2);
    const r = await runOnce([unsafe, optedOut], { maxPaidPerRun: 10, scanHow: (e) => (e.url === optedOut.url ? 'opted-out' : 'ok') });
    expect(r.calls).toEqual([]);
    expect(r.result.scanned).toBe(2);
  });
});

describe('runBatch: what it writes', () => {
  test('files hold no host, URL, payee address or agent id of a seller nobody asked us to look at: every file is searched', async () => {
    const sellers = many('unsolicited', 12);
    const list = [...many('fixture', 3), ...many('buy', 3), ...sellers];
    let paidUnsolicited = 0;
    for (let run = 0; run < 4; run++) {
      const r = await runOnce(list, { maxPaidPerRun: 5, cursor: { nextId: String(100 + run) } });
      paidUnsolicited += r.calls.filter((c) => c.stage === 'unsolicited').length;
      world.time += HOUR;
    }
    expect(paidUnsolicited).toBeGreaterThan(0); // the search below means nothing if none was paid

    const files = await everything();
    const text = Object.values(files).join('\n');
    const lower = text.toLowerCase();
    for (const s of sellers) {
      const host = new URL(s.url).hostname;
      expect(text, `host ${host}`).not.toContain(host);
      expect(text, `url ${s.url}`).not.toContain(s.url);
      expect(lower, `payTo of ${host}`).not.toContain(payToFor(s.url).slice(2).toLowerCase());
      expect(text, `agent id ${s.agentId}`).not.toContain(s.agentId!);
    }
    expect(text).not.toMatch(/u\d+x\.example/);

    // what is there: aggregate files, state keyed by hash or by public host, and runs for our own endpoints only
    expect(Object.keys(files).sort()).toEqual(expect.arrayContaining(['state/discovery.json', 'state/rotation.json', 'state/spend.json', 'summary.json']));
    const spend = SpendStateSchema.parse(JSON.parse(files['state/spend.json']!));
    for (const key of Object.keys(spend.settlementsBySeller)) expect(key).toMatch(/^([0-9a-f]{16}|gateway\.usebuy\.ai|fixtures\.example)$/);
    for (const key of Object.keys(spend.byEndpointDay)) expect(key.split('|')[0]).toMatch(/^([0-9a-f]{16}|gateway\.usebuy\.ai|fixtures\.example)$/);
    const runPaths = Object.keys(files).filter((p) => p.startsWith('runs/'));
    expect(runPaths.length).toBeGreaterThan(0);
    for (const p of runPaths) expect(['fixture', 'buy']).toContain(RunRecordSchema.parse(JSON.parse(files[p]!)).kind);
  });

  test('a run record is written for each fixture or buy payment, under its own id, and read back valid', async () => {
    const [f] = many('fixture', 1);
    const [b] = many('buy', 1);
    const r = await runOnce([f!, b!], { maxPaidPerRun: 2 });
    const paths = await world.store.list('runs/');
    expect(paths).toHaveLength(2);
    const parsed = await Promise.all(paths.map(async (p) => RunRecordSchema.parse(JSON.parse((await world.store.read(p))!))));
    expect(parsed.map((x) => x.kind).sort()).toEqual(['buy', 'fixture']);
    for (const run of parsed) expect(paths).toContain(`runs/${run.id}.json`);
    expect(r.result.wrote).toEqual(expect.arrayContaining(paths));
  });

  test('a run record that is not valid is not written, whatever it carries', async () => {
    const [b] = many('buy', 1);
    const r = await runOnce([b!], { payer: { stray: true } });
    expect(await world.store.list('runs/')).toEqual([]);
    expect(r.result).toMatchObject({ paid: 1, failed: 1 }); // the money moved, so it is counted, and so is the record that was refused
  });

  test('the summary counts what was scanned except our own fixtures, and counts a confirmed seller as a confirmed probe', async () => {
    const r = await runOnce([...many('fixture', 3), ...many('buy', 2), ...many('unsolicited', 2)], { maxPaidPerRun: 3 });
    const summary = ScanSummarySchema.parse(JSON.parse((await world.store.read('summary.json'))!));
    expect(summary.endpointsScanned).toBe(4);
    expect(summary.confirmedProbes).toBe(2); // the buy route and the seller that were paid; the fixture does not count
    expect(summary.generatedAt).toBe(new Date(world.time).toISOString());
    expect(r.result.scanned).toBe(7);
  });

  test('result.wrote lists each path once, sorted', async () => {
    const r = await runOnce([...many('fixture', 2), ...many('buy', 2)], { maxPaidPerRun: 4 });
    expect(r.result.wrote).toEqual([...new Set(r.result.wrote)].sort());
    expect(r.result.wrote).toEqual(expect.arrayContaining(['state/spend.json', 'state/discovery.json', 'state/rotation.json', 'summary.json']));
    expect(r.result.wrote.filter((p) => p.startsWith('runs/'))).toHaveLength(4);
  });

  test('the spend state is saved after every payment and before the record of it, so a run that dies in the middle still remembers what it spent', async () => {
    let recordsWritten = 0;
    const failing: DataStore = {
      read: (p) => world.store.read(p),
      list: (p) => world.store.list(p),
      write: async (p, c) => {
        if (p.startsWith('runs/') && ++recordsWritten === 3) throw new Error('disk full');
        return world.store.write(p, c);
      },
    };
    await expect(runOnce(many('buy', 5), { store: failing, maxPaidPerRun: 5 })).rejects.toThrow('disk full');
    const saved = await loadSpendState(world.store);
    expect(saved.totalUsd).toBeCloseTo(0.015, 6); // three payments, including the one whose record could not be written
  });
});

describe('runBatch: state', () => {
  test('the discovery cursor starts at zero, is handed to discover, and the new one is saved for the next run', async () => {
    const first = await runOnce(many('buy', 1), { cursor: { nextId: '4321' } });
    expect(first.cursors).toEqual([{ nextId: '0' }]);
    expect(DiscoveryStateSchema.parse(JSON.parse((await world.store.read('state/discovery.json'))!))).toEqual({ nextId: '4321' });
    world.time += HOUR;
    const second = await runOnce(many('buy', 1));
    expect(second.cursors).toEqual([{ nextId: '4321' }]);
  });

  test('the spend state on disk is exactly the ledger afterwards, and valid', async () => {
    const r = await runOnce([...many('fixture', 1), ...many('buy', 1), ...many('unsolicited', 1)], { maxPaidPerRun: 3 });
    const saved = SpendStateSchema.parse(JSON.parse((await world.store.read('state/spend.json'))!));
    expect(saved).toEqual(r.ledger.snapshot());
    expect(saved.totalUsd).toBeCloseTo(0.015, 6);
  });

  test('missing state is a fresh start; unreadable or invalid state refuses the run, because the caps cannot be enforced without it', async () => {
    expect(await loadSpendState(world.store)).toEqual({ totalUsd: 0, byEndpointDay: {}, settlementsBySeller: {} });
    expect(await loadDiscoveryState(world.store)).toEqual({ nextId: '0' });
    expect(await loadRotationState(world.store)).toEqual({ lastTried: {} });
    for (const [path, load] of [['state/spend.json', loadSpendState], ['state/discovery.json', loadDiscoveryState], ['state/rotation.json', loadRotationState]] as const) {
      for (const bad of ['{not json', '[]', '{"extra":1}', 'null']) {
        await world.store.write(path, bad);
        await expect(load(world.store), `${path} ${bad}`).rejects.toThrow(/refusing/);
      }
      await world.store.write(path, '');
      await expect(load(world.store)).rejects.toThrow(/refusing/);
      await rm(join(world.dir, path));
    }
  });

  test('a run whose state is invalid does nothing at all: nothing is discovered, scanned, paid or written', async () => {
    await world.store.write('state/discovery.json', '{"nextId": "not a number"}');
    const before = await everything();
    const deps: Partial<BatchDeps> = { discover: async () => Promise.reject(new Error('should not be called')) };
    await expect(runOnce(many('buy', 2), { deps })).rejects.toThrow(/refusing/);
    expect(await everything()).toEqual(before);
  });
});

describe('runBatch: limits', () => {
  test('two runs started at the same moment on one ledger never spend more than the event cap', async () => {
    const policy = { ...DEFAULT_POLICY, eventMaxUsd: 0.02 }; // four payments of half a cent
    const ledger = new SpendLedger(policy, { totalUsd: 0, byEndpointDay: {}, settlementsBySeller: {} });
    const otherDir = await mkdtemp(join(tmpdir(), 'railwalker-batch-b-'));
    const other = new FileDataStore(otherDir);
    try {
      const [a, b] = await Promise.all([
        runOnce(many('buy', 8), { ledger, maxPaidPerRun: 8, payer: { delay: true } }),
        runOnce(many('buy', 8, 100), { ledger, store: other, maxPaidPerRun: 8, payer: { delay: true } }),
      ]);
      expect(a.result.paid + b.result.paid).toBe(4);
      expect(ledger.snapshot().totalUsd).toBeCloseTo(0.02, 6);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  test('budgetMs stops the scan loop: no new scan starts once the time is up, and the summary is still written', async () => {
    const r = await runOnce(many('buy', 50), { scanConcurrency: 1, scanTakesMs: 10, budgetMs: 35 });
    expect(r.scanned.length).toBeGreaterThanOrEqual(3);
    expect(r.scanned.length).toBeLessThanOrEqual(5);
    expect(r.result.scanned).toBe(r.scanned.length);
    expect(await world.store.read('summary.json')).not.toBeNull();
    expect(r.calls).toEqual([]); // the time was spent scanning: nothing is paid after it ran out
  });

  test('budgetMs also stops the paying: no payment starts once the time is up', async () => {
    const r = await runOnce(many('buy', 10), { maxPaidPerRun: 10, budgetMs: 250, payer: { takesMs: 100 } });
    expect(r.result.paid).toBe(3);
  });

  test('scanConcurrency bounds how many scans are in flight, and uses it', async () => {
    const r = await runOnce(many('buy', 24), { scanConcurrency: 3, maxPaidPerRun: 0 });
    expect(r.peak()).toBeLessThanOrEqual(3);
    expect(r.peak()).toBeGreaterThan(1);
    expect(r.result.scanned).toBe(24);
  });

  test('however high scanConcurrency is set, no more than 32 scans run at once', async () => {
    const r = await runOnce(many('buy', 100), { scanConcurrency: 1000, maxPaidPerRun: 0 });
    expect(r.peak()).toBeLessThanOrEqual(32);
    expect(r.result.scanned).toBe(100);
  });

  test('a run without a salt is refused: the files could not keep sellers unrecognisable', async () => {
    await expect(runOnce(many('buy', 1), { deps: { salt: '' } })).rejects.toThrow(/salt/);
    expect(await everything()).toEqual({});
  });

  test.each([[0], [-4], [Number.NaN]])('a scanConcurrency of %f still scans, one at a time', async (scanConcurrency) => {
    const r = await runOnce(many('buy', 5), { scanConcurrency, maxPaidPerRun: 0 });
    expect(r.result.scanned).toBe(5);
    expect(r.peak()).toBe(1);
  });
});

describe('runBatch: when things go wrong', () => {
  test('a scan that throws is skipped and counted, and the others carry on', async () => {
    const list = many('buy', 4);
    const r = await runOnce(list, { maxPaidPerRun: 10, scanThrows: (e) => e.url === list[1]!.url });
    expect(r.result).toMatchObject({ scanned: 3, failed: 1, paid: 3 });
    expect(r.calls.map((c) => c.url)).not.toContain(list[1]!.url);
  });

  test('a payment that throws is counted, the run carries on, and the spend so far is saved', async () => {
    const list = many('buy', 3);
    const r = await runOnce(list, { maxPaidPerRun: 10, payer: { throws: (e) => e.url === list[0]!.url } });
    expect(r.result).toMatchObject({ failed: 1, paid: 2 });
    expect(SpendStateSchema.parse(JSON.parse((await world.store.read('state/spend.json'))!)).totalUsd).toBeCloseTo(0.01, 6);
  });

  test('a discovery that fails fails the run: there is nothing to look at', async () => {
    await expect(runOnce([], { deps: { discover: async () => Promise.reject(new Error('buy is down')) } })).rejects.toThrow('buy is down');
  });

  test('nothing discovered is a valid run: an empty summary, no payments', async () => {
    const r = await runOnce([]);
    expect(r.result).toMatchObject({ scanned: 0, paid: 0 });
    expect(ScanSummarySchema.parse(JSON.parse((await world.store.read('summary.json'))!)).endpointsScanned).toBe(0);
  });
});

describe('runBatch: dry run', () => {
  test('selects what it would pay, in the same order, and pays and writes nothing', async () => {
    const fixtures = many('fixture', 2);
    const buys = many('buy', 2);
    const sellers = many('unsolicited', 2);
    const r = await runOnce([...fixtures, ...buys, ...sellers], { maxPaidPerRun: 4, deps: { dryRun: true } });
    expect(r.calls).toEqual([]);
    expect(await world.store.list('')).toEqual([]);
    expect(r.result).toMatchObject({ scanned: 6, paid: 0, wrote: [] });
    expect(r.result.plan).toEqual([
      { stage: 'fixture', label: `GET ${fixtures[0]!.url}` },
      { stage: 'buy', label: `POST ${buys[0]!.url}` },
      { stage: 'unsolicited', label: `seller ${keyOf(byKey(sellers)[0]!, 'unsolicited')}` },
      { stage: 'fixture', label: `GET ${fixtures[1]!.url}` },
    ]);
    expect(JSON.stringify(r.result)).not.toMatch(/u\d+x\.example/); // a plan can end up in a public log
  });

  test('a plan is not made on a normal run', async () => {
    expect((await runOnce(many('buy', 1))).result.plan).toBeUndefined();
  });
});
