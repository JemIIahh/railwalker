import { describe, expect, test } from 'vitest';
import type { MapCell } from '@railwalker/data';
import { NO_FILTER, cellMatches, filterView, isFiltering, toggleAsset, toggleBasis } from '../lib/map-filter';
import { mapRows } from '../lib/view-models';

let n = 0;
const cell = (over: Partial<MapCell> = {}): MapCell => ({ row: 'ok', group: 'fixture', asset: 'USAT', verdict: 'PASS', basis: 'CONFIRMED', runId: (++n).toString(16).padStart(16, '0'), at: '2026-10-22T12:00:00.000Z', ...over });

// ok:        USDC predicted, USAT confirmed
// paid/500:  USDC predicted, USDT predicted, USAT confirmed
// bad/zero:  USDC predicted only
// social/x:  (buy) USAT confirmed
const cells: MapCell[] = [
  cell({ row: 'ok', asset: 'USDC', basis: 'PREDICTED' }),
  cell({ row: 'ok', asset: 'USAT' }),
  cell({ row: 'paid/500', asset: 'USDC', basis: 'PREDICTED' }),
  cell({ row: 'paid/500', asset: 'USDT', basis: 'PREDICTED' }),
  cell({ row: 'paid/500', asset: 'USAT', verdict: 'FAIL', code: 'paid_not_delivered' }),
  cell({ row: 'bad/zero', asset: 'USDC', basis: 'PREDICTED', verdict: 'FAIL', code: 'payto_zero' }),
  cell({ row: 'social/x', group: 'buy', asset: 'USAT' }),
];
const view = mapRows(cells);
const rowNames = (v: ReturnType<typeof filterView>) => v.groups.map((g) => [g.group, g.rows.map((r) => r.label)]);

describe('the filter and its switches', () => {
  test('nothing switched on is no filter at all', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(NO_FILTER).toEqual({ assets: [], basis: null });
  });

  test('a token switches on and off, one at a time, and never changes the filter it was given', () => {
    const on = toggleAsset(NO_FILTER, 'USDC');
    expect(on.assets).toEqual(['USDC']);
    expect(NO_FILTER.assets).toEqual([]);
    expect(toggleAsset(on, 'USAT').assets).toEqual(['USDC', 'USAT']);
    expect(toggleAsset(on, 'USDC').assets).toEqual([]);
    expect(isFiltering(on)).toBe(true);
  });

  test('picking a basis picks it, picking it again lets both back in, and picking the other swaps it', () => {
    expect(toggleBasis(NO_FILTER, 'CONFIRMED').basis).toBe('CONFIRMED');
    expect(toggleBasis(toggleBasis(NO_FILTER, 'CONFIRMED'), 'CONFIRMED').basis).toBeNull();
    expect(toggleBasis(toggleBasis(NO_FILTER, 'CONFIRMED'), 'PREDICTED').basis).toBe('PREDICTED');
    expect(isFiltering(toggleBasis(NO_FILTER, 'PREDICTED'))).toBe(true);
  });

  test('a switch changes only what it is for: tokens keep the basis, and the basis keeps the tokens', () => {
    expect(toggleAsset({ assets: [], basis: 'CONFIRMED' }, 'USDC')).toEqual({ assets: ['USDC'], basis: 'CONFIRMED' });
    expect(toggleBasis({ assets: ['USDC', 'USAT'], basis: null }, 'PREDICTED')).toEqual({ assets: ['USDC', 'USAT'], basis: 'PREDICTED' });
    expect(toggleBasis({ assets: ['USDC'], basis: 'PREDICTED' }, 'PREDICTED')).toEqual({ assets: ['USDC'], basis: null });
  });

  test('a cell matches when its token is picked (or none is) and its basis is picked (or none is)', () => {
    const usdcPredicted = cell({ asset: 'USDC', basis: 'PREDICTED' });
    expect(cellMatches(usdcPredicted, NO_FILTER)).toBe(true);
    expect(cellMatches(usdcPredicted, { assets: ['USDC'], basis: null })).toBe(true);
    expect(cellMatches(usdcPredicted, { assets: ['USAT'], basis: null })).toBe(false);
    expect(cellMatches(usdcPredicted, { assets: [], basis: 'PREDICTED' })).toBe(true);
    expect(cellMatches(usdcPredicted, { assets: [], basis: 'CONFIRMED' })).toBe(false);
    expect(cellMatches(usdcPredicted, { assets: ['USDC'], basis: 'CONFIRMED' })).toBe(false);
    expect(cellMatches(usdcPredicted, { assets: ['USAT'], basis: 'PREDICTED' })).toBe(false);
  });
});

describe('filterView', () => {
  test('no filter leaves the map as it was, and says how many endpoints there are', () => {
    const out = filterView(view, NO_FILTER);
    expect(out.assets).toEqual(['USDC', 'USDT', 'USAT']);
    expect(rowNames(out)).toEqual([['fixture', ['ok', 'paid/500', 'bad/zero']], ['buy', ['social/x']]]);
    expect(out).toMatchObject({ shown: 4, total: 4 });
  });

  test('a token keeps only its column, and only the endpoints that have a cell for it', () => {
    const out = filterView(view, { assets: ['USDT'], basis: null });
    expect(out.assets).toEqual(['USDT']);
    expect(rowNames(out)).toEqual([['fixture', ['paid/500']]]);
    expect(out).toMatchObject({ shown: 1, total: 4 });
    expect(Object.keys(out.groups[0]!.rows[0]!.cells)).toEqual(['USDT']);
  });

  test('a basis keeps only the cells with that basis: what a payment confirmed, or what is only predicted', () => {
    const confirmed = filterView(view, { assets: [], basis: 'CONFIRMED' });
    expect(confirmed.assets).toEqual(['USAT']);
    expect(rowNames(confirmed)).toEqual([['fixture', ['ok', 'paid/500']], ['buy', ['social/x']]]);
    const predicted = filterView(view, { assets: [], basis: 'PREDICTED' });
    expect(predicted.assets).toEqual(['USDC', 'USDT']);
    expect(rowNames(predicted)).toEqual([['fixture', ['ok', 'paid/500', 'bad/zero']]]);
    expect(predicted.groups[0]!.rows[0]!.cells.USAT).toBeUndefined();
  });

  test('token and basis together: a column with no cell left is dropped', () => {
    const out = filterView(view, { assets: ['USDC', 'USAT'], basis: 'CONFIRMED' });
    expect(out.assets).toEqual(['USAT']);
    expect(rowNames(out)).toEqual([['fixture', ['ok', 'paid/500']], ['buy', ['social/x']]]);
  });

  test('nothing matching is an empty map, not a broken one', () => {
    const out = filterView(view, { assets: ['wARS'], basis: null });
    expect(out).toMatchObject({ assets: [], groups: [], shown: 0, total: 4 });
  });

  test('the map it was given is not changed', () => {
    const before = JSON.stringify(view);
    filterView(view, { assets: ['USDT'], basis: 'PREDICTED' });
    expect(JSON.stringify(view)).toBe(before);
  });
});
