import { ASSETS, clipText, type AssetSymbol, type Basis, type VerdictKind } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import { z } from 'zod';
import { AssetSymbolSchema, BasisSchema, VerdictCodeSchema, VerdictKindSchema } from './schemas';

/** Only our own fixtures and buy's routes are shown by name; everyone else exists only as the summary's counts. */
export type MapGroup = 'fixture' | 'buy';

export interface MapCell {
  row: string;
  group: MapGroup;
  asset: AssetSymbol;
  verdict: VerdictKind;
  /** Whether a real payment backs the verdict. It is never left out. */
  basis: Basis;
  code?: string;
  /** The run that produced it, for the replay link. */
  runId: string;
  /** When that run started, ISO. */
  at: string;
}

const MAX_ROW_LENGTH = 80;

const MapCellSchema = z.strictObject({
  row: z.string().min(1).max(100),
  group: z.enum(['fixture', 'buy']),
  asset: AssetSymbolSchema,
  verdict: VerdictKindSchema,
  basis: BasisSchema,
  code: VerdictCodeSchema.optional(),
  runId: z.string().regex(/^[0-9a-f]{16}$/),
  at: z.iso.datetime(),
});

/** What the runner publishes as `map.json` and the site draws: the latest cell for each public endpoint and asset. */
export const MapFileSchema = z.strictObject({ updatedAt: z.iso.datetime(), cells: z.array(MapCellSchema).max(5000) });
export type MapFile = z.infer<typeof MapFileSchema>;

const ASSET_ORDER = Object.keys(ASSETS) as AssetSymbol[];
const GROUP_ORDER: readonly MapGroup[] = ['fixture', 'buy'];
const EPOCH = '1970-01-01T00:00:00.000Z';

const groupOf = (run: RunRecord): MapGroup | null => (run.kind === 'fixture' || run.kind === 'buy' ? run.kind : null);

/** A row is named by its path, without our fixtures' mount point or buy's version prefix. */
function rowLabel(group: MapGroup, url: string): string {
  try {
    const path = new URL(url).pathname;
    const label = (group === 'fixture' ? path.replace(/^\/api\/fixtures/, '') : path.replace(/^\/v1(?=\/|$)/, '')).replace(/^\/+|\/+$/g, '');
    return label === '' ? '/' : clipText(label, MAX_ROW_LENGTH);
  } catch {
    return clipText(url, MAX_ROW_LENGTH);
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const when = (cell: MapCell): number => {
  const t = Date.parse(cell.at);
  return Number.isFinite(t) ? t : 0;
};
/** A real payment is never overwritten by a later guess; otherwise the later cell wins, and on a tie the one listed later. */
const beats = (a: MapCell, b: MapCell): boolean => (a.basis !== b.basis ? a.basis === 'CONFIRMED' : when(a) >= when(b));
const keyOf = (c: MapCell) => `${c.group}|${c.row}|${c.asset}`;

/** Several cells for one endpoint and asset become one, and the result comes out in a fixed order. */
export function mergeMapCells(existing: MapCell[], incoming: MapCell[]): MapCell[] {
  const best = new Map<string, MapCell>();
  for (const cell of [...existing, ...incoming]) {
    const held = best.get(keyOf(cell));
    if (held === undefined || beats(cell, held)) best.set(keyOf(cell), cell);
  }
  return [...best.values()].sort(
    (x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group) || compare(x.row, y.row) || ASSET_ORDER.indexOf(x.asset) - ASSET_ORDER.indexOf(y.asset),
  );
}

/** The cells of the runs of our own endpoints. A run of anyone else's endpoint never makes one. */
export function mapCells(runs: RunRecord[]): MapCell[] {
  const found: MapCell[] = [];
  for (const run of runs) {
    const group = groupOf(run);
    if (group === null) continue;
    const row = rowLabel(group, run.endpoint.url);
    const parsed = Date.parse(run.startedAt);
    const at = Number.isFinite(parsed) ? new Date(parsed).toISOString() : EPOCH; // a run whose time cannot be read counts as the oldest
    for (const v of run.verdicts) {
      if (v.assetSymbol === undefined) continue; // a verdict about the endpoint as a whole is not a cell
      found.push({ row, group, asset: v.assetSymbol, verdict: v.kind, basis: v.basis, ...(v.code === undefined ? {} : { code: v.code }), runId: run.id, at });
    }
  }
  return mergeMapCells([], found);
}
