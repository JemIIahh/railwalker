import { ASSETS, FINDING_ORDER, FINDING_SEVERITY, assetByAddress, type AssetSymbol, type Finding, type FindingCode, type Severity, type Verdict, type VerdictKind } from '@railwalker/core';
import type { MapCell, MapGroup, ScanSummary } from '@railwalker/data';
import type { RunRecord } from '@railwalker/scanner';
import { MONTHS } from './time';

const ASSET_ORDER = Object.keys(ASSETS) as AssetSymbol[];
const GROUP_ORDER: readonly MapGroup[] = ['fixture', 'buy'];
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);


export interface MapRow {
  label: string;
  cells: Partial<Record<AssetSymbol, MapCell>>;
}

export interface MapView {
  /** Only the assets that appear, in the order the assets are listed. */
  assets: AssetSymbol[];
  groups: { group: MapGroup; rows: MapRow[] }[];
}

/** Cells laid out for drawing: a column for each asset that appears, a row for each endpoint, a gap where there is no cell. */
export function mapRows(cells: MapCell[]): MapView {
  const assets = ASSET_ORDER.filter((asset) => cells.some((c) => c.asset === asset));
  const groups: MapView['groups'] = [];
  for (const group of GROUP_ORDER) {
    const rows = new Map<string, MapRow>();
    for (const cell of cells) {
      if (cell.group !== group) continue;
      const row = rows.get(cell.row) ?? { label: cell.row, cells: {} };
      row.cells[cell.asset] = cell;
      rows.set(cell.row, row);
    }
    if (rows.size > 0) groups.push({ group, rows: [...rows.values()] });
  }
  return { assets, groups };
}

/** A web address in two parts: the host, to be shown quietly, and the path (with its query), to be shown plain. Anything else is all path. */
export function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: `${u.pathname}${u.search}` };
  } catch {
    return { host: '', path: url };
  }
}

/** A row's name in two parts: the folders it sits in, to be shown quietly, and the last part, to be shown plain. */
export function splitRow(label: string): { dir: string; leaf: string } {
  const at = label.lastIndexOf('/');
  if (at === 0 || at === label.length - 1) return { dir: '', leaf: label }; // no folder: a lone slash, a leading one, a trailing one, or none at all
  return { dir: label.slice(0, at + 1), leaf: label.slice(at + 1) };
}

export const describeVerdict = (v: { verdict: VerdictKind; code?: string }): string => (v.code === undefined ? v.verdict : `${v.verdict}:${v.code}`);

/** Whole dollars without the cents, for the big round numbers (a limit of $3); anything finer as formatUsd writes it. */
export function formatUsdShort(n: number): string {
  return Number.isInteger(n) ? `$${n}` : formatUsd(n); // a number that is not a number is not an integer either, and formatUsd gives the dash
}

/** Whole cents as dollars and cents, anything finer to the digit it needs (up to a millionth), so a ledger never rounds away money. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) < 1e-9) return `$${(cents / 100).toFixed(2)}`;
  return `$${n.toFixed(6).replace(/0+$/, '')}`;
}

/** A moment written the one way everywhere, in UTC, whatever the visitor's locale: `22 Oct 2026, 12:00 UTC`. */
export function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** What a payment was, in words: exact dollars for a dollar asset, otherwise the raw amount of the token, never a guessed value. */
export function formatPaid(asset: string, amountAtomic: string): string {
  if (!/^\d{1,78}$/.test(amountAtomic)) return '—';
  const amount = BigInt(amountAtomic);
  const info = assetByAddress(asset);
  if (info === null) return `${amount} units of an unknown token`;
  if (!info.usdPegged) return `${amount} units of ${info.symbol}`;
  const scale = 10n ** BigInt(info.decimals);
  const fraction = (amount % scale).toString().padStart(info.decimals, '0').replace(/0+$/, '').padEnd(2, '0');
  return `$${amount / scale}.${fraction}`;
}

export const shortHash = (hash: string): string => (hash.length <= 12 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`);

/** A link to a transaction, or null for anything that is not a real transaction hash: nothing else is ever put in a link. */
export function explorerTxUrl(hash: string): string | null {
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `https://celo.blockscout.com/tx/${hash}` : null;
}

/** A link to an address, or null for anything that is not a real address: nothing else is ever put in a link. */
export function explorerAddressUrl(address: string): string | null {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `https://celo.blockscout.com/address/${address}` : null;
}

export interface FindingBar {
  code: FindingCode;
  count: number;
  /** Of the endpoints scanned, from zero to one. */
  share: number;
  severity: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
const assetRank = (symbol: AssetSymbol | undefined): number => (symbol === undefined ? -1 : ASSET_ORDER.indexOf(symbol));
const share = (count: number, of: number): number => (of <= 0 ? 0 : Math.min(1, count / of));

/**
 * What breaks most, the most common first; equal counts by how serious the finding is, then by name, so the list never shuffles.
 * A note that only informs is not a breakage and is left out: the commonest of them would top every chart and say nothing.
 */
export function findingBars(summary: ScanSummary, limit = 6): FindingBar[] {
  return FINDING_ORDER.filter((code) => FINDING_SEVERITY[code] !== 'info' && (summary.byFinding[code] ?? 0) > 0)
    .map((code) => ({ code, count: summary.byFinding[code]!, share: share(summary.byFinding[code]!, summary.endpointsScanned), severity: FINDING_SEVERITY[code] }))
    .sort((a, b) => b.count - a.count || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || compare(a.code, b.code))
    .slice(0, limit);
}

export interface AssetBar {
  symbol: AssetSymbol;
  count: number;
  share: number;
}

/** Each asset's share of the endpoints scanned that accept it on Celo mainnet. */
export function assetBars(summary: ScanSummary): AssetBar[] {
  return ASSET_ORDER.filter((symbol) => (summary.assetAcceptance[symbol] ?? 0) > 0).map((symbol) => ({
    symbol,
    count: summary.assetAcceptance[symbol]!,
    share: share(summary.assetAcceptance[symbol]!, summary.endpointsScanned),
  }));
}

/**
 * What a buyer would hit in one run: its errors and warnings, each shown once however many verdicts repeat it (the copy a payment
 * confirmed wins over a prediction), the most serious first. Notes that only inform are counted by kind, not listed.
 */
export function runFindings(run: RunRecord): { issues: Finding[]; notes: number } {
  const issues = new Map<string, Finding>();
  const notes = new Set<FindingCode>();
  for (const verdict of run.verdicts) {
    for (const found of verdict.findings) {
      if (found.severity === 'info') {
        notes.add(found.code);
        continue;
      }
      const key = `${found.code}|${found.assetSymbol ?? ''}`;
      const held = issues.get(key);
      if (held === undefined || (held.basis !== 'CONFIRMED' && found.basis === 'CONFIRMED')) issues.set(key, found);
    }
  }
  const ordered = [...issues.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || FINDING_ORDER.indexOf(a.code) - FINDING_ORDER.indexOf(b.code) || assetRank(a.assetSymbol) - assetRank(b.assetSymbol),
  );
  return { issues: ordered, notes: notes.size };
}

/** A run's verdicts in two piles: what a real payment confirmed, and what is only predicted. The whole endpoint comes first, then the assets in their listed order. */
export function groupVerdicts(run: RunRecord): { confirmed: Verdict[]; predicted: Verdict[] } {
  const ordered = [...run.verdicts].sort((a, b) => assetRank(a.assetSymbol) - assetRank(b.assetSymbol));
  return { confirmed: ordered.filter((v) => v.basis === 'CONFIRMED'), predicted: ordered.filter((v) => v.basis !== 'CONFIRMED') };
}
