import { describe, expect, test } from 'vitest';
import type { CheckReport, RunRecord } from '@railwalker/scanner';
import type { SpendState } from '@railwalker/core';
import { CheckReportSchema, DiscoveryStateSchema, RotationStateSchema, RunRecordSchema, ScanSummarySchema, SpendStateSchema, type ScanSummary } from '../src';
import { reportFor, runOf } from './support';

const clone = <T>(v: T): T => structuredClone(v);
/** Sets `value` at a path inside a deep clone. */
function withAt<T>(v: T, path: (string | number)[], value: unknown): T {
  const out = clone(v) as Record<string, any>;
  let node = out;
  for (const key of path.slice(0, -1)) node = node[key];
  node[path.at(-1)!] = value;
  return out as T;
}

const summary: ScanSummary = { generatedAt: '2026-10-22T12:00:00.000Z', endpointsScanned: 50, byFinding: { cors_missing: 12, v1_challenge: 3 }, assetAcceptance: { USDC: 40, USAT: 22 }, payablePct: 64.5, confirmedProbes: 4 };

describe('CheckReportSchema', async () => {
  const report = await reportFor('seller.example');

  test('accepts a real report, and what comes out equals what went in after a JSON round trip', () => {
    const wire = JSON.parse(JSON.stringify(report));
    expect(CheckReportSchema.parse(wire)).toEqual(wire);
  });

  test('the parsed value is the scanner’s own type (a compile-time check that the schema and the type cannot drift apart)', () => {
    const parsed: CheckReport = CheckReportSchema.parse(JSON.parse(JSON.stringify(report)));
    expect(parsed.endpoint.url).toBe(report.endpoint.url);
  });

  test('accepts the other shapes a scan produces: skipped (nothing was read) and not x402', () => {
    const skipped = { ...report, challenge: null, status: null, findings: [], verdicts: [{ kind: 'SKIPPED', code: 'unsafe_url', basis: 'PREDICTED', findings: [] }], patches: [] };
    expect(CheckReportSchema.safeParse(JSON.parse(JSON.stringify(skipped))).success).toBe(true);
    const notX402 = { ...report, challenge: null, status: 200, findings: [{ code: 'not_x402', severity: 'error', basis: 'PREDICTED', message: 'm', evidence: { status: 200 } }], verdicts: [{ kind: 'FAIL', code: 'not_x402', basis: 'PREDICTED', findings: [] }] };
    expect(CheckReportSchema.safeParse(JSON.parse(JSON.stringify(notX402))).success).toBe(true);
  });

  test('is strict at every level: a stray privateKey field is rejected wherever it is put', () => {
    const wire = JSON.parse(JSON.stringify(report));
    const places: (string | number)[][] = [
      ['privateKey'],
      ['endpoint', 'privateKey'],
      ['verdicts', 0, 'privateKey'],
      ['findings', 0, 'privateKey'],
      ['challenge', 'privateKey'],
      ['challenge', 'accepts', 0, 'privateKey'],
      ['challenge', 'accepts', 0, 'assetInfo', 'privateKey'],
      ['challenge', 'resource', 'privateKey'],
    ];
    for (const path of places) expect(CheckReportSchema.safeParse(withAt(wire, path, 'x')).success, path.join('.')).toBe(false);
  });

  test.each([
    ['an id that is not 16 hex characters', ['id'], 'nope'],
    ['a date that is not ISO', ['scannedAt'], 'yesterday'],
    ['a negative latency', ['latencyMs'], -1],
    ['a status that is a string', ['status'], '402'],
    ['a method other than GET or POST', ['endpoint', 'method'], 'DELETE'],
    ['a verdict kind that does not exist', ['verdicts', 0, 'kind'], 'MAYBE'],
    ['a basis that does not exist', ['verdicts', 0, 'basis'], 'GUESSED'],
    ['an asset symbol that does not exist', ['verdicts', 0, 'assetSymbol'], 'DOGE'],
    ['a finding code that does not exist', ['findings', 0, 'code'], 'made_up'],
    ['a severity that does not exist', ['findings', 0, 'severity'], 'fatal'],
    ['a challenge version that is not 1 or 2', ['challenge', 'version'], 3],
    ['an asset address that is not an address', ['challenge', 'accepts', 0, 'assetInfo', 'address'], '0x123'],
    ['a fee adapter that is not an address', ['challenge', 'accepts', 0, 'assetInfo', 'feeAdapter'], 'adapter'],
    ['an asset with decimals other than 6 or 18', ['challenge', 'accepts', 0, 'assetInfo', 'decimals'], 8],
  ] as const)('rejects %s', (_name, path, value) => {
    const wire = JSON.parse(JSON.stringify(report));
    expect(CheckReportSchema.safeParse(withAt(wire, path as unknown as (string | number)[], value)).success).toBe(false);
  });

  test('a SKIPPED verdict may carry any reason the policy or scanner can give, and nothing else', () => {
    const wire = JSON.parse(JSON.stringify(report));
    for (const code of ['not_read_style', 'unsafe_url', 'response_too_large', 'customer_fee_fraction_exceeded']) {
      expect(CheckReportSchema.safeParse(withAt(wire, ['verdicts', 0], { kind: 'SKIPPED', code, basis: 'PREDICTED', findings: [] })).success, code).toBe(true);
    }
    expect(CheckReportSchema.safeParse(withAt(wire, ['verdicts', 0], { kind: 'SKIPPED', code: 'because', basis: 'PREDICTED', findings: [] })).success).toBe(false);
  });

  test('a patch is strict too (a seller without CORS headers earns one)', async () => {
    const withPatch = JSON.parse(JSON.stringify(await reportFor('seller.example', { cors: false })));
    expect(withPatch.patches.length).toBeGreaterThan(0);
    expect(CheckReportSchema.safeParse(withPatch).success).toBe(true);
    expect(CheckReportSchema.safeParse(withAt(withPatch, ['patches', 0, 'privateKey'], 'x')).success).toBe(false);
    expect(CheckReportSchema.safeParse(withAt(withPatch, ['patches', 0, 'code'], 'made_up')).success).toBe(false);
  });

  test('the optional truncated flag the public API adds is allowed', () => {
    expect(CheckReportSchema.safeParse({ ...JSON.parse(JSON.stringify(report)), truncated: true }).success).toBe(true);
  });
});

