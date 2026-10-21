import { afterEach, describe, expect, test } from 'vitest';
import { loadConfig } from '@railwalker/chain';
import { fakeFetch } from '@railwalker/testkit';
import catalog from './fixtures/buy-catalog-trimmed.json' with { type: 'json' };
import { discoverEndpoints, fixtureEndpoints, type AgentLister, type DiscoverDeps, type DiscoverOptions, type Endpoint } from '../src';

const KEY = `0x${'11'.repeat(32)}` as const;
const cfg = loadConfig({ AGENT_PRIVATE_KEY: KEY, RAILWALKER_NETWORK: 'mainnet', RAILWALKER_ATTRIBUTION_CODE: 'celo_29928c447ace', SELLER_SALT: 'a-long-secret-salt-1234' });
const CATALOG_URL = 'https://gateway.usebuy.ai/v1/catalog';
const buyOk = () => fakeFetch({ [CATALOG_URL]: () => Response.json(catalog) });

/** A registry in which ids 1 to n are registered, each pointing at `agent://<id>`. */
function registryUpTo(n: number): AgentLister {
  return {
    async multicall({ contracts }) {
      return contracts.map((c) => (c.args[0] >= 1n && c.args[0] <= BigInt(n) ? { status: 'success' as const, result: `agent://${c.args[0]}` } : { status: 'failure' as const, error: new Error('nonexistent') }));
    },
  };
}
const registration = (host: string, over: Record<string, unknown> = {}) => ({ x402Support: true, description: 'an agent', services: [{ name: 'web', endpoint: `https://${host}/api` }], ...over });
/** The registration of agent id N lives at agent://N and is for host `a<N>.example`. */
const registrations = async (uri: string): Promise<unknown | null> => registration(`a${uri.replace('agent://', '')}.example`);

function deps(over: Partial<DiscoverDeps> = {}): DiscoverDeps {
  return { fetchImpl: buyOk(), lister: registryUpTo(0), cfg, loadRegistration: async () => null, now: () => 0, ...over };
}
const options = (over: Partial<DiscoverOptions> = {}): DiscoverOptions => ({ nextId: 1n, maxIds: 1000, maxRegistrations: 100, concurrency: 4, budgetMs: 60_000, ...over });
const fixture = (path: string): Endpoint => ({ url: `https://fixtures.example/api/fixtures${path}`, method: 'GET', source: 'fixture', capabilityId: `fixture${path}` });
const hosts = (list: Endpoint[]) => list.map((e) => new URL(e.url).hostname);

