import { afterEach, describe, expect, test, vi } from 'vitest';
import { classifyReadStyle } from '@railwalker/core';
import { REGISTRIES } from '@railwalker/chain';
import { fakeFetch } from '@railwalker/testkit';
import catalog from './fixtures/buy-catalog-trimmed.json' with { type: 'json' };
import { bodyFromSchema, endpointsFromBuyCatalog, fetchBuyCatalog } from '../src';

const capability = (id: string) => catalog.capabilities.find((c) => c.id === id)!;
/** The recorded catalog with one capability changed. */
function withCapability(id: string, change: (c: Record<string, any>) => void): unknown {
  const copy = structuredClone(catalog) as any;
  change(copy.capabilities.find((c: any) => c.id === id));
  return copy;
}
/** One required property, so each rule can be tested on its own. */
const prop = (schema: Record<string, unknown>) => bodyFromSchema({ type: 'object', required: ['v'], properties: { v: schema } });

describe('bodyFromSchema', () => {
  test("buy's x.posts.search schema gives its one required field", () => {
    expect(bodyFromSchema(capability('x.posts.search').inputSchema)).toEqual({ query: 'test' });
  });

  test('the other recorded schemas: nested required objects, an object with nothing required inside, an integer enum', () => {
    expect(bodyFromSchema(capability('monid.x.tikhub.api-v1-twitter-web-fetch-community-info').inputSchema)).toEqual({ queryParams: { community_id: 'test' } });
    expect(bodyFromSchema(capability('monid.x.apify.apidojo-tweet-scraper').inputSchema)).toEqual({ body: {}, maxResults: 1 });
    expect(bodyFromSchema(capability('browser.sessions.create').inputSchema)).toEqual({ durationMinutes: 1 });
  });

  test('only required properties are filled in', () => {
    expect(bodyFromSchema({ type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } })).toEqual({ a: 'test' });
    expect(bodyFromSchema({ type: 'object', properties: { a: { type: 'string' } } })).toEqual({});
    expect(bodyFromSchema({ type: 'object' })).toEqual({});
  });

  test('an example wins over a default, a default over an enum, an enum over the placeholder', () => {
    expect(prop({ type: 'string', example: 'ex', default: 'df', enum: ['en'] })).toEqual({ v: 'ex' });
    expect(prop({ type: 'string', examples: ['first', 'second'], default: 'df' })).toEqual({ v: 'first' });
    expect(prop({ type: 'string', default: 'df', enum: ['en'] })).toEqual({ v: 'df' });
    expect(prop({ type: 'string', enum: ['en', 'other'] })).toEqual({ v: 'en' });
    expect(prop({ type: 'string', const: 'fixed' })).toEqual({ v: 'fixed' });
    expect(prop({ type: 'string' })).toEqual({ v: 'test' });
  });

  test('a default or example that is 0, false, empty or null is still used', () => {
    expect(prop({ type: 'integer', default: 0 })).toEqual({ v: 0 });
    expect(prop({ type: 'boolean', default: false })).toEqual({ v: false });
    expect(prop({ type: 'string', default: '' })).toEqual({ v: '' });
    expect(prop({ type: 'string', default: null })).toEqual({ v: null });
    expect(prop({ type: 'integer', example: 0, default: 7 })).toEqual({ v: 0 });
  });

  test('the placeholder is cut to maxLength and padded to minLength', () => {
    expect(prop({ type: 'string', maxLength: 2 })).toEqual({ v: 'te' });
    expect(prop({ type: 'string', maxLength: 0 })).toEqual({ v: '' });
    expect(prop({ type: 'string', maxLength: -3 })).toEqual({ v: 'test' }); // nonsense limit, ignored
    expect(prop({ type: 'string', minLength: 6 })).toEqual({ v: 'testxx' });
    expect(prop({ type: 'string', minLength: 1, maxLength: 512 })).toEqual({ v: 'test' });
  });

  test('numbers use the minimum, else 1, and stay inside the maximum; integers are whole', () => {
    expect(prop({ type: 'integer', minimum: 5 })).toEqual({ v: 5 });
    expect(prop({ type: 'number', minimum: 0.5 })).toEqual({ v: 0.5 });
    expect(prop({ type: 'integer' })).toEqual({ v: 1 });
    expect(prop({ type: 'number' })).toEqual({ v: 1 });
    expect(prop({ type: 'integer', maximum: 0 })).toEqual({ v: 0 });
    expect(prop({ type: 'integer', minimum: -10, maximum: -5 })).toEqual({ v: -10 });
    expect(prop({ type: 'integer', exclusiveMinimum: 3 })).toEqual({ v: 4 });
    expect(prop({ type: 'integer', minimum: 2.5 })).toEqual({ v: 3 });
    expect(prop({ type: 'integer', maximum: 2.5 })).toEqual({ v: 1 });
    expect(prop({ type: 'integer', minimum: 2, maximum: 2.5 })).toEqual({ v: 2 });
    expect(prop({ type: 'integer', maximum: 0.5 })).toEqual({ v: 0 }); // still a whole number, and inside the limit
    expect(prop({ type: 'number', maximum: 0.5 })).toEqual({ v: 0.5 });
  });

  test('booleans are false and null is null', () => {
    expect(prop({ type: 'boolean' })).toEqual({ v: false });
    expect(prop({ type: 'null' })).toEqual({ v: null });
  });

  test('arrays are empty unless they must have items, and then hold as many as they must', () => {
    expect(prop({ type: 'array', items: { type: 'string' } })).toEqual({ v: [] });
    expect(prop({ type: 'array', minItems: 2, items: { type: 'integer' } })).toEqual({ v: [1, 1] });
    expect(prop({ type: 'array', minItems: 1 })).toEqual({ v: ['test'] });
    expect(prop({ type: 'array', minItems: 1, items: {} })).toEqual({ v: ['test'] });
    const { v } = prop({ type: 'array', minItems: 2, items: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } } }) as { v: object[] };
    expect(v).toEqual([{ x: 'test' }, { x: 'test' }]);
    expect(v[0]).not.toBe(v[1]); // each item is its own object
  });

  test('anyOf and oneOf take the first alternative that is not null; a list of types takes the first that is not null', () => {
    expect(prop({ anyOf: [{ type: 'null' }, { type: 'integer' }] })).toEqual({ v: 1 });
    expect(prop({ oneOf: [{ type: 'boolean' }, { type: 'string' }] })).toEqual({ v: false });
    expect(prop({ anyOf: [{ type: 'null' }] })).toEqual({ v: null });
    expect(prop({ type: ['null', 'string'] })).toEqual({ v: 'test' });
  });

  test('a required property the schema says nothing about gets the placeholder', () => {
    expect(bodyFromSchema({ type: 'object', required: ['a', 'b'], properties: { a: { type: 'integer' } } })).toEqual({ a: 1, b: 'test' });
    expect(prop({})).toEqual({ v: 'test' });
  });

  test('a schema that forgot to say type object or array is read by what it has', () => {
    expect(bodyFromSchema({ required: ['a'], properties: { a: { type: 'integer' } } })).toEqual({ a: 1 });
    expect(prop({ items: { type: 'string' }, minItems: 1 })).toEqual({ v: ['test'] });
  });

  test('required that is not a list of names is ignored, and names that are not text are skipped', () => {
    expect(bodyFromSchema({ type: 'object', required: 'a', properties: { a: { type: 'string' } } })).toEqual({});
    expect(bodyFromSchema({ type: 'object', required: [1, null, { a: 1 }, 'a'], properties: { a: { type: 'string' } } })).toEqual({ a: 'test' });
  });

  test.each([[undefined], [null], ['string'], [42], [true], [[]], [{}]])('%j is not a schema anything can be built from', (schema) => {
    expect(bodyFromSchema(schema)).toBeUndefined();
  });
});

