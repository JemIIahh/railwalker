import { describe, expect, test } from 'vitest';
import { fakeFetch, makeAccept, makeChallenge, v2MultiAssetChallenge } from '@railwalker/testkit';
import { defaultScanDeps, scanEndpoint, type ScanDeps } from '../src';

const URL_OK = 'https://seller.example/api/data';
const PUBLIC_IP = ['93.184.216.34'];
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const CORS_OK = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };

const v2Response = (headers: Record<string, string> = CORS_OK, challenge: unknown = v2MultiAssetChallenge) =>
  new Response('{}', { status: 402, headers: { 'content-type': 'application/json', 'payment-required': b64(challenge), ...headers } });

const deps = (fetchImpl: typeof fetch, over: Partial<ScanDeps> = {}): ScanDeps => ({
  fetchImpl,
  resolveHost: async () => PUBLIC_IP,
  isOptedOut: async () => false,
  now: () => new Date('2026-10-22T12:00:00Z'),
  userAgent: 'test-agent',
  ...over,
});
const get = (url = URL_OK) => ({ url, method: 'GET' as const });
const verdictOf = (r: Awaited<ReturnType<typeof scanEndpoint>>) => r.verdicts[0]!;

function countingStream(totalBytes: number, chunkBytes: number, counter: { read: number }): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= totalBytes) return controller.close();
        const n = Math.min(chunkBytes, totalBytes - sent);
        controller.enqueue(new Uint8Array(n).fill(65));
        sent += n;
        counter.read += n;
      },
    },
    { highWaterMark: 0 },
  );
}

describe('scanEndpoint: a healthy seller', () => {
  test('a v2 seller yields per-asset PREDICTED verdicts and no errors', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    const r = await scanEndpoint(deps(f), get());
    expect(r.status).toBe(402);
    expect(r.challenge?.version).toBe(2);
    expect(r.verdicts.map((v) => v.assetSymbol)).toEqual(['USDC', 'USDT', 'USAT']);
    for (const v of r.verdicts) expect(v).toMatchObject({ kind: 'PASS', basis: 'PREDICTED' });
    expect(r.findings.filter((x) => x.severity !== 'info')).toEqual([]);
    expect(r.patches).toEqual([]);
    expect(f.calls).toHaveLength(1);
  });

  test('sends an identifying User-Agent and the CORS probe Origin', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    await scanEndpoint(deps(f), get());
    expect(f.calls[0]!.headers['user-agent']).toBe('test-agent');
    expect(f.calls[0]!.headers['origin']).toBe('https://railwalker.invalid');
  });

  test('POST scan sends the JSON body with content-type application/json; GET sends no body', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    await scanEndpoint(deps(f), { url: URL_OK, method: 'POST', body: { query: 'test' } });
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: '{"query":"test"}' });
    expect(f.calls[0]!.headers['content-type']).toBe('application/json');
    await scanEndpoint(deps(f), get());
    expect(f.calls[1]).toMatchObject({ method: 'GET', body: null });
  });

  test('fixable findings come with patches and the failing asset keeps its verdict', async () => {
    const bad = makeChallenge({ accepts: [makeAccept('wARS')] }); // permit2 route without the sponsorship extension
    const raw = { x402Version: 2, resource: { url: URL_OK }, accepts: [{ scheme: 'exact', network: 'eip155:42220', amount: '1000000000000000000', asset: bad.accepts[0]!.asset, payTo: '0x1111111111111111111111111111111111111111', maxTimeoutSeconds: 300, extra: bad.accepts[0]!.extra }] };
    const f = fakeFetch({ [URL_OK]: () => v2Response(CORS_OK, raw) });
    const r = await scanEndpoint(deps(f), get());
    expect(r.verdicts).toHaveLength(1);
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'permit2_gas_sponsorship_missing', assetSymbol: 'wARS', basis: 'PREDICTED' });
    expect(r.patches.map((p) => p.code)).toContain('permit2_gas_sponsorship_missing');
  });

  test('agentWallet is passed to the lints', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    const r = await scanEndpoint(deps(f), { ...get(), agentWallet: '0x2222222222222222222222222222222222222222' });
    expect(r.findings.map((x) => x.code)).toContain('payto_agent_wallet_mismatch');
  });

  test('the report id is stable for one scan and differs between scans', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    const a = await scanEndpoint(deps(f), get());
    const same = await scanEndpoint(deps(f), get());
    const later = await scanEndpoint(deps(f, { now: () => new Date('2026-10-22T12:00:01Z') }), get());
    expect(a.id).toBe(same.id);
    expect(a.id).not.toBe(later.id);
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
    expect(a.scannedAt).toBe('2026-10-22T12:00:00.000Z');
  });
});