describe('discoverEndpoints', () => {
  test('brings together our fixtures, buy’s catalog and the registered agents, in that order of priority', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(3), loadRegistration: registrations }), options({ fixtures: [fixture('/ok')] }));
    expect(found.endpoints.map((e) => e.source)).toEqual(['fixture', 'buy', 'buy', 'buy', 'buy', 'erc8004', 'erc8004', 'erc8004']);
    expect(hosts(found.endpoints).slice(5)).toEqual(['a1.example', 'a2.example', 'a3.example']);
    expect(found.nextId).toBe(4n);
    expect(found.problems).toEqual([]);
  });

  test('an endpoint that two sources both name is described the way the first source describes it', async () => {
    const same: Endpoint = { url: 'https://a1.example/api', method: 'GET', source: 'fixture', capabilityId: 'ours' };
    const found = await discoverEndpoints(deps({ lister: registryUpTo(1), loadRegistration: registrations }), options({ fixtures: [same] }));
    const match = found.endpoints.filter((e) => e.url === 'https://a1.example/api');
    expect(match).toEqual([same]);
  });

  test('buy being down is a problem to report, not a reason to fail: the rest is still found', async () => {
    const down = fakeFetch({ [CATALOG_URL]: () => new Response('down', { status: 503 }) });
    const found = await discoverEndpoints(deps({ fetchImpl: down, lister: registryUpTo(2), loadRegistration: registrations }), options({ fixtures: [fixture('/ok')] }));
    expect(found.endpoints.map((e) => e.source)).toEqual(['fixture', 'erc8004', 'erc8004']);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toMatch(/buy.*503/);
  });

  test('the registry failing is a problem too, and the cursor stays where it was so nothing is skipped', async () => {
    const broken: AgentLister = { multicall: async () => Promise.reject(new Error('rpc down')) };
    const found = await discoverEndpoints(deps({ lister: broken }), options({ nextId: 77n }));
    expect(found.nextId).toBe(77n);
    expect(found.endpoints.map((e) => e.source)).toEqual(['buy', 'buy', 'buy', 'buy']);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toMatch(/registry.*rpc down/);
  });

  test('a registration that cannot be read, or whose reading throws, is skipped and counted; the cursor still moves past it', async () => {
    const load = async (uri: string) => {
      if (uri === 'agent://2') return null;
      if (uri === 'agent://3') throw new Error('boom');
      return registrations(uri);
    };
    const found = await discoverEndpoints(deps({ lister: registryUpTo(4), loadRegistration: load }), options());
    expect(hosts(found.endpoints.filter((e) => e.source === 'erc8004'))).toEqual(['a1.example', 'a4.example']);
    expect(found.problems).toEqual(['2 registrations could not be read']);
    expect(found.nextId).toBe(5n);
  });

  test('one unreadable registration is reported in the singular', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(2), loadRegistration: async (uri) => (uri === 'agent://1' ? null : registrations(uri)) }), options());
    expect(found.problems).toEqual(['1 registration could not be read']);
  });

  test('an agent that does not support x402 contributes nothing, and is still behind the cursor', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(2), loadRegistration: async () => registration('x.example', { x402Support: false }) }), options());
    expect(found.endpoints.filter((e) => e.source === 'erc8004')).toEqual([]);
    expect(found.nextId).toBe(3n);
    expect(found.problems).toEqual([]);
  });

  test('registrations are read a few at a time, never more than the concurrency, and really in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async (uri: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return registrations(uri);
    };
    await discoverEndpoints(deps({ lister: registryUpTo(24), loadRegistration: slow }), options({ concurrency: 3 }));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  test.each([[0], [-2], [Number.NaN]])('a concurrency of %f still reads, one at a time', async (concurrency) => {
    let inFlight = 0;
    let peak = 0;
    const slow = async (uri: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return registrations(uri);
    };
    const found = await discoverEndpoints(deps({ lister: registryUpTo(5), loadRegistration: slow }), options({ concurrency }));
    expect(found.endpoints.filter((e) => e.source === 'erc8004')).toHaveLength(5);
    expect(peak).toBe(1);
  });

  test('however high the concurrency is set, no more than sixteen registrations are read at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async (uri: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return registrations(uri);
    };
    await discoverEndpoints(deps({ lister: registryUpTo(60), loadRegistration: slow }), options({ concurrency: 1000, maxRegistrations: 100 }));
    expect(peak).toBeLessThanOrEqual(16);
  });

  test('at most maxRegistrations are read in a run, and the cursor stops just past the last one read so the rest are read next time', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(10), loadRegistration: registrations }), options({ maxRegistrations: 4 }));
    expect(hosts(found.endpoints.filter((e) => e.source === 'erc8004'))).toEqual(['a1.example', 'a2.example', 'a3.example', 'a4.example']);
    expect(found.nextId).toBe(5n);
    // the next run starts there and carries on
    const next = await discoverEndpoints(deps({ lister: registryUpTo(10), loadRegistration: registrations }), options({ nextId: found.nextId, maxRegistrations: 4 }));
    expect(hosts(next.endpoints.filter((e) => e.source === 'erc8004'))).toEqual(['a5.example', 'a6.example', 'a7.example', 'a8.example']);
    expect(next.nextId).toBe(9n);
  });

  test('when the time is up no further registration is started, and the cursor is just past the last one that was', async () => {
    let clock = 0;
    const slow = async (uri: string) => {
      clock += 100;
      return registrations(uri);
    };
    const found = await discoverEndpoints(deps({ lister: registryUpTo(10), loadRegistration: slow, now: () => clock }), options({ concurrency: 1, budgetMs: 250 }));
    expect(hosts(found.endpoints.filter((e) => e.source === 'erc8004'))).toEqual(['a1.example', 'a2.example', 'a3.example']);
    expect(found.nextId).toBe(4n);
  });

  test('with no time at all nothing is read and the cursor does not move', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(5), loadRegistration: registrations }), options({ nextId: 1n, budgetMs: 0 }));
    expect(found.endpoints.filter((e) => e.source === 'erc8004')).toEqual([]);
    expect(found.nextId).toBe(1n);
  });

  test('when every agent was read the cursor is the registry’s: one past the highest id that exists', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(12), loadRegistration: registrations }), options({ maxRegistrations: 12 }));
    expect(found.nextId).toBe(13n);
    expect(found.endpoints.filter((e) => e.source === 'erc8004').map((e) => e.agentId)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']); // decimal, in id order
  });

  test('an empty registry leaves the cursor alone', async () => {
    const found = await discoverEndpoints(deps({ lister: registryUpTo(0) }), options({ nextId: 40n }));
    expect(found.nextId).toBe(40n);
  });

  test('fixtures are optional, and without any only the other sources are returned', async () => {
    const found = await discoverEndpoints(deps(), options());
    expect(found.endpoints.every((e) => e.source === 'buy')).toBe(true);
  });

  test('a registry walk is limited by maxIds', async () => {
    const seen: bigint[] = [];
    const lister: AgentLister = { multicall: async ({ contracts }) => (contracts.forEach((c) => seen.push(c.args[0])), contracts.map(() => ({ status: 'failure' as const, error: new Error('x') }))) };
    await discoverEndpoints(deps({ lister }), options({ maxIds: 30, nextId: 10n }));
    expect(seen).toHaveLength(30);
    expect(seen[0]).toBe(10n);
  });
});

