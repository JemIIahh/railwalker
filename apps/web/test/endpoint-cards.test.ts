import { describe, expect, test } from 'vitest';
import type { MapCell } from '@railwalker/data';
import { endpointCards, featuredCards, filterCards, sortCards, type EndpointCard } from '../lib/endpoint-cards';

let n = 0;
const cell = (over: Partial<MapCell> = {}): MapCell => ({ row: 'ok', group: 'fixture', asset: 'USAT', verdict: 'PASS', basis: 'CONFIRMED', runId: (++n).toString(16).padStart(16, '0'), at: '2026-10-22T12:00:00.000Z', ...over });
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 12, minutes)).toISOString();

describe('endpointCards: one card for each endpoint', () => {
  test('the cells of an endpoint become one card, with the tokens it was tried with in the order tokens are listed', () => {
    const cards = endpointCards([cell({ asset: 'USAT' }), cell({ asset: 'USDC', basis: 'PREDICTED' }), cell({ row: 'paid/empty', asset: 'USAT' })]);
    expect(cards).toHaveLength(2);
    const ok = cards.find((c) => c.row === 'ok')!;
    expect(ok.tokens).toEqual(['USDC', 'USAT']);
    expect(ok).toMatchObject({ group: 'fixture', title: 'Healthy demo seller', where: 'Our demo seller' });
  });

  test('a paid test outweighs a prediction: the card says what the payment found, and that it was a paid test', () => {
    const confirmed = cell({ asset: 'USAT', verdict: 'FAIL', code: 'delivered_empty' });
    const predicted = cell({ asset: 'USDC', verdict: 'PASS', basis: 'PREDICTED' });
    const [card] = endpointCards([predicted, confirmed]);
    expect(card).toMatchObject({ verdict: 'FAIL', basis: 'CONFIRMED', code: 'delivered_empty', runId: confirmed.runId, paidTest: true });
  });

  test('a paid test wins even when a prediction is worse: a passing payment is not overruled by a guess that something fails', () => {
    const confirmed = cell({ asset: 'USAT', verdict: 'PASS' });
    const guess = cell({ asset: 'USDC', verdict: 'FAIL', code: 'payto_zero', basis: 'PREDICTED' });
    const [card] = endpointCards([guess, confirmed]);
    expect(card).toMatchObject({ verdict: 'PASS', basis: 'CONFIRMED', runId: confirmed.runId, paidTest: true });
  });

  test('when two results are equally bad the more recent one is shown, and with equal times the lower run id, so the card never flips', () => {
    const older = cell({ asset: 'USDC', verdict: 'FAIL', at: at(1) });
    const newer = cell({ asset: 'USAT', verdict: 'FAIL', at: at(9) });
    expect(endpointCards([older, newer])[0]!.runId).toBe(newer.runId);
    expect(endpointCards([newer, older])[0]!.runId).toBe(newer.runId);
    const a = cell({ asset: 'USDC', verdict: 'FAIL', at: at(5), runId: 'aaaaaaaaaaaaaaaa' });
    const b = cell({ asset: 'USAT', verdict: 'FAIL', at: at(5), runId: 'bbbbbbbbbbbbbbbb' });
    expect(endpointCards([b, a])[0]!.runId).toBe('aaaaaaaaaaaaaaaa');
    expect(endpointCards([a, b])[0]!.runId).toBe('aaaaaaaaaaaaaaaa');
  });

  test('the time is the latest of any cell, not just of the one the card tells the story of', () => {
    const [card] = endpointCards([cell({ asset: 'USAT', verdict: 'FAIL', at: at(1) }), cell({ asset: 'USDC', verdict: 'PASS', basis: 'PREDICTED', at: at(9) })]);
    expect(card).toMatchObject({ at: at(9), verdict: 'FAIL' });
  });

  test('with only predictions, the card says what the worst of them found, and that it was a quick look', () => {
    const fine = cell({ asset: 'USDC', verdict: 'PASS', basis: 'PREDICTED' });
    const bad = cell({ asset: 'USDT', verdict: 'FAIL', code: 'payto_zero', basis: 'PREDICTED' });
    const [card] = endpointCards([fine, bad]);
    expect(card).toMatchObject({ verdict: 'FAIL', basis: 'PREDICTED', code: 'payto_zero', runId: bad.runId, paidTest: false });
  });

  test('the worst of several paid results is the one shown: unsure, then broken, then needs polish, then works', () => {
    const kinds = ['PASS', 'PASS_WITH_WARNINGS', 'FAIL', 'AMBIGUOUS'] as const;
    const cells = kinds.map((verdict, i) => cell({ asset: (['USDC', 'USDT', 'USAT', 'wARS'] as const)[i]!, verdict }));
    expect(endpointCards(cells)[0]!.verdict).toBe('AMBIGUOUS');
    expect(endpointCards(cells.slice(0, 3))[0]!.verdict).toBe('FAIL');
    expect(endpointCards(cells.slice(0, 2))[0]!.verdict).toBe('PASS_WITH_WARNINGS');
    expect(endpointCards(cells.slice(0, 1))[0]!.verdict).toBe('PASS');
  });

  test('the card is as recent as the latest of its cells', () => {
    const [card] = endpointCards([cell({ asset: 'USDC', at: at(1) }), cell({ asset: 'USAT', at: at(9) })]);
    expect(card!.at).toBe(at(9));
  });

  test('our demo sellers and real services are told apart, even when they share a path', () => {
    const cards = endpointCards([cell({ row: 'ok', group: 'fixture' }), cell({ row: 'ok', group: 'buy' })]);
    expect(cards.map((c) => c.group).sort()).toEqual(['buy', 'fixture']);
  });

  test('no cells, no cards', () => {
    expect(endpointCards([])).toEqual([]);
  });
});

