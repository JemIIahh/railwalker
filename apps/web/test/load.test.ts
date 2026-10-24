import { describe, expect, test } from 'vitest';
import { ASSETS, type Verdict } from '@railwalker/core';
import { LedgerFileSchema, MapFileSchema, ScanSummarySchema, buildLedger, mapCells, type DataStore } from '@railwalker/data';
import type { RunRecord } from '@railwalker/scanner';
import { loadLedger, loadMap, loadRun, loadSummary } from '../lib/load';

function memory(files: Record<string, string> = {}): DataStore & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    read: async (path) => (reads.push(path), files[path] ?? null),
    write: async () => {},
    list: async () => Object.keys(files),
  };
}
const broken: DataStore = { read: async () => Promise.reject(new Error('network down')), write: async () => {}, list: async () => [] };

const verdict = (over: Partial<Verdict> = {}): Verdict => ({ kind: 'PASS', basis: 'CONFIRMED', assetSymbol: 'USAT', findings: [], ...over });
const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: '0123456789abcdef',
  kind: 'buy',
  startedAt: '2026-10-22T12:00:00.000Z',
  endpoint: { url: 'https://gateway.usebuy.ai/v1/social/x/posts/search', method: 'POST' },
  steps: [{ t: 0, stage: 'challenge', ok: true, label: 'ok' }],
  verdicts: [verdict()],
  payments: [],
  ...over,
});
const summary = { generatedAt: '2026-10-22T12:00:00.000Z', endpointsScanned: 10, byFinding: { cors_missing: 3 }, assetAcceptance: { USDC: 9 }, payablePct: 40, confirmedProbes: 1 };
const mapFile = { updatedAt: '2026-10-22T12:00:00.000Z', cells: mapCells([run()]) };
const ledgerFile = {
  generatedAt: '2026-10-22T12:00:00.000Z',
  hackathonStart: '2026-10-06T00:00:00.000Z',
  agent: `0x${'a'.repeat(40)}`,
  ledger: buildLedger({ agent: `0x${'a'.repeat(40)}`, projectWallets: [], incoming: [], outgoing: [], runs: [run({ payments: [{ asset: ASSETS.USAT.address, symbol: 'USAT', amountAtomic: '5000', payTo: `0x${'1'.repeat(40)}` }] })], facts: {}, hackathonStart: '2026-10-06T00:00:00.000Z' }),
};

describe.each([
  ['loadSummary', loadSummary, 'summary.json', summary, ScanSummarySchema],
  ['loadMap', loadMap, 'map.json', mapFile, MapFileSchema],
  ['loadLedger', loadLedger, 'ledger.json', ledgerFile, LedgerFileSchema],
] as const)('%s', (_name, load, path, good, schema) => {
  test('a valid file is ready, checked by its own schema', async () => {
    const out = await load(memory({ [path]: JSON.stringify(good) }));
    expect(out).toEqual({ state: 'ready', value: schema.parse(good) });
  });

  test('a file that is not there is empty: nothing has been published yet, which is not an error', async () => {
    expect(await load(memory())).toEqual({ state: 'empty' });
  });

  test('a file that is not JSON, or not what it should be, is broken as invalid, never half shown', async () => {
    for (const text of ['{nope', '', 'null', '[]', '{"hello":1}', JSON.stringify({ ...good, privateKey: 'x' })]) {
      expect(await load(memory({ [path]: text })), text).toEqual({ state: 'broken', why: 'invalid' });
    }
  });

  test('a store that cannot be reached is broken as unavailable, so the page can say so instead of failing', async () => {
    expect(await load(broken)).toEqual({ state: 'broken', why: 'unavailable' });
  });

  test('it reads exactly one file, and the one it is named for', async () => {
    const store = memory({ [path]: JSON.stringify(good) });
    await load(store);
    expect(store.reads).toEqual([path]);
  });
});

describe('loadRun', () => {
  test('a run is ready, found by its id', async () => {
    const r = run();
    const store = memory({ [`runs/${r.id}.json`]: JSON.stringify(r) });
    expect(await loadRun(store, r.id)).toEqual({ state: 'ready', value: r });
    expect(store.reads).toEqual([`runs/${r.id}.json`]);
  });

  test('an id that is not a run id is empty and nothing is read: a visitor cannot make the site fetch other paths', async () => {
    for (const id of ['', 'x', '../summary', 'ZZZZZZZZZZZZZZZZ', '0123456789abcde', '0123456789abcdef0', '0123456789ABCDEF', 'runs/0123456789abcdef', '0123456789abcdef.json']) {
      const store = memory({ 'summary.json': '{}' });
      expect(await loadRun(store, id), id).toEqual({ state: 'empty' });
      expect(store.reads, id).toEqual([]);
    }
  });

  test('a run that is not there is empty', async () => {
    expect(await loadRun(memory(), '0123456789abcdef')).toEqual({ state: 'empty' });
  });

  test('a file that is not a valid run, or that is a different run from its name, is broken as invalid', async () => {
    const id = '0123456789abcdef';
    for (const text of ['{nope', '{}', JSON.stringify({ ...run(), privateKey: 'x' }), JSON.stringify(run({ id: 'fedcba9876543210' }))]) {
      expect(await loadRun(memory({ [`runs/${id}.json`]: text }), id), text).toEqual({ state: 'broken', why: 'invalid' });
    }
  });

  test('the run of anyone else’s endpoint is never shown, even if one were ever put in the data: it is empty', async () => {
    for (const kind of ['unsolicited', 'customer'] as const) {
      const r = run({ kind, endpoint: { url: 'https://secret-seller.example/x', method: 'GET' } });
      expect(await loadRun(memory({ [`runs/${r.id}.json`]: JSON.stringify(r) }), r.id), kind).toEqual({ state: 'empty' });
    }
  });

  test('a store that cannot be reached is broken as unavailable', async () => {
    expect(await loadRun(broken, '0123456789abcdef')).toEqual({ state: 'broken', why: 'unavailable' });
  });
});
