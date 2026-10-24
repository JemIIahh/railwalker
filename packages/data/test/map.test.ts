import { describe, expect, test } from 'vitest';
import { type Verdict } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import { MapFileSchema, mapCells, mergeMapCells, type MapCell } from '../src';

let n = 0;
const verdict = (over: Partial<Verdict> = {}): Verdict => ({ kind: 'PASS', basis: 'CONFIRMED', assetSymbol: 'USAT', findings: [], ...over });
const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: (++n).toString(16).padStart(16, '0'),
  kind: 'buy',
  startedAt: '2026-10-22T12:00:00.000Z',
  endpoint: { url: 'https://gateway.usebuy.ai/v1/social/x/posts/search', method: 'POST' },
  steps: [],
  verdicts: [verdict()],
  payments: [],
  ...over,
});
const cell = (over: Partial<MapCell> = {}): MapCell => ({ row: 'a', group: 'buy', asset: 'USAT', verdict: 'PASS', basis: 'CONFIRMED', runId: '0000000000000001', at: '2026-10-22T12:00:00.000Z', ...over });

describe('mapCells', () => {
  test('one cell per endpoint and asset, carrying its verdict, its basis, the run it came from and when', () => {
    const r = run({ verdicts: [verdict({ assetSymbol: 'USAT' }), verdict({ assetSymbol: 'USDC', kind: 'FAIL', code: 'settle_failed', basis: 'PREDICTED' })] });
    expect(mapCells([r])).toEqual([
      { row: 'social/x/posts/search', group: 'buy', asset: 'USDC', verdict: 'FAIL', basis: 'PREDICTED', code: 'settle_failed', runId: r.id, at: r.startedAt },
      { row: 'social/x/posts/search', group: 'buy', asset: 'USAT', verdict: 'PASS', basis: 'CONFIRMED', runId: r.id, at: r.startedAt },
    ]);
  });

  test('every cell says whether a real payment backs it: the basis is never left out', () => {
    const cells = mapCells([run({ verdicts: [verdict({ basis: 'CONFIRMED' }), verdict({ assetSymbol: 'USDC', basis: 'PREDICTED' })] })]);
    expect(cells.map((c) => c.basis).sort()).toEqual(['CONFIRMED', 'PREDICTED']);
  });

  test('a run of anyone else’s endpoint never makes a row: only our fixtures and buy’s routes are shown by name', () => {
    const secret = run({ kind: 'unsolicited', endpoint: { url: 'https://secret-seller.example/api/data', method: 'GET' } });
    const customer = run({ kind: 'customer', endpoint: { url: 'https://customer.example/api/data', method: 'GET' } });
    const ours = run();
    const cells = mapCells([secret, customer, ours]);
    expect(cells.map((c) => c.runId)).toEqual([ours.id]);
    expect(JSON.stringify(cells)).not.toMatch(/secret-seller|customer\.example/);
  });

  test('rows are named by their path, without the fixtures mount or buy’s version prefix', () => {
    const cells = mapCells([
      run({ kind: 'fixture', endpoint: { url: 'https://railwalker.example/api/fixtures/paid/empty-body', method: 'GET' } }),
      run({ kind: 'fixture', endpoint: { url: 'https://railwalker.example/api/fixtures/ok', method: 'GET' } }),
      run({ endpoint: { url: 'https://gateway.usebuy.ai/v1/browser/sessions', method: 'POST' } }),
    ]);
    expect(cells.map((c) => [c.group, c.row])).toEqual([['fixture', 'ok'], ['fixture', 'paid/empty-body'], ['buy', 'browser/sessions']]);
  });

  test('buy’s version prefix is dropped only when it is the whole first segment, and a bare origin is the root row', () => {
    const cells = mapCells([run({ endpoint: { url: 'https://gateway.usebuy.ai/v1beta/x', method: 'GET' } }), run({ endpoint: { url: 'https://gateway.usebuy.ai/v1', method: 'GET' } })]);
    expect(cells.map((c) => c.row).sort()).toEqual(['/', 'v1beta/x']);
    expect(mapCells([run({ endpoint: { url: 'https://gateway.usebuy.ai/', method: 'GET' } })]).map((c) => c.row)).toEqual(['/']);
  });

  test('a very long path is shortened too, so a row can always be drawn and written', () => {
    const cells = mapCells([run({ endpoint: { url: `https://gateway.usebuy.ai/v1/${'segment/'.repeat(60)}end`, method: 'GET' } })]);
    expect(cells[0]!.row.length).toBeLessThanOrEqual(81);
    expect(MapFileSchema.safeParse({ updatedAt: '2026-10-22T12:00:00.000Z', cells }).success).toBe(true);
  });

  test('a row name that cannot be made from the URL is the URL, shortened', () => {
    const cells = mapCells([run({ endpoint: { url: `not a url ${'x'.repeat(200)}`, method: 'GET' } })]);
    expect(cells[0]!.row.length).toBeLessThanOrEqual(81);
    expect(cells[0]!.row.startsWith('not a url')).toBe(true);
  });

  test('the same endpoint and asset in two runs is one cell: the later run wins', () => {
    const older = run({ startedAt: '2026-10-21T12:00:00.000Z', verdicts: [verdict({ kind: 'PASS' })] });
    const newer = run({ startedAt: '2026-10-22T12:00:00.000Z', verdicts: [verdict({ kind: 'FAIL', code: 'paid_not_delivered' })] });
    for (const order of [[older, newer], [newer, older]]) {
      const cells = mapCells(order);
      expect(cells).toHaveLength(1);
      expect(cells[0]).toMatchObject({ verdict: 'FAIL', code: 'paid_not_delivered', runId: newer.id });
    }
  });

  test('a real payment is never overwritten by a later guess: the confirmed verdict stays until a newer confirmed one replaces it', () => {
    const confirmed = run({ startedAt: '2026-10-21T12:00:00.000Z', verdicts: [verdict({ kind: 'PASS', basis: 'CONFIRMED' })] });
    const guess = run({ startedAt: '2026-10-22T12:00:00.000Z', verdicts: [verdict({ kind: 'FAIL', basis: 'PREDICTED' })] });
    expect(mapCells([confirmed, guess])[0]).toMatchObject({ verdict: 'PASS', basis: 'CONFIRMED', runId: confirmed.id });
    const newerConfirmed = run({ startedAt: '2026-10-23T12:00:00.000Z', verdicts: [verdict({ kind: 'FAIL', basis: 'CONFIRMED', code: 'delivered_empty' })] });
    expect(mapCells([confirmed, guess, newerConfirmed])[0]).toMatchObject({ verdict: 'FAIL', basis: 'CONFIRMED', runId: newerConfirmed.id });
  });

  test('two runs at the very same moment: the one listed later wins, whichever way round', () => {
    const a = run({ verdicts: [verdict({ kind: 'PASS' })] });
    const b = run({ verdicts: [verdict({ kind: 'FAIL', code: 'delivered_empty' })] });
    expect(mapCells([a, b])[0]).toMatchObject({ verdict: 'FAIL', runId: b.id });
    expect(mapCells([b, a])[0]).toMatchObject({ verdict: 'PASS', runId: a.id });
  });

  test('a run whose time cannot be read counts as the oldest, so it never beats a run with a real time', () => {
    const dated = run({ startedAt: '2020-01-01T00:00:00.000Z', verdicts: [verdict({ kind: 'PASS' })] });
    const undated = run({ startedAt: 'sometime', verdicts: [verdict({ kind: 'FAIL', code: 'tx_not_found' })] });
    expect(mapCells([dated, undated])[0]).toMatchObject({ verdict: 'PASS', runId: dated.id });
    expect(mapCells([undated, dated])[0]).toMatchObject({ verdict: 'PASS', runId: dated.id });
  });

  test('the time of a cell is written the one way, whatever the run said, and a time that cannot be read becomes the epoch so the file stays valid', () => {
    const plain = run({ startedAt: '2026-10-22T12:00:00Z' });
    expect(mapCells([plain])[0]!.at).toBe('2026-10-22T12:00:00.000Z');
    const undated = mapCells([run({ startedAt: 'sometime' })]);
    expect(undated[0]!.at).toBe('1970-01-01T00:00:00.000Z');
    expect(MapFileSchema.safeParse({ updatedAt: '2026-10-22T12:00:00.000Z', cells: undated }).success).toBe(true);
  });

  test('a later guess does replace an earlier guess', () => {
    const a = run({ startedAt: '2026-10-21T12:00:00.000Z', verdicts: [verdict({ kind: 'PASS', basis: 'PREDICTED' })] });
    const b = run({ startedAt: '2026-10-22T12:00:00.000Z', verdicts: [verdict({ kind: 'FAIL', basis: 'PREDICTED' })] });
    expect(mapCells([a, b])[0]).toMatchObject({ verdict: 'FAIL', runId: b.id });
  });

  test('a verdict about the endpoint as a whole, not an asset, is not a cell', () => {
    expect(mapCells([run({ verdicts: [verdict({ assetSymbol: undefined, kind: 'FAIL', code: 'not_x402' })] })])).toEqual([]);
  });

  test('the same path in our fixtures and in buy’s routes are different rows', () => {
    const cells = mapCells([run({ kind: 'fixture', endpoint: { url: 'https://x.example/api/fixtures/ok', method: 'GET' } }), run({ endpoint: { url: 'https://gateway.usebuy.ai/v1/ok', method: 'GET' } })]);
    expect(cells.map((c) => c.group)).toEqual(['fixture', 'buy']);
  });

  test('cells come out in a fixed order: fixtures first, then by row, then in the order the assets are listed', () => {
    const r = run({ kind: 'fixture', endpoint: { url: 'https://x.example/api/fixtures/ok', method: 'GET' }, verdicts: [verdict({ assetSymbol: 'USAT' }), verdict({ assetSymbol: 'USDC' }), verdict({ assetSymbol: 'USDT' })] });
    const buy = run({ endpoint: { url: 'https://gateway.usebuy.ai/v1/a', method: 'POST' } });
    expect(mapCells([buy, r]).map((c) => `${c.group}:${c.row}:${c.asset}`)).toEqual(['fixture:ok:USDC', 'fixture:ok:USDT', 'fixture:ok:USAT', 'buy:a:USAT']);
  });

  test('no runs, no cells; and the runs are not changed', () => {
    expect(mapCells([])).toEqual([]);
    const runs = [run(), run({ kind: 'fixture', endpoint: { url: 'https://x.example/api/fixtures/ok', method: 'GET' } })];
    const copy = structuredClone(runs);
    mapCells(runs);
    expect(runs).toEqual(copy);
  });
});