describe('scanEndpoint: not an x402 seller', () => {
  test('200 response -> FAIL not_x402', async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response('{"hello":"world"}', { status: 200 }) });
    const r = await scanEndpoint(deps(f), get());
    expect(r.status).toBe(200);
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'not_x402', basis: 'PREDICTED' });
  });

  test('HTML 402 page -> FAIL not_x402', async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response('<html>Payment required, please log in</html>', { status: 402, headers: { 'content-type': 'text/html' } }) });
    expect(verdictOf(await scanEndpoint(deps(f), get()))).toMatchObject({ kind: 'FAIL', code: 'not_x402' });
  });

  test('a network error is a FAIL with the reason in the evidence, never a throw', async () => {
    const f = fakeFetch({ [URL_OK]: () => { throw new TypeError('fetch failed'); } });
    const r = await scanEndpoint(deps(f), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'not_x402' });
    expect(r.findings[0]!.evidence).toMatchObject({ error: 'fetch failed' });
  });

  test('a host that cannot be resolved is a FAIL, not a throw', async () => {
    const f = fakeFetch({});
    const r = await scanEndpoint(deps(f, { resolveHost: async () => { throw new Error('ENOTFOUND'); } }), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'not_x402' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('scanEndpoint: hostile responses (Review Focus 1)', () => {
  test('5 MB streamed body -> SKIPPED response_too_large and the body is never fully read', async () => {
    const counter = { read: 0 };
    const f = fakeFetch({ [URL_OK]: () => new Response(countingStream(5 * 1024 * 1024, 64 * 1024, counter), { status: 402 }) });
    const r = await scanEndpoint(deps(f), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'response_too_large' });
    expect(counter.read).toBeLessThanOrEqual(256 * 1024 + 64 * 1024);
  });

  test('a declared Content-Length over the cap is refused without reading anything', async () => {
    const counter = { read: 0 };
    const f = fakeFetch({ [URL_OK]: () => new Response(countingStream(5 * 1024 * 1024, 64 * 1024, counter), { status: 402, headers: { 'content-length': String(5 * 1024 * 1024) } }) });
    const r = await scanEndpoint(deps(f), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'response_too_large' });
    expect(counter.read).toBe(0);
  });

  test('a never-ending stream aborts at the timeout -> FAIL challenge_timeout', async () => {
    const hang = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }, { highWaterMark: 0 });
    const f = fakeFetch({ [URL_OK]: () => new Response(hang, { status: 402 }) });
    const started = Date.now();
    const r = await scanEndpoint(deps(f, { timeoutMs: 50 }), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'challenge_timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a server that never answers aborts at the timeout -> FAIL challenge_timeout', async () => {
    const f = fakeFetch({ [URL_OK]: () => new Promise<Response>(() => {}) });
    const r = await scanEndpoint(deps(f, { timeoutMs: 50 }), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'challenge_timeout' });
  });
});

