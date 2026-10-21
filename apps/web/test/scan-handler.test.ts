import { describe, expect, test } from 'vitest';
import { fakeFetch, v2MultiAssetChallenge } from '@railwalker/testkit';
import { scanEndpoint, type CheckReport, type ScanRequest } from '@railwalker/scanner';
import { tokenBucket } from '../lib/rate-limit';
import { MAX_BODY_LENGTH, MAX_URL_LENGTH, clientKey, createScanHandler } from '../lib/scan-handler';

const SELLER = 'https://seller.example/api/data';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };

/** The real scanner against a fake network. */
const realScan = (fetchImpl: typeof fetch) => (req: ScanRequest) =>
  scanEndpoint({ fetchImpl, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 'test' }, req);
const sellerFetch = () => fakeFetch({ [SELLER]: () => new Response('{}', { status: 402, headers: { 'payment-required': b64(v2MultiAssetChallenge), ...CORS } }) });

function setup(over: { scan?: (req: ScanRequest) => Promise<CheckReport>; clock?: { now: () => number } } = {}) {
  const calls: ScanRequest[] = [];
  const inner = over.scan ?? realScan(sellerFetch());
  const clock = over.clock ?? { now: () => 1_000_000 };
  const limiter = tokenBucket({ capacity: 10, refillPerSec: 10 / 60, now: clock.now });
  const handler = createScanHandler({
    scan: async (req) => {
      calls.push(req);
      return inner(req);
    },
    limiter,
  });
  const get = (qs: string, headers: Record<string, string> = {}, method = 'GET') => handler(new Request(`https://railwalker.example/api/scan${qs ? `?${qs}` : ''}`, { method, headers }));
  return { get, calls };
}
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

