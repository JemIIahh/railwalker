import { ASSETS, type AssetSymbol, type Basis, type VerdictKind } from '@railwalker/core';
import type { MapCell, MapGroup } from '@railwalker/data';
import { friendlyName } from './friendly';
import { statusOf } from './status';

/** One endpoint as a card: its name, the tokens it was tried with, and what the most telling test of it found. */
export interface EndpointCard {
  key: string;
  group: MapGroup;
  row: string;
  title: string;
  where: string;
  tokens: AssetSymbol[];
  verdict: VerdictKind;
  basis: Basis;
  code?: string;
  runId: string;
  at: string;
  /** Whether a real payment was made to find out. */
  paidTest: boolean;
}

/** The worse the news, the higher: not sure, then broken, then needs polish, then works, then not tested. */
const WORST: Record<VerdictKind, number> = { AMBIGUOUS: 4, FAIL: 3, PASS_WITH_WARNINGS: 2, PASS: 1, SKIPPED: 0 };
const ASSET_ORDER = Object.keys(ASSETS) as AssetSymbol[];
const time = (iso: string): number => (Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One card for each endpoint. A paid test outweighs a prediction, so if any payment was made the card says what the worst of the paid
 * results found; otherwise what the worst of the predictions found. Its time is the latest of all its cells.
 */
export function endpointCards(cells: MapCell[]): EndpointCard[] {
  const groups = new Map<string, MapCell[]>();
  for (const cell of cells) {
    const key = `${cell.group}|${cell.row}`;
    groups.set(key, [...(groups.get(key) ?? []), cell]);
  }
  return [...groups.entries()].map(([key, list]): EndpointCard => {
    const paid = list.filter((c) => c.basis === 'CONFIRMED');
    const pool = paid.length > 0 ? paid : list;
    const head = pool.reduce((best, c) => (WORST[c.verdict] > WORST[best.verdict] || (WORST[c.verdict] === WORST[best.verdict] && (time(c.at) > time(best.at) || (time(c.at) === time(best.at) && compare(c.runId, best.runId) < 0))) ? c : best));
    const latest = list.reduce((best, c) => (time(c.at) > time(best.at) ? c : best));
    const first = list[0]!;
    return {
      key,
      group: first.group,
      row: first.row,
      ...friendlyName(first.group, first.row),
      tokens: ASSET_ORDER.filter((a) => list.some((c) => c.asset === a)),
      verdict: head.verdict,
      basis: head.basis,
      ...(head.code === undefined ? {} : { code: head.code }),
      runId: head.runId,
      at: latest.at,
      paidTest: paid.length > 0,
    };
  });
}

export type CardSort = 'recent' | 'problems';

/** Most recent first, or the ones that need attention first and then the most recent. The list given is not changed. */
export function sortCards(cards: EndpointCard[], by: CardSort): EndpointCard[] {
  return [...cards].sort(
    (a, b) => (by === 'problems' ? WORST[b.verdict] - WORST[a.verdict] : 0) || time(b.at) - time(a.at) || compare(a.title, b.title),
  );
}

export type CardFilter = 'all' | 'works' | 'fix';

export function filterCards(cards: EndpointCard[], filter: CardFilter): EndpointCard[] {
  if (filter === 'all') return cards;
  return cards.filter((c) => {
    const tone = statusOf(c.verdict, c.basis).tone;
    return filter === 'works' ? tone === 'good' : tone === 'warn' || tone === 'bad' || tone === 'unsure';
  });
}

/** A handful that show the range: one of each kind of result first, real services ahead of our demos, then the most recent. */
export function featuredCards(cards: EndpointCard[], count: number): EndpointCard[] {
  const picked: EndpointCard[] = [];
  for (const tone of ['good', 'warn', 'bad', 'unsure'] as const) {
    const best = cards
      .filter((c) => statusOf(c.verdict, c.basis).tone === tone)
      .sort((a, b) => Number(b.group === 'buy') - Number(a.group === 'buy') || time(b.at) - time(a.at) || compare(a.title, b.title))[0];
    if (best !== undefined && picked.length < count) picked.push(best);
  }
  for (const card of sortCards(cards, 'recent')) if (picked.length < count && !picked.includes(card)) picked.push(card);
  return picked;
}
