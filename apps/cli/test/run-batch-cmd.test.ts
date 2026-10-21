import { describe, expect, test } from 'vitest';
import { ASSETS } from '@railwalker/core';
import { DiscoveryStateSchema, RunRecordSchema, SpendStateSchema, sellerKeyFor } from '@railwalker/data';
import type { Endpoint } from '@railwalker/discovery';
import type { CheckReport } from '@railwalker/scanner';
import { chooseAsset } from '../src/commands/run-batch';
import { FAUCET, MAINNET_ENV, SALT, SEPOLIA_ENV, challengeWith, harness, scanReport } from './harness';

const fixture = (path: string): Endpoint => ({ url: `https://fixtures.example/api/fixtures${path}`, method: 'GET', source: 'fixture', capabilityId: `fixture${path}` });
const buy = (n: number): Endpoint => ({ url: `https://gateway.usebuy.ai/v1/social/x/search-${n}`, method: 'POST', source: 'buy', capabilityId: `x.search.${n}`, bodyTemplate: { query: 'test' } });
const seller = (n: number): Endpoint => ({ url: `https://u${n}x.example/api/data`, method: 'GET', source: 'erc8004', agentId: String(9_900_000 + n) });

const BATCH = ['run-batch', '--data', 'data'];
const json = (text: string | undefined) => JSON.parse(text!);

describe('run-batch: usage', () => {
  test('--data is required', async () => {
    const h = harness();
    expect(await h.run('run-batch')).toBe(2);
    expect(h.err()).toContain('--data');
    expect(h.calls.discover).toEqual([]);
  });

  test('a flag it does not have is refused, not ignored', async () => {
    const h = harness();
    expect(await h.run(...BATCH, '--yes')).toBe(2);
  });

  test.each([
    ['--max-paid', 'many'],
    ['--max-paid', '-1'],
    ['--max-paid', '21'],
    ['--max-paid', '1.5'],
    ['--budget-sec', '9'],
    ['--budget-sec', '3001'],
    ['--budget-sec', 'soon'],
  ])('%s %s is refused as a usage error', async (flag, value) => {
    const h = harness();
    expect(await h.run(...BATCH, flag, value)).toBe(2);
    expect(h.calls.discover).toEqual([]);
  });

  test.each([
    ['--max-paid', '0'],
    ['--max-paid', '20'],
    ['--budget-sec', '10'],
    ['--budget-sec', '3000'],
  ])('the limits themselves are allowed: %s %s', async (flag, value) => {
    const h = harness();
    expect(await h.run(...BATCH, flag, value)).toBe(0);
  });

  test('--data may be absolute, and is otherwise relative to where the command was typed', async () => {
    const absolute = harness();
    await absolute.run('run-batch', '--data', '/var/railwalker/data');
    expect(absolute.calls.openStore).toEqual(['/var/railwalker/data']);
    const relative = harness();
    await relative.run('run-batch', '--data', '../elsewhere');
    expect(relative.calls.openStore).toEqual(['/elsewhere']);
  });

  test('help lists the command', async () => {
    const h = harness();
    expect(await h.run('help')).toBe(0);
    expect(h.out()).toContain('run-batch --data <dir>');
  });

  test('the fixtures URL must be an https URL on a public host, from the flag or the environment', async () => {
    for (const bad of ['http://railwalker.example/api', 'https://localhost/api', 'https://127.0.0.1/api', 'not a url']) {
      const flag = harness();
      expect(await flag.run(...BATCH, '--fixtures', bad), bad).toBe(2);
      const env = harness({ env: { ...MAINNET_ENV, RAILWALKER_FIXTURES_URL: bad } });
      expect(await env.run(...BATCH), bad).toBe(2);
    }
  });

  test('the fixtures URL reaches discovery: the flag wins over the environment, and an empty variable means none', async () => {
    const both = harness({ env: { ...MAINNET_ENV, RAILWALKER_FIXTURES_URL: 'https://from-env.example/api/fixtures' } });
    await both.run(...BATCH, '--fixtures', 'https://from-flag.example/api/fixtures');
    expect(both.calls.discover[0]!.fixturesUrl).toBe('https://from-flag.example/api/fixtures');

    const envOnly = harness({ env: { ...MAINNET_ENV, RAILWALKER_FIXTURES_URL: 'https://from-env.example/api/fixtures' } });
    await envOnly.run(...BATCH);
    expect(envOnly.calls.discover[0]!.fixturesUrl).toBe('https://from-env.example/api/fixtures');

    const empty = harness({ env: { ...MAINNET_ENV, RAILWALKER_FIXTURES_URL: '' } });
    await empty.run(...BATCH);
    expect('fixturesUrl' in empty.calls.discover[0]!).toBe(false);
  });
});