describe('scanEndpoint: SSRF (Review Focus 2)', () => {
  test.each(['https://evil.com@127.0.0.1/', 'https://127.0.0.1/', 'http://seller.example/', 'https://localhost/', 'https://2130706433/', 'not a url'])(
    '%s -> SKIPPED unsafe_url with zero fetches',
    async (url) => {
      const f = fakeFetch({});
      const r = await scanEndpoint(deps(f), get(url));
      expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'unsafe_url' });
      expect(f.calls).toHaveLength(0);
    },
  );

  test('a host that resolves to a private address -> SKIPPED unsafe_url, zero fetches', async () => {
    const f = fakeFetch({});
    const r = await scanEndpoint(deps(f, { resolveHost: async () => ['10.0.0.5'] }), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'unsafe_url' });
    expect(f.calls).toHaveLength(0);
  });

  test('a host with one public and one private address is refused', async () => {
    const f = fakeFetch({});
    const r = await scanEndpoint(deps(f, { resolveHost: async () => ['93.184.216.34', '169.254.169.254'] }), get());
    expect(verdictOf(r).code).toBe('unsafe_url');
  });

  test('redirect to https://internal.test/ whose host resolves to 10.0.0.5 -> SKIPPED redirect_blocked, and no request reaches internal.test', async () => {
    const f = fakeFetch({
      [URL_OK]: () => new Response(null, { status: 302, headers: { location: 'https://internal.test/x' } }),
      'https://internal.test/x': () => {
        throw new Error('must never be fetched');
      },
    });
    const r = await scanEndpoint(deps(f, { resolveHost: async (h) => (h === 'internal.test' ? ['10.0.0.5'] : PUBLIC_IP) }), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'redirect_blocked' });
    expect(f.calls.map((c) => c.url)).toEqual([URL_OK]);
  });

  test('redirect to an http:// or credentialed URL is blocked', async () => {
    for (const location of ['http://seller.example/x', 'https://u:p@seller.example/x', 'https://127.0.0.1/x']) {
      const f = fakeFetch({ [URL_OK]: () => new Response(null, { status: 302, headers: { location } }) });
      const r = await scanEndpoint(deps(f), get());
      expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'redirect_blocked' });
      expect(f.calls).toHaveLength(1);
    }
  });

  test('follows one safe redirect and scans the final challenge', async () => {
    const f = fakeFetch({
      [URL_OK]: () => new Response(null, { status: 307, headers: { location: '/api/v2/data' } }),
      'https://seller.example/api/v2/data': () => v2Response(),
    });
    const r = await scanEndpoint(deps(f), get());
    expect(f.calls.map((c) => c.url)).toEqual([URL_OK, 'https://seller.example/api/v2/data']);
    expect(r.status).toBe(402);
    expect(verdictOf(r).kind).toBe('PASS');
  });

  test('more than two redirects -> SKIPPED redirect_blocked', async () => {
    const f = fakeFetch({
      'https://seller.example/a': () => new Response(null, { status: 302, headers: { location: '/b' } }),
      'https://seller.example/b': () => new Response(null, { status: 302, headers: { location: '/c' } }),
      'https://seller.example/c': () => new Response(null, { status: 302, headers: { location: '/d' } }),
      'https://seller.example/d': () => v2Response(),
    });
    const r = await scanEndpoint(deps(f), get('https://seller.example/a'));
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'redirect_blocked' });
  });
});

