import { describe, expect, test } from 'vitest';
import { fakeFetch } from '@railwalker/testkit';
import { scanEndpoint } from '@railwalker/scanner';
import { API_KEY, KEY, URL_OK, harness, scanReport } from './harness';

describe('scan', () => {
  test('prints the JSON report of the injected scan and exits 0', async () => {
    const h = harness();
    expect(await h.run('scan', URL_OK)).toBe(0);
    const printed = JSON.parse(h.out());
    expect(printed).toEqual(JSON.parse(JSON.stringify(await scanReport(URL_OK))));
    expect(h.calls.scan).toEqual([{ url: URL_OK, method: 'GET' }]);
  });

  test('stdout is only the JSON, so it can be piped; the human summary goes to stderr', async () => {
    const h = harness();
    await h.run('scan', URL_OK);
    expect(() => JSON.parse(h.out())).not.toThrow();
    expect(h.err()).toMatch(/USDC\s+PASS/);
    expect(h.err()).toContain('PREDICTED');
  });

  test('prints SKIPPED:unsafe_url for https://127.0.0.1/ with exit 0, through the real scanner', async () => {
    const h = harness({
      scan: (req) =>
        scanEndpoint(
          { fetchImpl: fakeFetch({}), resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 't' },
          req,
        ),
    });
    expect(await h.run('scan', 'https://127.0.0.1/')).toBe(0);
    expect(h.err()).toContain('SKIPPED:unsafe_url');
    expect(JSON.parse(h.out()).verdicts[0]).toMatchObject({ kind: 'SKIPPED', code: 'unsafe_url' });
  });

  test('a seller that fails is still exit 0: the tool worked', async () => {
    const h = harness({
      scan: async () => {
        const report = await scanReport(URL_OK);
        return { ...report, verdicts: [{ kind: 'FAIL', code: 'permit2_method_missing', basis: 'PREDICTED', assetSymbol: 'wARS', findings: [] }] };
      },
    });
    expect(await h.run('scan', URL_OK)).toBe(0);
    expect(h.err()).toContain('wARS');
    expect(h.err()).toContain('FAIL:permit2_method_missing');
  });

  test('--method POST --body sends the parsed JSON body', async () => {
    const h = harness();
    expect(await h.run('scan', URL_OK, '--method', 'POST', '--body', '{"q":"test","n":[1,2]}')).toBe(0);
    expect(h.calls.scan).toEqual([{ url: URL_OK, method: 'POST', body: { q: 'test', n: [1, 2] } }]);
  });

  test('the method is case-insensitive', async () => {
    const h = harness();
    await h.run('scan', URL_OK, '--method', 'post');
    expect(h.calls.scan[0]).toMatchObject({ method: 'POST' });
  });

  test.each([
    ['a method that is not GET or POST', ['--method', 'DELETE']],
    ['a body that is not JSON', ['--method', 'POST', '--body', '{nope']],
    ['a body on a GET', ['--body', '{"a":1}']],
  ] as const)('%s is a usage error and nothing is scanned', async (_name, flags) => {
    const h = harness();
    expect(await h.run('scan', URL_OK, ...flags)).toBe(2);
    expect(h.calls.scan).toEqual([]);
    expect(h.err()).not.toBe('');
  });

  test('no URL is a usage error', async () => {
    const h = harness();
    expect(await h.run('scan')).toBe(2);
    expect(h.err()).toMatch(/needs 1 argument/);
  });

  test('scan needs no wallet and no config: it never loads one, never reads a balance, never pays', async () => {
    const h = harness({ env: {} });
    expect(await h.run('scan', URL_OK)).toBe(0);
    expect(h.calls.loadConfig).toBe(0);
    expect(h.calls.readBalances).toBe(0);
    expect(h.calls.confirm).toEqual([]);
    expect(h.calls.register).toEqual([]);
  });

  test('a scan that throws is exit 1 with the reason, never a stack trace and never a secret', async () => {
    const h = harness({
      env: { AGENT_PRIVATE_KEY: KEY, X402_API_KEY: API_KEY },
      scan: async () => {
        throw new Error(`boom with ${KEY} and ${API_KEY}`);
      },
    });
    expect(await h.run('scan', URL_OK)).toBe(1);
    expect(h.err()).toContain('boom');
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(API_KEY);
    expect(h.all()).not.toMatch(/\n\s+at /);
  });

  test('secrets that end up in a report are redacted from the output', async () => {
    const h = harness({
      env: { AGENT_PRIVATE_KEY: KEY, X402_API_KEY: API_KEY },
      scan: async () => {
        const report = await scanReport(URL_OK);
        return { ...report, findings: [{ ...report.findings[0]!, evidence: { leaked: `${KEY} ${API_KEY}` } }] };
      },
    });
    expect(await h.run('scan', URL_OK)).toBe(0);
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(API_KEY);
    expect(h.out()).toContain('[redacted]');
  });
});