describe('run-batch: refusals', () => {
  test('it pays on Celo mainnet only: on Sepolia it is refused with exit 3, and nothing is looked at', async () => {
    const h = harness({ env: SEPOLIA_ENV });
    expect(await h.run(...BATCH)).toBe(3);
    expect(h.err()).toMatch(/mainnet/);
    expect(h.calls.discover).toEqual([]);
  });

  test('a dry run is allowed on Sepolia, because it pays nothing', async () => {
    const h = harness({ env: SEPOLIA_ENV, found: { endpoints: [buy(1)] } });
    expect(await h.run(...BATCH, '--dry-run')).toBe(0);
    expect(h.calls.confirmThrough).toEqual([]);
  });

  test('a spend state that cannot be read stops the run before anything is discovered, because the caps cannot be enforced without it', async () => {
    const h = harness();
    await h.store.write('state/spend.json', '{nope');
    expect(await h.run(...BATCH)).toBe(3);
    expect(h.err()).toMatch(/refusing/);
    expect(h.calls.discover).toEqual([]);
    expect(h.calls.confirmThrough).toEqual([]);
  });

  test('a wallet balance that cannot be read stops the run: it will not pay without knowing it', async () => {
    const h = harness({ readBalances: async () => Promise.reject(new Error('rpc down')) });
    expect(await h.run(...BATCH)).toBe(1);
    expect(h.err()).toMatch(/could not read the wallet balance \(rpc down\)/);
    expect(h.calls.confirmThrough).toEqual([]);
  });

  test('an invalid configuration is refused like everywhere else', async () => {
    const h = harness({ env: { ...MAINNET_ENV, AGENT_PRIVATE_KEY: 'nope' } });
    expect(await h.run(...BATCH)).toBe(3);
  });
});

