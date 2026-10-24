import { LedgerFileSchema, MapFileSchema, RunRecordSchema, ScanSummarySchema, publicRun, type DataStore, type LedgerFile, type MapFile, type ScanSummary } from '@railwalker/data';
import type { RunRecord } from '@railwalker/scanner';

/** What a page can be told about a file: it is there, nothing has been published yet, or something is wrong, and what. */
export type Loaded<T> = { state: 'ready'; value: T } | { state: 'empty' } | { state: 'broken'; why: 'invalid' | 'unavailable' };

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Never throws: a page must be able to say "no data yet" or "data unavailable" instead of failing. */
async function load<T>(store: DataStore, path: string, schema: Parser<T>): Promise<Loaded<T>> {
  let text: string | null;
  try {
    text = await store.read(path);
  } catch {
    return { state: 'broken', why: 'unavailable' };
  }
  if (text === null) return { state: 'empty' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { state: 'broken', why: 'invalid' };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { state: 'ready', value: parsed.data } : { state: 'broken', why: 'invalid' };
}

export const loadSummary = (store: DataStore): Promise<Loaded<ScanSummary>> => load(store, 'summary.json', ScanSummarySchema);
export const loadMap = (store: DataStore): Promise<Loaded<MapFile>> => load(store, 'map.json', MapFileSchema);
export const loadLedger = (store: DataStore): Promise<Loaded<LedgerFile>> => load(store, 'ledger.json', LedgerFileSchema);

const RUN_ID = /^[0-9a-f]{16}$/;

/**
 * One run, by the id in a URL. Only a real run id reaches the store, so a visitor cannot make the site fetch other paths; a run
 * that is not one of ours to show, or that is a different run from its file name, is never displayed.
 */
export async function loadRun(store: DataStore, id: string): Promise<Loaded<RunRecord>> {
  if (!RUN_ID.test(id)) return { state: 'empty' };
  const loaded = await load(store, `runs/${id}.json`, RunRecordSchema);
  if (loaded.state !== 'ready') return loaded;
  if (loaded.value.id !== id) return { state: 'broken', why: 'invalid' };
  return publicRun(loaded.value) === null ? { state: 'empty' } : loaded;
}