describe('scanEndpoint: opt-out', () => {
  test('opted-out host -> SKIPPED opted_out and the seller sees zero requests', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    const r = await scanEndpoint(deps(f, { isOptedOut: async (h) => h === 'seller.example' }), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'opted_out' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('scanEndpoint: CORS and speed', () => {
  test('ACAO * with expose-headers payment-required -> no cors finding', async () => {
    const r = await scanEndpoint(deps(fakeFetch({ [URL_OK]: () => v2Response(CORS_OK) })), get());
    expect(r.findings.map((x) => x.code)).not.toContain('cors_missing');
    expect(r.findings.map((x) => x.code)).not.toContain('cors_header_not_exposed');
  });

  test('no ACAO -> cors_missing (warn) and the verdict is PASS_WITH_WARNINGS', async () => {
    const r = await scanEndpoint(deps(fakeFetch({ [URL_OK]: () => v2Response({}) })), get());
    expect(r.findings.find((x) => x.code === 'cors_missing')?.severity).toBe('warn');
    expect(r.verdicts.every((v) => v.kind === 'PASS_WITH_WARNINGS')).toBe(true);
    expect(r.patches.map((p) => p.code)).toContain('cors_missing');
  });

  test('ACAO but the v2 payment-required header is not exposed -> cors_header_not_exposed', async () => {
    const r = await scanEndpoint(deps(fakeFetch({ [URL_OK]: () => v2Response({ 'access-control-allow-origin': '*' }) })), get());
    expect(r.findings.map((x) => x.code)).toContain('cors_header_not_exposed');
    expect(r.findings.map((x) => x.code)).not.toContain('cors_missing');
  });

  test('a v1 body challenge does not need an exposed header', async () => {
    const v1 = { x402Version: 1, accepts: [{ scheme: 'exact', network: 'celo', maxAmountRequired: '5000', asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', payTo: '0x1111111111111111111111111111111111111111', maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }] };
    const f = fakeFetch({ [URL_OK]: () => new Response(JSON.stringify(v1), { status: 402, headers: { 'access-control-allow-origin': '*' } }) });
    const r = await scanEndpoint(deps(f), get());
    expect(r.findings.map((x) => x.code)).not.toContain('cors_header_not_exposed');
  });

  test('slow challenge (slowMs 20, delay 60) -> challenge_slow (info); a fast one has none', async () => {
    const slow = fakeFetch({ [URL_OK]: async () => { await new Promise((r) => setTimeout(r, 60)); return v2Response(); } });
    const realClock = { now: () => new Date() };
    const r = await scanEndpoint(deps(slow, { slowMs: 20, ...realClock }), get());
    expect(r.findings.find((x) => x.code === 'challenge_slow')?.severity).toBe('info');
    const fast = await scanEndpoint(deps(fakeFetch({ [URL_OK]: () => v2Response() })), get());
    expect(fast.findings.map((x) => x.code)).not.toContain('challenge_slow');
  });
});

describe('scanEndpoint: transport invariants', () => {
  test("fetch is always called with redirect 'manual' and an abort signal, so no hop can skip the checks", async () => {
    const seen: RequestInit[] = [];
    const spy = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push(init ?? {});
      return v2Response();
    }) as typeof fetch;
    await scanEndpoint(deps(spy), get());
    expect(seen[0]).toMatchObject({ redirect: 'manual', method: 'GET' });
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  test('a method other than GET or POST is downgraded to GET: a scan never sends a side-effect verb', async () => {
    const f = fakeFetch({ [URL_OK]: () => v2Response() });
    const r = await scanEndpoint(deps(f), { url: URL_OK, method: 'DELETE' as 'GET' });
    expect(f.calls[0]!.method).toBe('GET');
    expect(r.endpoint.method).toBe('GET');
  });

  test('a URL with credentials is skipped and the report never contains them', async () => {
    const f = fakeFetch({});
    const r = await scanEndpoint(deps(f), get('https://admin:hunter2@seller.example/api'));
    expect(verdictOf(r)).toMatchObject({ kind: 'SKIPPED', code: 'unsafe_url' });
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(JSON.stringify(r)).not.toContain('admin');
    expect(f.calls).toHaveLength(0);
  });

  test('an unparseable URL is never echoed back', async () => {
    const r = await scanEndpoint(deps(fakeFetch({})), get(`not a url ${'x'.repeat(10_000)}`));
    expect(r.endpoint.url).toBe('[unparseable url]');
    expect(JSON.stringify(r).length).toBeLessThan(2_000);
  });

  test('a body that errors mid-stream is a FAIL, never a throw', async () => {
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('{"x402Version":'));
          else controller.error(new TypeError('terminated'));
        },
      },
      { highWaterMark: 0 },
    );
    const f = fakeFetch({ [URL_OK]: () => new Response(broken, { status: 402 }) });
    const r = await scanEndpoint(deps(f), get());
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'not_x402' });
    expect(r.findings[0]!.evidence).toMatchObject({ error: 'terminated' });
  });

  test('a redirect without a Location is just a non-402 answer', async () => {
    const f = fakeFetch({ [URL_OK]: () => new Response(null, { status: 302 }) });
    const r = await scanEndpoint(deps(f), get());
    expect(r.status).toBe(302);
    expect(verdictOf(r)).toMatchObject({ kind: 'FAIL', code: 'not_x402' });
  });

  test('a 303 after a POST is followed as a GET without the body', async () => {
    const f = fakeFetch({
      [URL_OK]: () => new Response(null, { status: 303, headers: { location: '/result' } }),
      'https://seller.example/result': () => v2Response(),
    });
    await scanEndpoint(deps(f), { url: URL_OK, method: 'POST', body: { a: 1 } });
    expect(f.calls[1]).toMatchObject({ method: 'GET', body: null });
    expect(f.calls[1]!.headers['content-type']).toBeUndefined();
  });
});

describe('defaultScanDeps: opt-out lookup', () => {
  const OPT_OUT_URL = 'https://seller.example/.well-known/railwalker-optout';
  const lookup = (res: () => Response | Promise<Response>) => {
    const f = fakeFetch({ [OPT_OUT_URL]: res });
    return { f, d: defaultScanDeps({ fetchImpl: f }) };
  };

  test('a plain-text 200 means opted out, and the lookup identifies itself', async () => {
    const { f, d } = lookup(() => new Response('opt out\n', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    expect(await d.isOptedOut('seller.example')).toBe(true);
    expect(f.calls[0]!.headers['user-agent']).toBe(d.userAgent);
  });

  test('a catch-all 200 text/html page does not count', async () => {
    const { d } = lookup(() => new Response('<html>app</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await d.isOptedOut('seller.example')).toBe(false);
  });

  test('a 404 does not count', async () => {
    const { d } = lookup(() => new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } }));
    expect(await d.isOptedOut('seller.example')).toBe(false);
  });

  test('a redirect is neither followed nor counted', async () => {
    const { f, d } = lookup(() => new Response(null, { status: 301, headers: { location: 'https://elsewhere.example/optout' } }));
    expect(await d.isOptedOut('seller.example')).toBe(false);
    expect(f.calls).toHaveLength(1);
  });

  test('a network error does not count', async () => {
    const { d } = lookup(() => {
      throw new TypeError('fetch failed');
    });
    expect(await d.isOptedOut('seller.example')).toBe(false);
  });

  test("the lookup never lets fetch follow a redirect by itself: that request would skip every SSRF check", async () => {
    const seen: RequestInit[] = [];
    const spy = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response('', { status: 404 });
    }) as typeof fetch;
    await defaultScanDeps({ fetchImpl: spy }).isOptedOut('seller.example');
    expect(seen[0]).toMatchObject({ redirect: 'manual' });
  });

  test('a caller-supplied isOptedOut is kept', async () => {
    const d = defaultScanDeps({ isOptedOut: async () => true });
    expect(await d.isOptedOut('anything.example')).toBe(true);
  });
});

describe('defaultScanDeps', () => {
  test('identifies itself, allows overrides, and sets the documented defaults', () => {
    const d = defaultScanDeps();
    expect(d.userAgent).toBe('Railwalker/0 (+https://github.com/JemIIahh/railwalker)');
    expect(typeof d.resolveHost).toBe('function');
    expect(typeof d.isOptedOut).toBe('function');
    expect(d).toMatchObject({ slowMs: 3000, timeoutMs: 10_000 });
    const custom = defaultScanDeps({ userAgent: 'x', timeoutMs: 5 });
    expect(custom).toMatchObject({ userAgent: 'x', timeoutMs: 5 });
  });
});