describe('mergeMapCells', () => {
  test('cells that the other side does not have are kept, whichever side they are on, in the fixed order', () => {
    const a = cell({ row: 'b', asset: 'USAT' });
    const b = cell({ row: 'a', asset: 'USDC' });
    expect(mergeMapCells([a], [b]).map((c) => `${c.row}:${c.asset}`)).toEqual(['a:USDC', 'b:USAT']);
  });

  test('for the same endpoint and asset the later cell wins, unless the earlier one is a real payment and the later one a guess', () => {
    const old = cell({ verdict: 'PASS', at: '2026-10-21T00:00:00.000Z', runId: 'aaaaaaaaaaaaaaaa' });
    const fresh = cell({ verdict: 'FAIL', code: 'delivered_empty', at: '2026-10-22T00:00:00.000Z', runId: 'bbbbbbbbbbbbbbbb' });
    expect(mergeMapCells([old], [fresh])[0]!.runId).toBe('bbbbbbbbbbbbbbbb');
    expect(mergeMapCells([fresh], [old])[0]!.runId).toBe('bbbbbbbbbbbbbbbb');
    const guess = cell({ verdict: 'FAIL', basis: 'PREDICTED', at: '2026-10-25T00:00:00.000Z', runId: 'cccccccccccccccc' });
    expect(mergeMapCells([old], [guess])[0]!.runId).toBe('aaaaaaaaaaaaaaaa');
    expect(mergeMapCells([guess], [old])[0]!.runId).toBe('aaaaaaaaaaaaaaaa');
  });

  test('a cell whose time cannot be read is the oldest: a real time beats it from either side, and it beats nothing', () => {
    const broken = cell({ at: 'not a time', runId: 'dddddddddddddddd' });
    const real = cell({ at: '2026-10-22T00:00:00.000Z', runId: 'eeeeeeeeeeeeeeee' });
    expect(mergeMapCells([broken], [real])[0]!.runId).toBe('eeeeeeeeeeeeeeee');
    expect(mergeMapCells([real], [broken])[0]!.runId).toBe('eeeeeeeeeeeeeeee');
  });

  test('the same path and asset in two groups, or two assets of one path, stay separate cells', () => {
    const merged = mergeMapCells([cell({ group: 'fixture' }), cell({ group: 'buy' }), cell({ group: 'buy', asset: 'USDC' })], []);
    expect(merged).toHaveLength(3);
  });

  test('merging what is already there changes nothing, and merging in two steps is the same as in one', () => {
    const one = cell({ row: 'a', at: '2026-10-21T00:00:00.000Z', runId: '1111111111111111' });
    const two = cell({ row: 'b', at: '2026-10-22T00:00:00.000Z', runId: '2222222222222222' });
    const three = cell({ row: 'a', verdict: 'FAIL', at: '2026-10-23T00:00:00.000Z', runId: '3333333333333333' });
    expect(mergeMapCells([one, two], [one, two])).toEqual(mergeMapCells([], [one, two]));
    expect(mergeMapCells(mergeMapCells([one], [two]), [three])).toEqual(mergeMapCells([one], [two, three]));
  });

  test('the inputs are not changed', () => {
    const a = [cell()];
    const b = [cell({ verdict: 'FAIL', at: '2026-10-23T00:00:00.000Z' })];
    const copy = structuredClone([a, b]);
    mergeMapCells(a, b);
    expect([a, b]).toEqual(copy);
  });
});

