import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { FINDING_ORDER } from '@railwalker/core';
import type { CheckReport } from '@railwalker/scanner';
import { publicReport, publicRun, sellerKeyOf, summarize, ScanSummarySchema } from '../src';
import { payToFor, reportFor, runOf } from './support';

const NOW = new Date('2026-10-22T12:00:00Z');

describe('sellerKeyOf', () => {
  test('is HMAC-SHA256 of the host under the salt, first 16 hex characters', () => {
    const expected = createHmac('sha256', 'a-long-secret-salt-1234').update('seller.example').digest('hex').slice(0, 16);
    expect(sellerKeyOf('seller.example', 'a-long-secret-salt-1234')).toBe(expected);
    expect(sellerKeyOf('seller.example', 'a-long-secret-salt-1234')).toMatch(/^[0-9a-f]{16}$/);
  });

  test('is stable for one salt, and different for another salt or another host', () => {
    const a = sellerKeyOf('seller.example', 'salt-one-aaaaaaaa');
    expect(sellerKeyOf('seller.example', 'salt-one-aaaaaaaa')).toBe(a);
    expect(sellerKeyOf('seller.example', 'salt-two-bbbbbbbb')).not.toBe(a);
    expect(sellerKeyOf('other.example', 'salt-one-aaaaaaaa')).not.toBe(a);
  });

  test('is the same host however it is written: case and a trailing dot do not matter', () => {
    const k = sellerKeyOf('seller.example', 'salt-one-aaaaaaaa');
    expect(sellerKeyOf('SELLER.Example', 'salt-one-aaaaaaaa')).toBe(k);
    expect(sellerKeyOf('seller.example.', 'salt-one-aaaaaaaa')).toBe(k);
  });

  test('does not contain the host', () => {
    expect(sellerKeyOf('seller.example', 'salt-one-aaaaaaaa')).not.toContain('seller');
  });

  test('an empty salt is refused: the key would be a plain hash of a guessable host', () => {
    expect(() => sellerKeyOf('seller.example', '')).toThrow(/salt/);
  });
});