describe('bodyFromSchema: schemas written by a stranger', () => {
  test('nesting is cut off instead of followed for ever', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 200; i++) deep = { type: 'object', required: ['n'], properties: { n: deep } };
    expect(JSON.stringify(bodyFromSchema(deep)).length).toBeLessThan(200);
  });

  test('a schema that contains itself terminates', () => {
    const self: Record<string, any> = { type: 'object', required: ['self'], properties: {} };
    self.properties.self = self;
    expect(JSON.stringify(bodyFromSchema(self)).length).toBeLessThan(300);
  });

  test('a billion required items or characters is not built', () => {
    expect((prop({ type: 'array', minItems: 1_000_000_000, items: { type: 'integer' } }) as { v: unknown[] }).v.length).toBeLessThanOrEqual(3);
    expect((prop({ type: 'string', minLength: 1_000_000_000 }) as { v: string }).v.length).toBeLessThanOrEqual(256);
  });

  test('a huge example is bounded like any other seller-supplied value', () => {
    expect((prop({ type: 'string', example: 'x'.repeat(1_000_000) }) as { v: string }).v.length).toBeLessThanOrEqual(301);
    const wide = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys((prop({ example: wide }) as { v: object }).v).length).toBeLessThanOrEqual(50);
  });

  test('a thousand required names give at most fifty fields', () => {
    const names = Array.from({ length: 1000 }, (_, i) => `f${i}`);
    expect(Object.keys(bodyFromSchema({ type: 'object', required: names, properties: {} }) as object).length).toBeLessThanOrEqual(50);
  });

  test('a __proto__ field is dropped, never assigned', () => {
    const hostile = JSON.parse('{"type":"object","required":["__proto__","ok"],"properties":{"__proto__":{"type":"object","required":["polluted"],"properties":{}},"ok":{"type":"string"}}}');
    const body = bodyFromSchema(hostile) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['ok']);
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('endpointsFromBuyCatalog', () => {
  test('returns the available capabilities, in catalog order, as endpoints that carry their id, body and source', () => {
    const endpoints = endpointsFromBuyCatalog(catalog);
    expect(endpoints.map((e) => e.capabilityId)).toEqual([
      'x.posts.search',
      'browser.sessions.create',
      'monid.x.tikhub.api-v1-twitter-web-fetch-community-info',
      'monid.x.apify.apidojo-tweet-scraper',
    ]); // monid.instagram…hashtag-scraper is not available
    expect(endpoints[0]).toEqual({
      url: 'https://gateway.usebuy.ai/v1/social/x/posts/search',
      method: 'POST',
      source: 'buy',
      capabilityId: 'x.posts.search',
      description: 'Search public X posts by keyword or X search expression.',
      bodyTemplate: { query: 'test' },
      agentId: '9895',
    });
  });

  test('the pay policy can classify what comes out: a search is read-style, creating a browser session is not', () => {
    const byId = Object.fromEntries(endpointsFromBuyCatalog(catalog).map((e) => [e.capabilityId, e]));
    expect(classifyReadStyle(byId['x.posts.search']!).readStyle).toBe(true);
    expect(classifyReadStyle(byId['browser.sessions.create']!).readStyle).toBe(false);
  });

  test('the method comes from the catalog; only GET and POST are endpoints', () => {
    const get = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.method = 'GET')));
    expect(get.find((e) => e.capabilityId === 'x.posts.search')?.method).toBe('GET');
    for (const method of ['DELETE', 'PUT', 'post', '', undefined, 5]) {
      const out = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.method = method)));
      expect(out.map((e) => e.capabilityId), String(method)).not.toContain('x.posts.search');
    }
  });

  test('a capability that is not exactly available: true is skipped', () => {
    for (const available of [false, 'true', 1, null, undefined]) {
      const out = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.available = available)));
      expect(out.map((e) => e.capabilityId), String(available)).not.toContain('x.posts.search');
    }
  });

  test('only buy’s own host is trusted: a capability pointing anywhere else, or not at https, is skipped', () => {
    for (const url of ['https://evil.example/v1/social/x/posts/search', 'http://gateway.usebuy.ai/v1/x', 'https://gateway.usebuy.ai.evil.example/x', 'https://user:pw@gateway.usebuy.ai/x', 'https://gateway.usebuy.ai:8443/x', 'not a url', '', undefined, 7]) {
      const out = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.url = url)));
      expect(out.map((e) => e.capabilityId), String(url)).not.toContain('x.posts.search');
    }
  });

  test('a catalog cannot vouch for its own host: baseUrl is not what is trusted', () => {
    const forged = withCapability('x.posts.search', (c) => (c.url = 'https://evil.example/x')) as Record<string, unknown>;
    forged.baseUrl = 'https://evil.example';
    expect(endpointsFromBuyCatalog(forged).map((e) => e.capabilityId)).not.toContain('x.posts.search');
  });

  test('the agent id is kept only when the capability says it is registered in the mainnet identity registry', () => {
    const registry = (reg: unknown) => endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.agent.agentRegistry = reg))).find((e) => e.capabilityId === 'x.posts.search')!;
    expect(registry(`eip155:42220:${REGISTRIES.mainnet.identity}`).agentId).toBe('9895');
    expect(registry(`eip155:42220:${REGISTRIES.mainnet.identity.toLowerCase()}`).agentId).toBe('9895');
    expect(registry(`eip155:11142220:${REGISTRIES.sepolia.identity}`).agentId).toBeUndefined();
    expect(registry('eip155:1:0x0000000000000000000000000000000000000001').agentId).toBeUndefined();
    expect(registry(undefined).agentId).toBeUndefined();
    expect(registry(`eip155:42220:${REGISTRIES.mainnet.identity}:extra`).agentId).toBeUndefined();
    expect(registry(`cosmos:42220:${REGISTRIES.mainnet.identity}`).agentId).toBeUndefined();
    expect(registry('eip155:42220:0x0000000000000000000000000000000000000001').agentId).toBeUndefined();
    expect(registry(`eip155:11142220:${REGISTRIES.mainnet.identity}`).agentId).toBeUndefined();
  });

  test('an agent id may arrive as a number or as a string of digits', () => {
    const idOf = (agentId: unknown) => endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.agent.agentId = agentId))).find((x) => x.capabilityId === 'x.posts.search')!.agentId;
    expect(idOf(9895)).toBe('9895');
    expect(idOf('9895')).toBe('9895');
    expect(idOf(0)).toBe('0');
  });

  test.each([[-1], [1.5], ['9895; drop table'], [''], ['1'.repeat(100)], [null], [undefined], [{}], [Number.MAX_SAFE_INTEGER + 2]])('an agent id of %j is not kept', (agentId) => {
    const e = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.agent.agentId = agentId))).find((x) => x.capabilityId === 'x.posts.search')!;
    expect(e.agentId).toBeUndefined();
  });

  test('a capability without an id is skipped, and a very long id is cut', () => {
    for (const id of ['', undefined, 5]) {
      const out = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.id = id)));
      expect(out.map((e) => e.url), String(id)).not.toContain('https://gateway.usebuy.ai/v1/social/x/posts/search');
    }
    const long = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.id = 'i'.repeat(5000))))[0]!;
    expect(long.capabilityId!.length).toBeLessThanOrEqual(201);
  });

  test('the description is bounded', () => {
    const e = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => (c.description = 'd'.repeat(5000)))).find((x) => x.capabilityId === 'x.posts.search')!;
    expect(e.description!.length).toBeLessThanOrEqual(301);
  });

  test('something that is not a catalog gives nothing, and never throws', () => {
    for (const bad of [null, undefined, 'x', 42, true, [], {}, { capabilities: 'x' }, { capabilities: {} }, { capabilities: [null, 1, 'x', [], { available: true }] }]) {
      expect(endpointsFromBuyCatalog(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  test('a hostile catalog cannot make a thousand and one endpoints', () => {
    const one = structuredClone(capability('x.posts.search'));
    expect(endpointsFromBuyCatalog({ capabilities: Array.from({ length: 5000 }, () => one) })).toHaveLength(1000);
  });

  test('a capability without an input schema has no body template', () => {
    const e = endpointsFromBuyCatalog(withCapability('x.posts.search', (c) => delete c.inputSchema)).find((x) => x.capabilityId === 'x.posts.search')!;
    expect('bodyTemplate' in e).toBe(false);
  });
});

describe('fetchBuyCatalog', () => {
  const CATALOG_URL = 'https://gateway.usebuy.ai/v1/catalog';
  afterEach(() => vi.useRealTimers());

  test('asks buy for its catalog, says who is asking, never follows a redirect, and returns the parsed JSON', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const spy = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => (requests.push({ url: String(input), init }), Response.json(catalog))) as typeof fetch;
    expect(await fetchBuyCatalog(spy)).toEqual(catalog);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(CATALOG_URL);
    expect(requests[0]!.init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { accept: 'application/json', 'user-agent': expect.stringContaining('Railwalker') } });
  });

  test('an answer that is not 200 is an error that names the status', async () => {
    await expect(fetchBuyCatalog(fakeFetch({ [CATALOG_URL]: () => new Response('down', { status: 503 }) }))).rejects.toThrow(/503/);
  });

  test('the body of an answer it will not read is cancelled, so the connection is released', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => void (cancelled = true) });
    await expect(fetchBuyCatalog(fakeFetch({ [CATALOG_URL]: () => new Response(body, { status: 503 }) }))).rejects.toThrow(/503/);
    expect(cancelled).toBe(true);
  });

  test('a redirect is an error, not a place to go', async () => {
    const f = fakeFetch({ [CATALOG_URL]: () => new Response('', { status: 302, headers: { location: 'https://elsewhere.example/catalog' } }) });
    await expect(fetchBuyCatalog(f)).rejects.toThrow(/302/);
    expect(f.calls).toHaveLength(1);
  });

  test('a body that is not JSON is an error', async () => {
    await expect(fetchBuyCatalog(fakeFetch({ [CATALOG_URL]: () => new Response('<html>maintenance</html>') }))).rejects.toThrow(/not JSON/);
  });

  test('a catalog over 2 MiB is refused rather than buffered', async () => {
    await expect(fetchBuyCatalog(fakeFetch({ [CATALOG_URL]: () => new Response('x'.repeat(3 * 1024 * 1024)) }))).rejects.toThrow(/too large/);
  });

  test('a buy that goes quiet is an error once the deadline passes, and the connection is let go', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const silent = ((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const settled = expect(fetchBuyCatalog(silent)).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(signals[0]?.aborted).toBe(true);
  });

  test('no timer is left running once there is an answer', async () => {
    vi.useFakeTimers();
    await fetchBuyCatalog(fakeFetch({ [CATALOG_URL]: () => Response.json(catalog) }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