describe('GET /api/scan', () => {
  test('a valid URL returns the report as JSON, exactly as the scanner made it', async () => {
    const s = setup();
    const res = await s.get(q({ url: SELLER }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const report = (await res.json()) as CheckReport;
    expect(report.verdicts.map((v) => [v.assetSymbol, v.kind, v.basis])).toEqual([['USDC', 'PASS', 'PREDICTED'], ['USDT', 'PASS', 'PREDICTED'], ['USAT', 'PASS', 'PREDICTED']]);
    expect(s.calls).toEqual([{ url: SELLER, method: 'GET' }]);
  });

  test('hostile input is a RESULT, not a crash: https://127.0.0.1/ is a 200 with a SKIPPED:unsafe_url verdict', async () => {
    const s = setup();
    const res = await s.get(q({ url: 'https://127.0.0.1/' }));
    expect(res.status).toBe(200);
    const report = (await res.json()) as CheckReport;
    expect(report.verdicts[0]).toMatchObject({ kind: 'SKIPPED', code: 'unsafe_url' });
  });

  test('responses are never cached, never sniffed', async () => {
    const res = await setup().get(q({ url: SELLER }));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  describe('bad requests are 400 with a reason, and nothing is scanned', () => {
    test.each([
      ['no url', '', /url is required/],
      ['an empty url', 'url=', /url is required/],
      ['two urls', 'url=https://a.example&url=https://b.example', /url must be given once/],
      ['a url that is too long', `url=https://a.example/${'x'.repeat(MAX_URL_LENGTH)}`, /url is too long/],
      ['a method that is not GET or POST', `${q({ url: SELLER, method: 'DELETE' })}`, /method must be GET or POST/],
      ['a body without POST', `${q({ url: SELLER, body: '{"a":1}' })}`, /body needs method POST/],
      ['a body that is not JSON', `${q({ url: SELLER, method: 'POST', body: '{nope' })}`, /body must be valid JSON/],
      ['a body that is too long', `${q({ url: SELLER, method: 'POST', body: JSON.stringify({ x: 'y'.repeat(MAX_BODY_LENGTH) }) })}`, /body is too long/],
      ['two methods', `${q({ url: SELLER })}&method=GET&method=POST`, /method must be given once/],
    ])('%s', async (_name, qs, message) => {
      const s = setup();
      const res = await s.get(qs);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(message);
      expect(s.calls).toEqual([]);
    });
  });

  test('method and the parsed JSON body reach the scan', async () => {
    const s = setup();
    await s.get(q({ url: SELLER, method: 'post', body: '{"query":"test","n":[1,2]}' }));
    expect(s.calls).toEqual([{ url: SELLER, method: 'POST', body: { query: 'test', n: [1, 2] } }]);
  });

  test('only GET is served: anything else is 405 with Allow', async () => {
    const s = setup();
    const res = await s.get(q({ url: SELLER }), {}, 'POST');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    expect(s.calls).toEqual([]);
  });

  describe('rate limit: ten a minute per client', () => {
    test('the 11th request from one IP is a 429 with retry-after, and is not scanned', async () => {
      const s = setup();
      const headers = { 'x-forwarded-for': '1.2.3.4' };
      for (let i = 0; i < 10; i++) expect((await s.get(q({ url: SELLER }), headers)).status).toBe(200);
      const res = await s.get(q({ url: SELLER }), headers);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('6');
      expect(((await res.json()) as { error: string; retryAfterSec: number })).toEqual({ error: 'rate limited', retryAfterSec: 6 });
      expect(s.calls).toHaveLength(10);
    });

    test('other IPs are unaffected, and only the first hop of x-forwarded-for counts', async () => {
      const s = setup();
      for (let i = 0; i < 10; i++) await s.get(q({ url: SELLER }), { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
      expect((await s.get(q({ url: SELLER }), { 'x-forwarded-for': '1.2.3.4, 10.9.9.9' })).status).toBe(429);
      expect((await s.get(q({ url: SELLER }), { 'x-forwarded-for': '5.6.7.8' })).status).toBe(200);
    });

    test('a request with a bad query still costs a token: probing the parser is not free', async () => {
      const s = setup();
      for (let i = 0; i < 10; i++) expect((await s.get('', { 'x-forwarded-for': '1.2.3.4' })).status).toBe(400);
      expect((await s.get(q({ url: SELLER }), { 'x-forwarded-for': '1.2.3.4' })).status).toBe(429);
    });

    test('the allowance comes back with time', async () => {
      let now = 1_000_000;
      const s = setup({ clock: { now: () => now } });
      for (let i = 0; i < 11; i++) await s.get(q({ url: SELLER }), { 'x-forwarded-for': '1.2.3.4' });
      now += 6_000;
      expect((await s.get(q({ url: SELLER }), { 'x-forwarded-for': '1.2.3.4' })).status).toBe(200);
    });
  });

  test('a scan that blows up is a generic 500: the message never reaches the client', async () => {
    const s = setup({
      scan: async () => {
        throw new Error('internal: /srv/secret/path and API_KEY=abc');
      },
    });
    const res = await s.get(q({ url: SELLER }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'scan failed' });
    expect(text).not.toContain('secret');
  });

  describe('what a hostile target can and cannot put in the response', () => {
    test('the headers and body of a target that is not x402 never appear', async () => {
      const f = fakeFetch({ [SELLER]: () => new Response('SECRET-BODY-TEXT <script>alert(1)</script>', { status: 200, headers: { 'x-secret': 'SECRET-HEADER-VALUE', 'set-cookie': 'session=SECRET-COOKIE' } }) });
      const text = await (await setup({ scan: realScan(f) }).get(q({ url: SELLER }))).text();
      for (const leak of ['SECRET-BODY-TEXT', 'SECRET-HEADER-VALUE', 'SECRET-COOKIE', '<script>']) expect(text).not.toContain(leak);
      expect(JSON.parse(text).verdicts[0]).toMatchObject({ kind: 'FAIL', code: 'not_x402' });
    });

    test('an oversize report is trimmed to its verdicts and codes, and says so; an ordinary one is never trimmed', async () => {
      const huge = { ...(await realScan(sellerFetch())({ url: SELLER, method: 'GET' })) } as CheckReport;
      huge.findings = Array.from({ length: 400 }, (_, i) => ({ code: 'payto_invalid' as const, severity: 'error' as const, basis: 'PREDICTED' as const, message: `finding ${i} ${'m'.repeat(400)}`, evidence: { payTo: 'p'.repeat(300) } }));
      const trimmed = (await (await setup({ scan: async () => huge }).get(q({ url: SELLER }))).json()) as CheckReport & { truncated?: boolean };
      expect(trimmed.truncated).toBe(true);
      expect(trimmed.challenge).toBeNull();
      expect(trimmed.findings).toHaveLength(100);
      expect(trimmed.findings.every((f) => Object.keys(f.evidence).length === 0)).toBe(true);
      expect(trimmed.verdicts.map((v) => v.kind)).toEqual(huge.verdicts.map((v) => v.kind));

      const ordinary = (await (await setup().get(q({ url: SELLER }))).json()) as { truncated?: boolean; challenge: unknown };
      expect(ordinary.truncated).toBeUndefined();
      expect(ordinary.challenge).not.toBeNull();
    });

    test('a 402 stuffed with megabytes still comes back small', async () => {
      const junk = (n: number) => 'x'.repeat(n);
      const hostile = {
        x402Version: 2,
        resource: { url: junk(50_000), description: junk(50_000) },
        accepts: Array.from({ length: 100 }, () => ({ scheme: 'exact', network: 'eip155:42220', amount: '5000', asset: junk(2000), payTo: junk(2000), maxTimeoutSeconds: 300, extra: { name: junk(2000), list: Array.from({ length: 100 }, () => junk(100)) } })),
        extensions: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`e${i}`, junk(500)])),
      };
      const f = fakeFetch({ [SELLER]: () => new Response('{}', { status: 402, headers: { 'payment-required': b64(hostile) } }) });
      const res = await setup({ scan: realScan(f) }).get(q({ url: SELLER }));
      expect(res.status).toBe(200);
      expect((await res.text()).length).toBeLessThan(120_000);
    });
  });
});

describe('clientKey', () => {
  const key = (headers: Record<string, string>) => clientKey(new Request('https://x.example', { headers }));

  test('is the first hop of x-forwarded-for, trimmed', () => {
    expect(key({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' })).toBe('1.2.3.4');
  });

  test('falls back to x-real-ip, then to one shared key', () => {
    expect(key({ 'x-real-ip': '9.9.9.9' })).toBe('9.9.9.9');
    expect(key({})).toBe('unknown');
  });

  test('is bounded, so a caller cannot grow the table with giant keys', () => {
    expect(key({ 'x-forwarded-for': 'a'.repeat(5000) }).length).toBe(64);
  });
});