describe('run-batch: a run', () => {
  test('scans everything, pays in turn with USAT through one ledger up to --max-paid, and writes through the store', async () => {
    const endpoints = [fixture('/ok'), buy(1), seller(1)];
    const h = harness({ found: { endpoints, cursor: { nextId: '99' } } });
    expect(await h.run(...BATCH, '--max-paid', '2')).toBe(0);

    expect(h.calls.openStore).toEqual(['/work/data']);
    expect(h.calls.scan.map((r) => [r.method, r.url])).toEqual(endpoints.map((e) => [e.method, e.url]));
    expect(h.calls.scan[1]).toMatchObject({ method: 'POST', body: { query: 'test' } }); // buy's body template goes with the scan

    expect(h.calls.confirmThrough.map((c) => [c.opts.stage, c.opts.assets, c.sellerKey])).toEqual([
      ['fixture', ['USAT'], 'fixtures.example'],
      ['buy', ['USAT'], 'gateway.usebuy.ai'],
    ]);
    expect(h.calls.confirmThrough[0]!.ledger).toBe(h.calls.confirmThrough[1]!.ledger); // one ledger for the whole run
    expect(h.calls.confirmThrough[1]!.opts).toMatchObject({ body: { query: 'test' }, optedOut: false, facts: { url: endpoints[1]!.url, method: 'POST', source: 'buy', capabilityId: 'x.search.1', description: 'fixture' } }); // the description is the seller's own, from its challenge

    expect(SpendStateSchema.parse(json(h.store.files.get('state/spend.json'))).totalUsd).toBeCloseTo(0.01, 6);
    expect(DiscoveryStateSchema.parse(json(h.store.files.get('state/discovery.json')))).toEqual({ nextId: '99' });
    expect(h.store.files.has('summary.json')).toBe(true);
    expect(h.store.files.has('state/rotation.json')).toBe(true);
    const runs = [...h.store.files.keys()].filter((p) => p.startsWith('runs/'));
    expect(runs).toHaveLength(2);
    for (const p of runs) RunRecordSchema.parse(json(h.store.files.get(p)));

    expect(h.err()).toMatch(/run-batch: scanned 3, paid 2, failed 0, wrote \d+ files/);
    expect(json(h.out())).toMatchObject({ scanned: 3, paid: 2, failed: 0 });
  });

  test('the ledger starts from the saved spend state, so a run cannot forget what an earlier one spent', async () => {
    const h = harness({ found: { endpoints: [buy(1)] } });
    await h.store.write('state/spend.json', JSON.stringify({ totalUsd: 1, byEndpointDay: {}, settlementsBySeller: {} }));
    await h.run(...BATCH);
    expect(SpendStateSchema.parse(json(h.store.files.get('state/spend.json'))).totalUsd).toBeCloseTo(1.005, 6);
  });

  test('a seller nobody asked us to look at is known by a salted key, and nothing that was written names it', async () => {
    const s = seller(7);
    const h = harness({ found: { endpoints: [s, buy(1)] } });
    await h.run(...BATCH, '--max-paid', '5');
    const call = h.calls.confirmThrough.find((c) => c.opts.stage === 'unsolicited')!;
    expect(call.sellerKey).toBe(sellerKeyFor('unsolicited', 'u7x.example', SALT));
    expect(call.sellerKey).toMatch(/^[0-9a-f]{16}$/);
    const written = [...h.store.files.values()].join('\n') + h.out();
    expect(written).not.toContain('u7x.example');
    expect(written).not.toContain(s.agentId!);
    expect(h.err()).not.toContain('u7x.example'); // the log of a scheduled run is public too
  });

  test('discovery is given the saved cursor, and what it reports of its own trouble is printed without naming anyone', async () => {
    const h = harness({ found: { endpoints: [], problems: ['2 registrations could not be read'] } });
    await h.store.write('state/discovery.json', JSON.stringify({ nextId: '55' }));
    expect(await h.run(...BATCH)).toBe(0);
    expect(h.calls.discover[0]!.cursor).toEqual({ nextId: '55' });
    expect(h.err()).toContain('2 registrations could not be read');
  });

  test('only our own fixtures are exempt: a registered seller whose route has /bad/ in it is still paid', async () => {
    const odd: Endpoint = { ...seller(1), url: 'https://u1x.example/bad/route' };
    const h = harness({ found: { endpoints: [odd] } });
    await h.run(...BATCH);
    expect(h.calls.confirmThrough).toHaveLength(1);
  });

  test('the agent wallet an endpoint was registered with goes to the scan, so a payTo that disagrees with it can be flagged', async () => {
    const wallet = '0x2222222222222222222222222222222222222222';
    const h = harness({ found: { endpoints: [{ ...seller(1), agentWallet: wallet }, { ...seller(2), agentWallet: null }, seller(3)] } });
    await h.run(...BATCH, '--max-paid', '0');
    expect(h.calls.scan.map((r) => r.agentWallet)).toEqual([wallet, null, undefined]);
    expect('agentWallet' in h.calls.scan[2]!).toBe(false);
  });

  test('the time budget is in seconds: --budget-sec 10 stops scanning after about ten of them', async () => {
    let t = Date.UTC(2026, 9, 22, 12, 0, 0);
    const h = harness({ now: () => new Date((t += 1000)), found: { endpoints: Array.from({ length: 60 }, (_, i) => buy(i + 1)) } });
    await h.run(...BATCH, '--budget-sec', '10', '--max-paid', '0');
    expect(h.calls.scan.length).toBeGreaterThanOrEqual(5);
    expect(h.calls.scan.length).toBeLessThanOrEqual(15);
  });

  test('without --budget-sec the budget is ten minutes: a clock that runs a second per tick still scans sixty endpoints', async () => {
    let t = Date.UTC(2026, 9, 22, 12, 0, 0);
    const h = harness({ now: () => new Date((t += 1000)), found: { endpoints: Array.from({ length: 60 }, (_, i) => buy(i + 1)) } });
    await h.run(...BATCH, '--max-paid', '0');
    expect(h.calls.scan).toHaveLength(60);
  });

  test('scans run in parallel, a handful at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const h = harness({
      found: { endpoints: Array.from({ length: 40 }, (_, i) => buy(i + 1)) },
      scan: async (req) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 3));
        inFlight--;
        return scanReport(req.url);
      },
    });
    await h.run(...BATCH, '--max-paid', '0');
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThanOrEqual(8);
  });

  test('our broken fixtures are scanned like everything else but never paid', async () => {
    const h = harness({ found: { endpoints: [fixture('/bad/no-cors'), fixture('/paid/empty-body'), fixture('/ok')] } });
    await h.run(...BATCH, '--max-paid', '10');
    expect(h.calls.scan).toHaveLength(3);
    expect(h.calls.confirmThrough.map((c) => new URL(c.report.endpoint.url).pathname)).toEqual(['/api/fixtures/ok', '/api/fixtures/paid/empty-body']);
  });

  test('USDC is used when there is no USAT, and nothing is paid when the wallet holds neither', async () => {
    const usdc = harness({ found: { endpoints: [buy(1)] }, readBalances: async () => ({ ...FAUCET, USAT: 0n, USDC: 2_000_000n }) });
    await usdc.run(...BATCH);
    expect(usdc.calls.confirmThrough[0]!.opts.assets).toEqual(['USDC']);

    const none = harness({ found: { endpoints: [buy(1), seller(1)] }, readBalances: async () => ({ ...FAUCET, USAT: 0n, USDC: 0n }) });
    expect(await none.run(...BATCH)).toBe(0);
    expect(none.calls.confirmThrough).toEqual([]);
    expect(json(none.out())).toMatchObject({ paid: 0, failed: 0 }); // never offered to the payer, so nothing failed either
    expect(none.store.files.has('summary.json')).toBe(true); // everything was still scanned and summarised
  });

  test('--max-paid 0 scans and summarises without paying', async () => {
    const h = harness({ found: { endpoints: [buy(1), buy(2)] } });
    expect(await h.run(...BATCH, '--max-paid', '0')).toBe(0);
    expect(h.calls.confirmThrough).toEqual([]);
    expect(h.calls.scan).toHaveLength(2);
  });

  test('the default is three payments a run', async () => {
    const h = harness({ found: { endpoints: [...[1, 2, 3, 4, 5].map(buy)] } });
    await h.run(...BATCH);
    expect(h.calls.confirmThrough).toHaveLength(3);
  });

  test('the wallet key and the salt never appear in anything printed', async () => {
    const h = harness({ found: { endpoints: [seller(1), buy(1)] } });
    await h.run(...BATCH);
    expect(h.all()).not.toContain(SALT);
    expect(h.all()).not.toContain(MAINNET_ENV.AGENT_PRIVATE_KEY);
  });
});