describe('RunRecordSchema', () => {
  const run = runOf('fixture');
  const wire = JSON.parse(JSON.stringify(run));

  test('accepts a real run record, unchanged by a round trip, and is the scanner’s type', () => {
    const parsed: RunRecord = RunRecordSchema.parse(wire);
    expect(parsed).toEqual(run);
  });

  test.each(['buy', 'fixture', 'customer', 'unsolicited'] as const)('accepts kind %s', (kind) => {
    expect(RunRecordSchema.safeParse(JSON.parse(JSON.stringify(runOf(kind)))).success).toBe(true);
  });

  test('is strict: a stray privateKey is rejected at the top, in a step and in a payment', () => {
    for (const path of [['privateKey'], ['steps', 0, 'privateKey'], ['payments', 0, 'privateKey'], ['endpoint', 'privateKey']] as (string | number)[][]) {
      expect(RunRecordSchema.safeParse(withAt(wire, path, 'x')).success, path.join('.')).toBe(false);
    }
  });

  test.each([
    ['a kind that does not exist', ['kind'], 'public'],
    ['a stage that does not exist', ['steps', 0, 'stage'], 'ponder'],
    ['a negative step time', ['steps', 0, 't'], -5],
    ['a payment hash that is not a transaction hash', ['payments', 0, 'txHash'], '0x1234'],
    ['a payment amount that is not an integer string', ['payments', 0, 'amountAtomic'], '0.5'],
    ['a date that is not ISO', ['startedAt'], 'soon'],
  ] as const)('rejects %s', (_name, path, value) => {
    expect(RunRecordSchema.safeParse(withAt(wire, path as unknown as (string | number)[], value)).success).toBe(false);
  });

  test('a payment may have no transaction hash: it was sent and nobody can say whether it settled', () => {
    const { txHash: _drop, ...rest } = wire.payments[0];
    expect(RunRecordSchema.safeParse(withAt(wire, ['payments', 0], rest)).success).toBe(true);
  });

  test('a step may be undecided (ok null) and may carry detail', () => {
    expect(RunRecordSchema.safeParse(withAt(wire, ['steps', 0, 'ok'], null)).success).toBe(true);
  });
});

describe('SpendStateSchema', () => {
  const ok: SpendState = { totalUsd: 1.25, byEndpointDay: { 'seller.example|2026-10-22': 0.1 }, settlementsBySeller: { 'seller.example': 2 } };

  test('accepts a spend state and is the core type', () => {
    const parsed: SpendState = SpendStateSchema.parse(ok);
    expect(parsed).toEqual(ok);
  });

  test.each([
    ['a negative total', { ...ok, totalUsd: -1 }],
    ['a total that is not a number', { ...ok, totalUsd: '1' }],
    ['a non-finite total', { ...ok, totalUsd: Infinity }],
    ['a negative per-day amount', { ...ok, byEndpointDay: { a: -0.01 } }],
    ['a fractional settlement count', { ...ok, settlementsBySeller: { a: 1.5 } }],
    ['a negative settlement count', { ...ok, settlementsBySeller: { a: -1 } }],
    ['a missing field', { totalUsd: 0, byEndpointDay: {} }],
    ['an extra field', { ...ok, privateKey: 'x' }],
  ])('rejects %s', (_name, value) => {
    expect(SpendStateSchema.safeParse(value).success).toBe(false);
  });
});