describe('fixtureEndpoints', () => {
  test('puts each path under the base URL, as a GET endpoint of source fixture, with an id and a description', () => {
    expect(fixtureEndpoints('https://railwalker.example/api/fixtures', ['/ok', '/paid/empty-body'])).toEqual([
      { url: 'https://railwalker.example/api/fixtures/ok', method: 'GET', source: 'fixture', capabilityId: 'fixture/ok', description: 'Railwalker fixture /ok' },
      { url: 'https://railwalker.example/api/fixtures/paid/empty-body', method: 'GET', source: 'fixture', capabilityId: 'fixture/paid/empty-body', description: 'Railwalker fixture /paid/empty-body' },
    ]);
  });

  test('a trailing slash on the base, or none, makes no difference; a bare origin works', () => {
    const a = fixtureEndpoints('https://railwalker.example/api/fixtures/', ['/ok'])[0]!.url;
    const b = fixtureEndpoints('https://railwalker.example/api/fixtures', ['/ok'])[0]!.url;
    expect(a).toBe(b);
    expect(fixtureEndpoints('https://railwalker.example', ['/ok'])[0]!.url).toBe('https://railwalker.example/ok');
    expect(fixtureEndpoints('https://railwalker.example/', ['/ok'])[0]!.url).toBe('https://railwalker.example/ok');
  });

  test('the host is written the one way, so it matches what the scanner and the ledger see', () => {
    expect(fixtureEndpoints('https://RailWalker.Example/api', ['/ok'])[0]!.url).toBe('https://railwalker.example/api/ok');
  });

  test.each([['http://railwalker.example/api'], ['https://localhost/api'], ['https://127.0.0.1/api'], ['https://user:pw@railwalker.example/api'], ['https://railwalker.example:8443/api'], ['not a url'], ['']])('a base of %j is refused: the endpoints would be scanned and paid', (base) => {
    expect(() => fixtureEndpoints(base, ['/ok'])).toThrow(/unsafe URL|invalid/);
  });

  test('a query or fragment on the base is refused, because the paths would end up inside it', () => {
    expect(() => fixtureEndpoints('https://railwalker.example/api?x=1', ['/ok'])).toThrow(/query/);
    expect(() => fixtureEndpoints('https://railwalker.example/api#top', ['/ok'])).toThrow(/query/);
  });

  test.each([[''], ['ok'], ['x/ok'], ['//evil.example/x'], ['/a b'], ['/../escape'], ['/./x'], ['/ok/'], ['/ok?x=1'], ['/ok#frag']])('a path of %j is refused', (path) => {
    expect(() => fixtureEndpoints('https://railwalker.example/api', [path])).toThrow(/path/);
  });

  test('no paths, no endpoints', () => {
    expect(fixtureEndpoints('https://railwalker.example/api', [])).toEqual([]);
  });
});
