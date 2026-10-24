import type { AssetSymbol, Basis } from '@railwalker/core';
import type { MapCell } from '@railwalker/data';
import type { MapRow, MapView } from './view-models';

/** Which tokens are switched on (none: all of them) and which kind of result is picked (none: both). */
export interface MapFilter {
  assets: AssetSymbol[];
  basis: Basis | null;
}

export const NO_FILTER: MapFilter = { assets: [], basis: null };

export const isFiltering = (f: MapFilter): boolean => f.assets.length > 0 || f.basis !== null;

/** A token switches on and off one at a time. The filter it was given is never changed. */
export function toggleAsset(f: MapFilter, asset: AssetSymbol): MapFilter {
  return { ...f, assets: f.assets.includes(asset) ? f.assets.filter((a) => a !== asset) : [...f.assets, asset] };
}

/** Picking the basis that is already picked lets both back in. */
export function toggleBasis(f: MapFilter, basis: Basis): MapFilter {
  return { ...f, basis: f.basis === basis ? null : basis };
}

export const cellMatches = (cell: MapCell, f: MapFilter): boolean => (f.assets.length === 0 || f.assets.includes(cell.asset)) && (f.basis === null || cell.basis === f.basis);

/** The map as a filter leaves it: only cells that match, only the rows with a cell left, only the columns with a cell left. */
export function filterView(view: MapView, f: MapFilter): MapView & { shown: number; total: number } {
  const total = view.groups.reduce((n, g) => n + g.rows.length, 0);
  const used = new Set<AssetSymbol>();
  const groups = view.groups
    .map((g) => ({
      group: g.group,
      rows: g.rows
        .map((row): MapRow => {
          const cells: MapRow['cells'] = {};
          for (const asset of view.assets) {
            const cell = row.cells[asset];
            if (cell !== undefined && cellMatches(cell, f)) {
              cells[asset] = cell;
              used.add(asset);
            }
          }
          return { label: row.label, cells };
        })
        .filter((row) => Object.keys(row.cells).length > 0),
    }))
    .filter((g) => g.rows.length > 0);
  return { assets: view.assets.filter((a) => used.has(a)), groups, shown: groups.reduce((n, g) => n + g.rows.length, 0), total };
}