describe('ScanSummarySchema', () => {
  test('accepts a summary', () => {
    const parsed: ScanSummary = ScanSummarySchema.parse(summary);
    expect(parsed).toEqual(summary);
  });

  test('accepts an empty one', () => {
    expect(ScanSummarySchema.safeParse({ generatedAt: '2026-10-22T12:00:00.000Z', endpointsScanned: 0, byFinding: {}, assetAcceptance: {}, payablePct: 0, confirmedProbes: 0 }).success).toBe(true);
  });

  test.each([
    ['a percentage over 100', { ...summary, payablePct: 100.1 }],
    ['a negative percentage', { ...summary, payablePct: -1 }],
    ['a negative count', { ...summary, endpointsScanned: -1 }],
    ['a fractional count', { ...summary, confirmedProbes: 1.5 }],
    ['a finding code that does not exist', { ...summary, byFinding: { made_up: 1 } }],
    ['an asset that does not exist', { ...summary, assetAcceptance: { DOGE: 1 } }],
    ['a count under a finding that is not a number', { ...summary, byFinding: { cors_missing: 'many' } }],
    ['a date that is not ISO', { ...summary, generatedAt: 'now' }],
    ['an extra field: a summary has no room for a seller', { ...summary, hosts: ['seller.example'] }],
  ])('rejects %s', (_name, value) => {
    expect(ScanSummarySchema.safeParse(value).success).toBe(false);
  });
});

describe('DiscoveryStateSchema', () => {
  test('accepts the cursor as a decimal string', () => {
    expect(DiscoveryStateSchema.parse({ nextId: '12345' })).toEqual({ nextId: '12345' });
    expect(DiscoveryStateSchema.safeParse({ nextId: '0' }).success).toBe(true);
    expect(DiscoveryStateSchema.safeParse({ nextId: '340282366920938463463374607431768211456' }).success).toBe(true); // beyond 2^53
  });

  test.each([
    ['not digits', { nextId: 'abc' }],
    ['empty', { nextId: '' }],
    ['a number', { nextId: 12 }],
    ['negative', { nextId: '-1' }],
    ['missing', {}],
    ['extra', { nextId: '1', privateKey: 'x' }],
  ])('rejects a cursor that is %s', (_name, value) => {
    expect(DiscoveryStateSchema.safeParse(value).success).toBe(false);
  });
});

describe('DiscoveryStateSchema: the cursor is an agent id, so it is a uint256', () => {
  test('the largest uint256 is accepted and one more is not', () => {
    expect(DiscoveryStateSchema.safeParse({ nextId: (2n ** 256n - 1n).toString() }).success).toBe(true);
    expect(DiscoveryStateSchema.safeParse({ nextId: (2n ** 256n).toString() }).success).toBe(false);
  });

  test('leading zeros are refused, so one number has one spelling', () => {
    expect(DiscoveryStateSchema.safeParse({ nextId: '007' }).success).toBe(false);
    expect(DiscoveryStateSchema.safeParse({ nextId: '0' }).success).toBe(true);
  });
});

describe('DiscoveryStateSchema: hostile cursors are rejected, never thrown', () => {
  test.each([
    ['letters', 'abc'],
    ['a sign', '+5'],
    ['full-width digits', '１２３'],
    ['whitespace around digits', ' 12 '],
    ['a decimal point', '1.5'],
    ['a million digits', '9'.repeat(1_000_000)],
  ])('%s', (_name, nextId) => {
    expect(() => DiscoveryStateSchema.safeParse({ nextId })).not.toThrow();
    expect(DiscoveryStateSchema.safeParse({ nextId }).success).toBe(false);
  });
});

describe('RotationStateSchema: when each public endpoint was last tried', () => {
  const at = '2026-10-22T12:00:00.000Z';
  const ok = { lastTried: { 'POST https://gateway.usebuy.ai/v1/social/x/posts/search': at, 'GET https://fixtures.example/api/fixtures/ok': at } };

  test('accepts public endpoints keyed by method and https URL, and an empty table', () => {
    expect(RotationStateSchema.parse(ok)).toEqual(ok);
    expect(RotationStateSchema.safeParse({ lastTried: {} }).success).toBe(true);
  });

  test.each([
    ['a seller key (the sixteen hex characters of a hashed host): only public endpoints belong here', { lastTried: { '0123456789abcdef': at } }],
    ['a bare URL without its method', { lastTried: { 'https://gateway.usebuy.ai/v1/x': at } }],
    ['a method that is not GET or POST', { lastTried: { 'DELETE https://gateway.usebuy.ai/v1/x': at } }],
    ['a lower-case method', { lastTried: { 'post https://gateway.usebuy.ai/v1/x': at } }],
    ['a URL that is not https', { lastTried: { 'GET http://gateway.usebuy.ai/v1/x': at } }],
    ['a key with a space or newline in the URL', { lastTried: { 'GET https://gateway.usebuy.ai/v1/x y': at } }],
    ['a URL over 2048 characters', { lastTried: { [`GET https://gateway.usebuy.ai/${'x'.repeat(2100)}`]: at } }],
    ['a time that is not ISO', { lastTried: { 'GET https://gateway.usebuy.ai/v1/x': 'yesterday' } }],
    ['a time that is a number', { lastTried: { 'GET https://gateway.usebuy.ai/v1/x': 1761134400000 } }],
    ['a missing table', {}],
    ['an extra field', { ...ok, privateKey: 'x' }],
  ])('rejects %s', (_name, value) => {
    expect(RotationStateSchema.safeParse(value).success).toBe(false);
  });
});