describe('run-batch: dry run', () => {
  test('says what it would pay, in order, and pays nothing and writes nothing; a seller nobody asked about is named by its key', async () => {
    const s = seller(3);
    const h = harness({ found: { endpoints: [s, buy(1), fixture('/ok')] } });
    expect(await h.run(...BATCH, '--dry-run', '--max-paid', '3')).toBe(0);
    expect(h.calls.confirmThrough).toEqual([]);
    expect([...h.store.files.keys()]).toEqual([]);
    expect(h.err()).toMatch(/\(dry run\): scanned 3, would pay 3/);
    expect(h.err()).toContain('GET https://fixtures.example/api/fixtures/ok');
    expect(h.err()).toContain('POST https://gateway.usebuy.ai/v1/social/x/search-1');
    expect(h.err()).toContain(`seller ${sellerKeyFor('unsolicited', 'u3x.example', SALT)}`);
    expect(h.all()).not.toContain('u3x.example');
  });
});

describe('chooseAsset', () => {
  const report = async (accepts?: unknown[]): Promise<CheckReport> => scanReport('https://seller.example/api/data', accepts === undefined ? challengeWith('5000') : { x402Version: 2, resource: { url: 'https://seller.example/api/data' }, accepts });
  const offer = (symbol: 'USDC' | 'USDT' | 'USAT', over: Record<string, unknown> = {}) => ({ scheme: 'exact', network: 'eip155:42220', amount: '5000', asset: ASSETS[symbol].address, payTo: '0x1111111111111111111111111111111111111111', maxTimeoutSeconds: 300, extra: { name: ASSETS[symbol].eip712Name, version: ASSETS[symbol].eip712Version }, ...over });
  const wallet = (usat: bigint, usdc: bigint, usdt = 0n) => ({ celo: 0n, USAT: usat, USDC: usdc, USDT: usdt });

  test('prefers USAT, the faucet’s token, when the seller offers it and the wallet holds enough', async () => {
    expect(chooseAsset(await report(), wallet(5000n, 5000n))).toBe('USAT');
  });

  test('falls back to USDC when USAT is not enough, and is null when neither is', async () => {
    expect(chooseAsset(await report(), wallet(4999n, 5000n))).toBe('USDC');
    expect(chooseAsset(await report(), wallet(4999n, 4999n))).toBeNull();
  });

  test('only what the seller offers: a USDC-only seller is paid in USDC even when USAT is held', async () => {
    expect(chooseAsset(await report([offer('USDC')]), wallet(9999n, 5000n))).toBe('USDC');
    expect(chooseAsset(await report([offer('USDC')]), wallet(9999n, 0n))).toBeNull();
  });

  test('USDT is never paid with, however much of it there is', async () => {
    expect(chooseAsset(await report([offer('USDT')]), wallet(0n, 0n, 999_999n))).toBeNull();
  });

  test('an offer on a testnet, or with an amount that is not a whole number, is not an offer', async () => {
    expect(chooseAsset(await report([offer('USAT', { network: 'eip155:11142220' })]), wallet(9999n, 9999n))).toBeNull();
    expect(chooseAsset(await report([offer('USAT', { amount: '0.5' })]), wallet(9999n, 9999n))).toBeNull();
  });

  test('a report without a challenge has nothing to pay', async () => {
    const none = { ...(await report()), challenge: null };
    expect(chooseAsset(none, wallet(9999n, 9999n))).toBeNull();
  });
});