describe('summarize', () => {
  test('counts endpoints that trigger each finding, once per endpoint however often it fires', async () => {
    const noCors = await reportFor('a.example'); // the fixture-like challenge has no output schema
    const reports = [noCors, noCors, await reportFor('b.example')];
    const s = summarize(reports, NOW);
    expect(s.endpointsScanned).toBe(3);
    expect(s.byFinding.no_output_schema).toBe(3);
  });

  test('counts how many endpoints accept each asset on Celo mainnet', async () => {
    const usdcOnly = await reportFor('c.example', { challenge: { x402Version: 2, resource: { url: 'https://c.example/api/data' }, accepts: [{ scheme: 'exact', network: 'eip155:42220', amount: '5000', asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', payTo: payToFor(7), maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }] } });
    const s = summarize([await reportFor('a.example'), usdcOnly], NOW);
    expect(s.assetAcceptance).toEqual({ USDC: 2, USDT: 1, USAT: 1 });
  });

  test('payablePct is the share a policy would let us pay: read-style, priced in a dollar asset, inside the caps', async () => {
    const reports = [
      await reportFor('ok.example'), // $0.005: payable
      await reportFor('cheap.example', { amount: '500' }), // $0.0005: under the unsolicited minimum
      await reportFor('dear.example', { amount: '90000' }), // $0.09: over the per-probe cap
      await reportFor('act.example', { path: '/api/send-payment' }), // does something in the world
    ];
    const s = summarize(reports, NOW);
    expect(s.endpointsScanned).toBe(4);
    expect(s.payablePct).toBe(25);
  });

  test('an endpoint that is not x402 is scanned but never payable', async () => {
    const notX402: CheckReport = { ...(await reportFor('a.example')), challenge: null, status: 200, findings: [], verdicts: [], patches: [] };
    const s = summarize([notX402, await reportFor('b.example')], NOW);
    expect(s).toMatchObject({ endpointsScanned: 2, payablePct: 50 });
  });

  test('confirmedProbes counts reports that carry a CONFIRMED verdict', async () => {
    const plain = await reportFor('a.example');
    const confirmed: CheckReport = { ...plain, verdicts: plain.verdicts.map((v, i) => (i === 0 ? { ...v, basis: 'CONFIRMED' as const } : v)) };
    expect(summarize([plain, confirmed, confirmed], NOW).confirmedProbes).toBe(2);
  });

  test('an empty input is a valid, all-zero summary, stamped with the time given', () => {
    const s = summarize([], NOW);
    expect(s).toEqual({ generatedAt: '2026-10-22T12:00:00.000Z', endpointsScanned: 0, byFinding: {}, assetAcceptance: {}, payablePct: 0, confirmedProbes: 0 });
  });

  test('is always a valid ScanSummary', async () => {
    expect(ScanSummarySchema.safeParse(summarize([await reportFor('a.example'), await reportFor('b.example', { amount: '90000' })], NOW)).success).toBe(true);
  });

  test('PRIVACY: a summary over fifty unsolicited hosts contains no host, URL or payee address', async () => {
    const hosts = Array.from({ length: 50 }, (_, i) => `seller-${i}-${(i * 7919).toString(36)}.example`);
    const reports = await Promise.all(hosts.map((h, i) => reportFor(h, { i: i + 1, path: `/v1/private-path-${i}` })));
    const text = JSON.stringify(summarize(reports, NOW));
    for (const [i, host] of hosts.entries()) {
      expect(text, host).not.toContain(host);
      expect(text, `url ${i}`).not.toContain(`private-path-${i}`);
      expect(text, `payTo ${i}`).not.toContain(payToFor(i + 1).slice(2).toLowerCase());
    }
    expect(text).not.toMatch(/https?:/);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(JSON.parse(text).endpointsScanned).toBe(50);
  });
});

describe('what may be published about one run or report', () => {
  test.each([['fixture'], ['buy']] as const)('a %s run is public, unchanged', (kind) => {
    const run = runOf(kind);
    expect(publicRun(run)).toEqual(run);
  });

  test.each([['customer'], ['unsolicited']] as const)('a %s run is never public', (kind) => {
    expect(publicRun(runOf(kind))).toBeNull();
  });

  test.each([['fixture'], ['buy']] as const)('a %s report is public, unchanged', async (stage) => {
    const report = await reportFor('seller.example');
    expect(publicReport(report, stage)).toEqual(report);
  });

  test.each([['customer'], ['unsolicited']] as const)('a %s report is never public', async (stage) => {
    expect(publicReport(await reportFor('seller.example'), stage)).toBeNull();
  });

  test('the public copy is a copy: changing it does not change the original', () => {
    const run = runOf('fixture');
    const copy = publicRun(run)!;
    copy.steps[0]!.label = 'changed';
    expect(run.steps[0]!.label).not.toBe('changed');
  });
});

describe('summarize: the payable share', () => {
  test('is rounded to one decimal place, so a published summary has no floating-point noise', async () => {
    const reports = [await reportFor('a.example'), await reportFor('b.example', { amount: '90000' }), await reportFor('c.example', { amount: '90000' })];
    expect(summarize(reports, NOW).payablePct).toBe(33.3);
  });

  test('can be all of it, and never more', async () => {
    expect(summarize([await reportFor('a.example'), await reportFor('b.example')], NOW).payablePct).toBe(100);
  });
});

describe('summarize: counting rules', () => {
  const accept = (over: Record<string, unknown> = {}) => ({
    scheme: 'exact',
    network: 'eip155:42220',
    amount: '5000',
    asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    payTo: payToFor(7),
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
    ...over,
  });
  const challengeOf = (accepts: unknown[]) => ({ x402Version: 2, resource: { url: 'https://a.example/api/data' }, accepts });

  test('a finding that fires many times in one report still counts that endpoint once', async () => {
    const report = await reportFor('a.example');
    const finding = report.findings[0]!;
    expect(summarize([{ ...report, findings: [finding, finding, finding, finding] }], NOW).byFinding).toEqual({ [finding.code]: 1 });
  });

  test('an asset offered twice by one endpoint is counted once', async () => {
    const twice = await reportFor('a.example', { challenge: challengeOf([accept(), accept({ payTo: payToFor(8) })]) });
    expect(summarize([twice], NOW).assetAcceptance).toEqual({ USDC: 1 });
  });

  test('an accept on a testnet counts for nothing, even when it names a mainnet asset', async () => {
    const testnet = await reportFor('a.example', { challenge: challengeOf([accept({ network: 'eip155:11142220' })]) });
    const summary = summarize([testnet], NOW);
    expect(summary.assetAcceptance).toEqual({}); // toMatchObject({}) would match anything
    expect(summary.payablePct).toBe(0);
  });

  test('an asset nobody has heard of is not counted, and does not break the summary', async () => {
    const odd = await reportFor('a.example', { challenge: challengeOf([accept({ asset: '0x1234567890123456789012345678901234567890' })]) });
    const summary = summarize([odd], NOW);
    expect(summary.assetAcceptance).toEqual({});
    expect(summary).toMatchObject({ endpointsScanned: 1, payablePct: 0 });
  });

  test('an asset we cannot price in dollars is accepted by the seller but never payable', async () => {
    const pesos = await reportFor('a.example', {
      challenge: challengeOf([accept({ asset: '0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D', amount: '1000000000000000000', extra: { name: 'Peso Argentino', version: '1', assetTransferMethod: 'permit2' } })]),
    });
    const summary = summarize([pesos], NOW);
    expect(summary.assetAcceptance).toEqual({ wARS: 1 });
    expect(summary.payablePct).toBe(0);
  });

  test('an endpoint is payable when any one of its accepts is, even if the others are not', async () => {
    const mixed = await reportFor('a.example', { challenge: challengeOf([accept({ amount: '90000' }), accept({ amount: '5000' })]) });
    expect(summarize([mixed], NOW).payablePct).toBe(100);
  });

  test('the same reports in any order make the same file, byte for byte', async () => {
    const usat = accept({ asset: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', extra: { name: 'Tether America USD', version: '1' } });
    const reports = [
      await reportFor('a.example'),
      await reportFor('b.example', { amount: '90000' }),
      await reportFor('c.example', { path: '/api/send-payment' }),
      await reportFor('d.example', { challenge: challengeOf([usat, accept()]) }), // the assets arrive in another order
    ];
    expect(JSON.stringify(summarize([...reports].reverse(), NOW))).toBe(JSON.stringify(summarize(reports, NOW)));
  });

  test('the finding keys come out in the declared order whatever order the reports arrive in', async () => {
    const noCors = await reportFor('c.example', { cors: false }); // cors_missing
    const free = await reportFor('b.example', { amount: '0' }); // zero_amount, once for each of its three accepts
    const plain = await reportFor('a.example');
    for (const reports of [[free, noCors, plain], [noCors, free, plain], [plain, free, noCors], [plain, noCors, free]]) {
      const { byFinding } = summarize(reports, NOW);
      expect(Object.keys(byFinding)).toEqual(FINDING_ORDER.filter((code) => code in byFinding));
    }
    // the loop above only means something if the reports really disagree about which findings they have
    const all = summarize([noCors, free, plain], NOW).byFinding;
    expect(all.cors_missing).toBe(1);
    expect(all.zero_amount).toBe(1); // three findings in one report, one endpoint
    expect(all.no_output_schema).toBe(3);
  });

  test('the public copy of a report is a copy', async () => {
    const report = await reportFor('seller.example');
    const copy = publicReport(report, 'fixture')!;
    copy.endpoint.url = 'https://changed.example/';
    expect(report.endpoint.url).toBe('https://seller.example/api/data');
  });
});