describe('MapFileSchema', () => {
  const ok = { updatedAt: '2026-10-22T12:00:00.000Z', cells: [cell()] };

  test('accepts the file the runner writes, and an empty one', () => {
    expect(MapFileSchema.parse(ok)).toEqual(ok);
    expect(MapFileSchema.safeParse({ updatedAt: ok.updatedAt, cells: [] }).success).toBe(true);
  });

  test('accepts every cell the cells function makes, whatever the verdict', () => {
    const cells = mapCells([run({ verdicts: [verdict({ kind: 'SKIPPED', code: 'over_event_cap', basis: 'PREDICTED' }), verdict({ assetSymbol: 'USDC', kind: 'FAIL', code: 'paid_not_delivered' })] })]);
    expect(MapFileSchema.safeParse({ updatedAt: ok.updatedAt, cells }).success).toBe(true);
  });

  test.each([
    ['an extra field on the file', { ...ok, privateKey: 'x' }],
    ['an extra field on a cell', { ...ok, cells: [{ ...cell(), host: 'secret.example' }] }],
    ['a group that is not public', { ...ok, cells: [{ ...cell(), group: 'unsolicited' }] }],
    ['an asset that does not exist', { ...ok, cells: [{ ...cell(), asset: 'DOGE' }] }],
    ['a verdict that does not exist', { ...ok, cells: [{ ...cell(), verdict: 'MAYBE' }] }],
    ['a basis that does not exist', { ...ok, cells: [{ ...cell(), basis: 'GUESSED' }] }],
    ['a code that does not exist', { ...ok, cells: [{ ...cell(), code: 'made_up' }] }],
    ['a run id that is not an id', { ...ok, cells: [{ ...cell(), runId: 'nope' }] }],
    ['a time that is not ISO', { ...ok, cells: [{ ...cell(), at: 'yesterday' }] }],
    ['a row that is empty', { ...ok, cells: [{ ...cell(), row: '' }] }],
    ['a row that is far too long', { ...ok, cells: [{ ...cell(), row: 'x'.repeat(200) }] }],
    ['no cells list', { updatedAt: ok.updatedAt }],
    ['an update time that is not ISO', { ...ok, updatedAt: 'now' }],
    ['more cells than there can be', { ...ok, cells: Array.from({ length: 5001 }, () => cell()) }],
  ])('rejects %s', (_name, value) => {
    expect(MapFileSchema.safeParse(value).success).toBe(false);
  });
});