describe('sortCards and filterCards', () => {
  const cards = Object.freeze(endpointCards([
    cell({ row: 'ok', verdict: 'PASS', at: at(5) }),
    cell({ row: 'paid/empty', verdict: 'FAIL', code: 'delivered_empty', at: at(1) }),
    cell({ row: 'paid/slow', verdict: 'PASS_WITH_WARNINGS', at: at(9) }),
    cell({ row: 'paid/500', verdict: 'AMBIGUOUS', code: 'ambiguous_after_payment', at: at(3) }),
  ])) as EndpointCard[];

  test('most recent first, or the ones that need attention first and then the most recent', () => {
    expect(sortCards(cards, 'recent').map((c) => c.row)).toEqual(['paid/slow', 'ok', 'paid/500', 'paid/empty']);
    expect(sortCards(cards, 'problems').map((c) => c.row)).toEqual(['paid/500', 'paid/empty', 'paid/slow', 'ok']);
  });

  test('the list it was given is not changed', () => {
    const before = cards.map((c) => c.row);
    sortCards(cards, 'problems');
    expect(cards.map((c) => c.row)).toEqual(before);
  });

  test('the ones that work, the ones that need a fix (anything that is not fine), or all of them', () => {
    expect(filterCards(cards, 'all')).toHaveLength(4);
    expect(filterCards(cards, 'works').map((c) => c.row)).toEqual(['ok']);
    expect(filterCards(cards, 'fix').map((c) => c.row).sort()).toEqual(['paid/500', 'paid/empty', 'paid/slow']);
  });

  test('something that was not tested is neither one that works nor one that needs a fix', () => {
    const skipped = endpointCards([cell({ row: 'untested', verdict: 'SKIPPED', basis: 'PREDICTED' })]);
    expect(filterCards(skipped, 'works')).toEqual([]);
    expect(filterCards(skipped, 'fix')).toEqual([]);
    expect(filterCards(skipped, 'all')).toHaveLength(1);
  });
});

describe('featuredCards: a handful that show the range', () => {
  const many = endpointCards([
    cell({ row: 'ok', verdict: 'PASS', at: at(8) }),
    cell({ row: 'paid/empty', verdict: 'FAIL', code: 'delivered_empty', at: at(7) }),
    cell({ row: 'paid/slow', verdict: 'PASS_WITH_WARNINGS', at: at(6) }),
    cell({ row: 'paid/500', verdict: 'AMBIGUOUS', at: at(5) }),
    cell({ row: 'social/x/posts/search', group: 'buy', verdict: 'PASS', at: at(2) }),
    cell({ row: 'browser/sessions', group: 'buy', verdict: 'PASS', at: at(1) }),
    cell({ row: 'bad/decimals', verdict: 'PASS_WITH_WARNINGS', basis: 'PREDICTED', at: at(9) }),
  ]);

  test('one of each kind of result first (works, needs polish, broken, not sure), real services ahead of demos, then the most recent', () => {
    const rows = featuredCards(many, 6).map((c) => c.row);
    // the four kinds first, then what is left by recency: ok (8 minutes) before paid/slow (6)
    expect(rows).toEqual(['social/x/posts/search', 'bad/decimals', 'paid/empty', 'paid/500', 'ok', 'paid/slow']);
  });

  test('never more than asked for, and nothing twice', () => {
    expect(featuredCards(many, 3)).toHaveLength(3);
    expect(featuredCards(many, 0)).toEqual([]);
    expect(featuredCards(many, 50)).toHaveLength(7);
  });
});
