import { afterEach, describe, expect, test, vi } from 'vitest';
import esBadAddress from './fixtures/blockscout-es-bad-address.json' with { type: 'json' };
import esNone from './fixtures/blockscout-es-none.json' with { type: 'json' };
import esTokentx from './fixtures/blockscout-es-tokentx-asc.json' with { type: 'json' };
import esTxlist from './fixtures/blockscout-es-txlist-asc.json' with { type: 'json' };
import v2Page1 from './fixtures/blockscout-v2-transfers-page1.json' with { type: 'json' };
import v2Page2 from './fixtures/blockscout-v2-transfers-page2.json' with { type: 'json' };
import { getWalletFacts, listTokenTransfers } from '../src';

const ME = '0x1234567890abcdef1234567890abcdef12345678';
const ME_CHECKSUM = '0x1234567890AbcdEF1234567890aBcdef12345678';
const SOMEONE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ELSE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = '0xcccccccccccccccccccccccccccccccccccccccc';

type Route = (url: URL) => Response | object | undefined;
/** A Blockscout that answers from `route`, and remembers what it was asked. */
function blockscout(route: Route) {
  const calls: URL[] = [];
  const headers: Record<string, string>[] = [];
  const inits: RequestInit[] = [];
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    inits.push(init ?? {});
    headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
    const out = route(url);
    if (out === undefined) throw new Error(`no route for ${url.href}`);
    return out instanceof Response ? out : Response.json(out);
  }) as typeof fetch;
  return { f, calls, headers, inits };
}

const unix = (iso: string) => String(Date.parse(iso) / 1000);
/** A real transaction record from the recorded response, changed to say what the test needs. */
const tx = (o: { at: string; from: string; to: string; value?: string; failed?: boolean; block?: number; hash?: string }) => ({
  ...esTxlist.result[0]!,
  timeStamp: unix(o.at),
  blockNumber: String(o.block ?? 1000),
  from: o.from,
  to: o.to,
  value: o.value ?? '0',
  isError: o.failed ? '1' : '0',
  txreceipt_status: o.failed ? '0' : '1',
  hash: o.hash ?? `0x${'1'.repeat(64)}`,
});
/** The same for a token transfer record. */
const transfer = (o: { at: string; from: string; to: string; value?: string; block?: number; hash?: string }) => ({
  ...esTokentx.result[0]!,
  timeStamp: unix(o.at),
  blockNumber: String(o.block ?? 1000),
  from: o.from,
  to: o.to,
  value: o.value ?? '5000',
  hash: o.hash ?? `0x${'2'.repeat(64)}`,
});

const page = (all: unknown[], u: URL) => {
  const n = Number(u.searchParams.get('page'));
  const size = Number(u.searchParams.get('offset'));
  return all.slice((n - 1) * size, n * size);
};
/** The Etherscan-compatible API over two complete histories, oldest first: it pages them the way it is asked to. */
function history(txs: unknown[], transfers: unknown[]) {
  return blockscout((u) => {
    if (u.pathname !== '/api') return undefined;
    const items = page(u.searchParams.get('action') === 'txlist' ? txs : transfers, u);
    return { status: items.length ? '1' : '0', message: items.length ? 'OK' : 'No transactions found', result: items };
  });
}
const ofAction = (calls: URL[], action: string) => calls.filter((u) => u.searchParams.get('action') === action);

describe('getWalletFacts', () => {
  test('the first activity is the earlier of the first transaction and the first token transfer, and the first funder is the sender of the earliest inbound transfer', async () => {
    const b = history([tx({ at: '2026-08-03T10:00:00Z', from: ME, to: ELSE })], [transfer({ at: '2026-08-10T10:00:00Z', from: SOMEONE, to: ME })]);
    expect(await getWalletFacts(ME, { fetchImpl: b.f })).toEqual({ address: ME, firstActivityAt: '2026-08-03T10:00:00.000Z', firstFunder: SOMEONE });
  });

  test('a wallet with no transactions of its own but token transfers (a gasless signer) still has a first activity', async () => {
    const b = history([], [transfer({ at: '2026-07-15T08:30:00Z', from: SOMEONE, to: ME })]);
    expect(await getWalletFacts(ME, { fetchImpl: b.f })).toEqual({ address: ME, firstActivityAt: '2026-07-15T08:30:00.000Z', firstFunder: SOMEONE });
  });

  test('a wallet that has never done anything has neither', async () => {
    const b = history([], []);
    expect(await getWalletFacts(ME, { fetchImpl: b.f })).toEqual({ address: ME, firstActivityAt: null, firstFunder: null });
  });

  test('the real recorded "none found" answer is an empty history, not an error', async () => {
    const b = blockscout(() => esNone);
    expect(await getWalletFacts(ME, { fetchImpl: b.f })).toEqual({ address: ME, firstActivityAt: null, firstFunder: null });
  });

  test('the recorded real answers work as they are: a transaction history and a transfer history', async () => {
    const b = blockscout((u) => (u.searchParams.get('action') === 'txlist' ? esTxlist : esTokentx));
    const facts = await getWalletFacts('0x20faAca5F980E29639A0FCC6dcA6988E18ed333B', { fetchImpl: b.f });
    expect(facts.firstActivityAt).toBe('2026-02-05T13:19:00.000Z'); // the earlier of the two histories' first records
    expect(facts.firstFunder).toBe('0xa242f5baa872ac3920b84ac2a5cd68e63460578b'); // the first inbound transfer of the real response
  });

  test('the address is echoed as it was given, and looked up in lower case', async () => {
    const b = history([], []);
    const facts = await getWalletFacts(ME_CHECKSUM, { fetchImpl: b.f });
    expect(facts.address).toBe(ME_CHECKSUM);
    expect(b.calls.every((u) => u.searchParams.get('address') === ME)).toBe(true);
  });

  test('between an inbound native transfer and an inbound token transfer the earlier one is the funder, whichever kind it is', async () => {
    const early = [tx({ at: '2026-08-01T00:00:00Z', from: SOMEONE, to: ME, value: '1000000000000000000', block: 100 })];
    const late = [transfer({ at: '2026-08-02T00:00:00Z', from: ELSE, to: ME, block: 200 })];
    expect((await getWalletFacts(ME, { fetchImpl: history(early, late).f })).firstFunder).toBe(SOMEONE);
    const earlyToken = [transfer({ at: '2026-08-01T00:00:00Z', from: SOMEONE, to: ME, block: 100 })];
    const lateTx = [tx({ at: '2026-08-02T00:00:00Z', from: ELSE, to: ME, value: '1', block: 200 })];
    expect((await getWalletFacts(ME, { fetchImpl: history(lateTx, earlyToken).f })).firstFunder).toBe(SOMEONE);
  });

  test('a transaction that failed moved no value, so it funds nothing, but it is still activity', async () => {
    const b = history([tx({ at: '2026-07-01T00:00:00Z', from: ELSE, to: ME, value: '5', failed: true })], [transfer({ at: '2026-08-01T00:00:00Z', from: SOMEONE, to: ME })]);
    const facts = await getWalletFacts(ME, { fetchImpl: b.f });
    expect(facts.firstFunder).toBe(SOMEONE);
    expect(facts.firstActivityAt).toBe('2026-07-01T00:00:00.000Z');
  });

  test('a transaction with no value funds nothing, and nor does a zero-value transfer (address poisoning)', async () => {
    const b = history([tx({ at: '2026-07-01T00:00:00Z', from: ELSE, to: ME, value: '0' })], [transfer({ at: '2026-07-02T00:00:00Z', from: OTHER, to: ME, value: '0' }), transfer({ at: '2026-07-03T00:00:00Z', from: SOMEONE, to: ME, value: '1' })]);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstFunder).toBe(SOMEONE);
  });

  test('the earliest inbound record is the funder even when the answer lists a later one first', async () => {
    const b = history([], [transfer({ at: '2026-09-01T00:00:00Z', from: ELSE, to: ME, block: 900 }), transfer({ at: '2026-03-01T00:00:00Z', from: SOMEONE, to: ME, block: 300 })]);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstFunder).toBe(SOMEONE);
  });

  test('what the wallet sent is not what funded it', async () => {
    const b = history([], [transfer({ at: '2026-07-01T00:00:00Z', from: ME, to: ELSE }), transfer({ at: '2026-07-02T00:00:00Z', from: SOMEONE, to: ME })]);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstFunder).toBe(SOMEONE);
  });

  test('when the first page is all outbound the search goes on to the next pages, and stops as soon as it finds an inbound one', async () => {
    const out = Array.from({ length: 30 }, (_, i) => transfer({ at: '2026-07-01T00:00:00Z', from: ME, to: ELSE, block: 10 + i }));
    const b = history([], [...out, transfer({ at: '2026-07-05T00:00:00Z', from: SOMEONE, to: ME, block: 100 })]);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstFunder).toBe(SOMEONE);
    expect(ofAction(b.calls, 'tokentx').map((u) => u.searchParams.get('page'))).toEqual(['1', '2']);
  });

  test('an inbound transfer on the first page means there is no second page request', async () => {
    const b = history([], Array.from({ length: 80 }, (_, i) => transfer({ at: '2026-07-01T00:00:00Z', from: SOMEONE, to: ME, block: 10 + i })));
    await getWalletFacts(ME, { fetchImpl: b.f });
    expect(ofAction(b.calls, 'tokentx')).toHaveLength(1);
    expect(ofAction(b.calls, 'txlist')).toHaveLength(1);
  });

  test('it gives up looking for a funder after four pages of each: the funder is then unknown, not guessed', async () => {
    const out = Array.from({ length: 500 }, (_, i) => transfer({ at: '2026-07-01T00:00:00Z', from: ME, to: ELSE, block: 10 + i }));
    const b = history([], out);
    const facts = await getWalletFacts(ME, { fetchImpl: b.f });
    expect(facts.firstFunder).toBeNull();
    expect(facts.firstActivityAt).toBe('2026-07-01T00:00:00.000Z');
    expect(ofAction(b.calls, 'tokentx')).toHaveLength(4);
  });

  test('a history that is shorter than a page ends the search without asking for another', async () => {
    const b = history([], [transfer({ at: '2026-07-01T00:00:00Z', from: ME, to: ELSE })]);
    await getWalletFacts(ME, { fetchImpl: b.f });
    expect(ofAction(b.calls, 'tokentx')).toHaveLength(1);
  });

  test('the first activity is the earliest record on the page, even if the answer is not in the order that was asked for', async () => {
    const b = history([tx({ at: '2026-09-01T00:00:00Z', from: ME, to: ELSE, block: 900 }), tx({ at: '2026-03-01T00:00:00Z', from: ME, to: ELSE, block: 300 })], []);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstActivityAt).toBe('2026-03-01T00:00:00.000Z');
  });

  test('records that are not what a record looks like are skipped, never trusted: each broken one is EARLIER than the good one, so accepting it would show', async () => {
    const earlyFromElse = transfer({ at: '2026-01-01T00:00:00Z', from: ELSE, to: ME, block: 1 });
    const good = transfer({ at: '2026-08-01T00:00:00Z', from: SOMEONE, to: ME, block: 500 });
    const junk = [
      null,
      7,
      'text',
      [],
      {},
      { ...earlyFromElse, timeStamp: 'yesterday' },
      { ...earlyFromElse, blockNumber: 'x' },
      { ...earlyFromElse, from: 'not an address' },
      { ...earlyFromElse, from: undefined },
      { ...earlyFromElse, to: undefined },
      { ...earlyFromElse, to: 'nope' },
      { ...earlyFromElse, value: '-5' },
      { ...earlyFromElse, value: '1.5' },
      { ...earlyFromElse, value: 'x'.repeat(100) },
      { ...earlyFromElse, value: undefined },
    ];
    const b = history([], [...junk, good]);
    expect(await getWalletFacts(ME, { fetchImpl: b.f })).toEqual({ address: ME, firstActivityAt: '2026-08-01T00:00:00.000Z', firstFunder: SOMEONE });
  });

  test('a record with an absurd timestamp is not activity: it is skipped rather than turned into a date that does not exist', async () => {
    const b = history([], [{ ...transfer({ at: '2026-08-01T00:00:00Z', from: SOMEONE, to: ME }), timeStamp: '99999999999999999' }]);
    expect(await getWalletFacts(ME, { fetchImpl: b.f })).toEqual({ address: ME, firstActivityAt: null, firstFunder: null });
  });

  test('an address with a wrong checksum, or none, is accepted: Blockscout answers for any letter case', async () => {
    const wrongChecksum = '0x1234567890abcdEF1234567890aBcdef12345678'; // the valid form has a capital A where this has a small one
    const b = history([], []);
    await expect(getWalletFacts(wrongChecksum, { fetchImpl: b.f })).resolves.toMatchObject({ address: wrongChecksum });
    const t = blockscout(() => ({ items: [], next_page_params: null }));
    await expect(listTokenTransfers(wrongChecksum, { direction: 'in' }, { fetchImpl: t.f })).resolves.toEqual([]);
  });

  test('a reply that is not a list of records is an error, not an empty history', async () => {
    for (const [reply, why] of [
      [{ status: '1', message: 'OK', result: 'oops' }, /not a list/],
      [{ status: '1', message: 'OK', result: { a: 1 } }, /not a list/],
      [{ status: '0', message: 'Rate limit reached', result: null }, /Rate limit reached/],
      [[], /shape/],
      ['x', /shape/],
      [null, /shape/],
    ] as const) {
      const b = blockscout(() => Response.json(reply));
      await expect(getWalletFacts(ME, { fetchImpl: b.f }), JSON.stringify(reply)).rejects.toThrow(why);
    }
  });

  test('the recorded invalid-address answer is an error that says so', async () => {
    const b = blockscout(() => esBadAddress);
    await expect(getWalletFacts(ME, { fetchImpl: b.f })).rejects.toThrow(/Invalid address format/);
  });

  test('one half failing fails the whole call: partial facts could make a wallet look independent', async () => {
    const b = blockscout((u) => (u.searchParams.get('action') === 'txlist' ? { status: '0', message: 'No transactions found', result: [] } : new Response('down', { status: 500 })));
    await expect(getWalletFacts(ME, { fetchImpl: b.f })).rejects.toThrow(/500/);
  });

  test.each([['0x123'], ['not an address'], [''], ['0x' + 'g'.repeat(40)]])('%j is not an address, and nothing is asked', async (address) => {
    const b = history([], []);
    await expect(getWalletFacts(address, { fetchImpl: b.f })).rejects.toThrow(/address/);
    expect(b.calls).toEqual([]);
  });

  test('it asks the Etherscan-compatible API for ascending history, a small page at a time, as a browser would', async () => {
    const b = history([], []);
    await getWalletFacts(ME, { fetchImpl: b.f });
    expect(b.calls.map((u) => `${u.origin}${u.pathname}`)).toEqual(['https://celo.blockscout.com/api', 'https://celo.blockscout.com/api']);
    expect(b.calls.map((u) => u.searchParams.get('action')).sort()).toEqual(['tokentx', 'txlist']);
    for (const u of b.calls) {
      expect(Object.fromEntries(u.searchParams)).toMatchObject({ module: 'account', address: ME, sort: 'asc', page: '1', offset: '25' });
    }
    for (const h of b.headers) {
      expect(h['user-agent']).toMatch(/^Mozilla\/5\.0 .*Chrome/);
      expect(h.accept).toContain('application/json');
    }
    for (const init of b.inits) expect(init).toMatchObject({ method: 'GET', redirect: 'manual' }); // a redirect is never followed
  });

  test('a contract creation (a transaction with no to) is activity like any other', async () => {
    const b = history([tx({ at: '2026-06-01T00:00:00Z', from: ME, to: '' })], []);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstActivityAt).toBe('2026-06-01T00:00:00.000Z');
  });

  test('when a transaction and a token transfer fund the wallet at the very same moment, the transaction is the funder', async () => {
    const b = history([tx({ at: '2026-08-01T00:00:00Z', from: SOMEONE, to: ME, value: '7', block: 500 })], [transfer({ at: '2026-08-01T00:00:00Z', from: ELSE, to: ME, block: 500 })]);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstFunder).toBe(SOMEONE);
    const swapped = history([], [transfer({ at: '2026-08-01T00:00:00Z', from: ELSE, to: ME, block: 500 })]);
    expect((await getWalletFacts(ME, { fetchImpl: swapped.f })).firstFunder).toBe(ELSE);
  });

  test('within one block the earlier timestamp is the earlier record', async () => {
    const b = history([], [transfer({ at: '2026-08-01T00:00:09Z', from: ELSE, to: ME, block: 500 }), transfer({ at: '2026-08-01T00:00:01Z', from: SOMEONE, to: ME, block: 500 })]);
    expect((await getWalletFacts(ME, { fetchImpl: b.f })).firstFunder).toBe(SOMEONE);
  });

  test('another Blockscout can be named, with or without a trailing slash', async () => {
    const b = history([], []);
    await getWalletFacts(ME, { fetchImpl: b.f, baseUrl: 'https://scan.example/' });
    expect(b.calls.every((u) => u.origin === 'https://scan.example' && u.pathname === '/api')).toBe(true);
  });
});

describe('Blockscout, when it misbehaves', () => {
  afterEach(() => vi.useRealTimers());
  const sleeps = () => {
    const waited: number[] = [];
    return { waited, sleep: async (ms: number) => void waited.push(ms) };
  };
  const first = (n: number) => ({ items: [], next_page_params: null, n });

  test('a 429 is retried after the wait it asks for, then again after doubling waits, and then it works', async () => {
    const { waited, sleep } = sleeps();
    const answers = [new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }), new Response('slow down', { status: 429 }), Response.json(first(1))];
    const b = blockscout(() => answers.shift());
    expect(await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f, sleep })).toEqual([]);
    expect(waited).toEqual([2000, 1000]); // what it asked for, then 500 ms doubled once
    expect(b.calls).toHaveLength(3);
  });

  test('it gives up after five attempts, with waits that double, and says it was the rate limit', async () => {
    const { waited, sleep } = sleeps();
    const b = blockscout(() => new Response('slow down', { status: 429 }));
    await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f, sleep })).rejects.toThrow(/rate limit/);
    expect(b.calls).toHaveLength(5);
    expect(waited).toEqual([500, 1000, 2000, 4000]); // none after the last attempt
  });

  test.each([
    ['999', 30_000],
    ['0', 0],
    ['abc', 500],
    ['', 500],
    ['Infinity', 500],
    ['-5', 500],
    ['1.5', 1500],
  ])('a retry-after of %j waits %i ms: it is believed up to thirty seconds and ignored when it makes no sense', async (header, expected) => {
    const { waited, sleep } = sleeps();
    const answers = [new Response('slow', { status: 429, headers: { 'retry-after': header } }), Response.json(first(1))];
    const b = blockscout(() => answers.shift());
    await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f, sleep });
    expect(waited).toEqual([expected]);
  });

  test('an error that is not a rate limit is not retried', async () => {
    const { waited, sleep } = sleeps();
    for (const status of [302, 400, 404, 500, 503]) {
      const b = blockscout(() => new Response('no', { status }));
      await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f, sleep })).rejects.toThrow(new RegExp(String(status)));
      expect(b.calls).toHaveLength(1);
    }
    expect(waited).toEqual([]);
  });

  test('the body of an answer it will not read is cancelled, so the connection is released', async () => {
    for (const status of [429, 500]) {
      let cancelled = false;
      const body = new ReadableStream({ cancel: () => void (cancelled = true) });
      const answers = [new Response(body, { status }), Response.json(first(1))];
      await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => answers.shift()).f, sleep: async () => {} }).catch(() => {});
      expect(cancelled, String(status)).toBe(true);
    }
  });

  test('an answer that is not JSON, or is too large, is an error', async () => {
    await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => new Response('<html>')).f })).rejects.toThrow(/not JSON/);
    await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => new Response('x'.repeat(6 * 1024 * 1024))).f })).rejects.toThrow(/too large/);
  });

  test('a Blockscout that goes quiet is an error once the deadline passes, and the connection is let go', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const silent = ((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const settled = expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: silent })).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(signals[0]?.aborted).toBe(true);
  });

  test('no timer is left running after an answer', async () => {
    vi.useFakeTimers();
    await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => first(1)).f });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('listTokenTransfers', () => {
  const last = { ...v2Page2, next_page_params: null };

  test('reads transfers into the ledger’s own shape, lower-cased, oldest first, following next_page_params to the end', async () => {
    const b = blockscout((u) => (u.searchParams.has('index') ? last : v2Page1));
    const out = await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f });
    expect(out).toHaveLength(6);
    expect(out.map((t) => t.at)).toEqual([...out.map((t) => t.at)].sort());
    const newest = out.at(-1)!;
    const raw = v2Page1.items[0]!;
    expect(newest).toEqual({
      txHash: raw.transaction_hash,
      from: raw.from.hash.toLowerCase(),
      to: raw.to.hash.toLowerCase(),
      token: raw.token.address_hash.toLowerCase(),
      amountAtomic: raw.total.value,
      at: new Date(raw.timestamp).toISOString(),
    });
    expect(new Set(out.map((t) => t.txHash)).size).toBe(6);
  });

  test('the second request carries exactly the next_page_params the first answer gave, and the type and direction every time', async () => {
    const b = blockscout((u) => (u.searchParams.has('index') ? last : v2Page1));
    await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f });
    expect(b.calls).toHaveLength(2);
    expect(Object.fromEntries(b.calls[0]!.searchParams)).toEqual({ type: 'ERC-20', filter: 'to' });
    expect(Object.fromEntries(b.calls[1]!.searchParams)).toEqual({ type: 'ERC-20', filter: 'to', index: '4', block_number: '80614721' });
    expect(b.calls.every((u) => u.pathname === `/api/v2/addresses/${ME}/token-transfers`)).toBe(true);
    for (const h of b.headers) expect(h['user-agent']).toMatch(/^Mozilla\/5\.0 .*Chrome/);
  });

  test('out means filter=from, and a token narrows the query to that token', async () => {
    const b = blockscout(() => ({ items: [], next_page_params: null }));
    await listTokenTransfers(ME, { direction: 'out' }, { fetchImpl: b.f });
    await listTokenTransfers(ME, { direction: 'in', token: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771' }, { fetchImpl: b.f });
    expect(Object.fromEntries(b.calls[0]!.searchParams)).toEqual({ type: 'ERC-20', filter: 'from' });
    expect(Object.fromEntries(b.calls[1]!.searchParams)).toEqual({ type: 'ERC-20', filter: 'to', token: '0xd2ab3c9a02dbbab236bfec45d1d755df4267f771' });
  });

  test('since keeps only transfers from then on, and stops paging as soon as a page reaches older ones', async () => {
    const third = new Date(v2Page1.items[2]!.timestamp).toISOString();
    const b = blockscout((u) => (u.searchParams.has('index') ? { ...v2Page2, next_page_params: { index: 9, filter: 'to', block_number: 1 } } : v2Page1));
    const out = await listTokenTransfers(ME, { direction: 'in', since: third }, { fetchImpl: b.f });
    expect(out.map((t) => t.at)).toEqual([...out.map((t) => t.at)].sort());
    expect(out.every((t) => t.at >= third)).toBe(true);
    expect(out).toHaveLength(3); // the three newest, and none of the older page
    expect(b.calls).toHaveLength(2); // page two was read to see that it is older, and no third page was asked for
  });

  test('a since later than the whole first page stops after that page', async () => {
    const b = blockscout(() => v2Page1);
    const out = await listTokenTransfers(ME, { direction: 'in', since: '2030-01-01T00:00:00Z' }, { fetchImpl: b.f });
    expect(out).toEqual([]);
    expect(b.calls).toHaveLength(1);
  });

  test('a since that is not a date is refused rather than ignored', async () => {
    await expect(listTokenTransfers(ME, { direction: 'in', since: 'last week' }, { fetchImpl: blockscout(() => v2Page1).f })).rejects.toThrow(/since/);
  });

  test('transfers that are not what a transfer looks like are skipped', async () => {
    const good = v2Page1.items[0]!;
    const junk = [null, 7, {}, { ...good, transaction_hash: 5 }, { ...good, transaction_hash: '0x123' }, { ...good, from: null }, { ...good, to: { hash: 'nope' } }, { ...good, token: null }, { ...good, total: { value: '1.5' } }, { ...good, total: null }, { ...good, timestamp: 'never' }, { ...good, token: { address_hash: 'nope' } }];
    const out = await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => ({ items: [...junk, good], next_page_params: null })).f });
    expect(out).toHaveLength(1);
    expect(out[0]!.txHash).toBe(good.transaction_hash);
  });

  test('a next_page_params that is not simple is not followed blindly: only short plain values under plain names are sent', async () => {
    let calls = 0;
    const b = blockscout(() => (++calls === 1 ? { items: [], next_page_params: { index: 4, nested: { a: 1 }, list: [1], 'has space': 'x', ['x'.repeat(50)]: 'long name', long: 'v'.repeat(500), flag: true, nothing: null, block_number: 77 } } : { items: [], next_page_params: null }));
    await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f });
    expect(Object.fromEntries(b.calls[1]!.searchParams)).toEqual({ type: 'ERC-20', filter: 'to', index: '4', flag: 'true', block_number: '77' });
  });

  test('values up to a hundred characters are sent, a hundred and one are not', async () => {
    let calls = 0;
    const b = blockscout(() => (++calls === 1 ? { items: [], next_page_params: { fits: 'v'.repeat(100), toolong: 'v'.repeat(101) } } : { items: [], next_page_params: null }));
    await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f });
    expect(Object.keys(Object.fromEntries(b.calls[1]!.searchParams)).sort()).toEqual(['filter', 'fits', 'type']);
  });

  test('what we ask for is not the server’s to change: next_page_params cannot override the type, the direction or the token', async () => {
    let calls = 0;
    const token = '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771';
    const b = blockscout(() => (++calls === 1 ? { items: [], next_page_params: { type: 'ERC-721', filter: 'from', token: '0x1111111111111111111111111111111111111111', index: 1 } } : { items: [], next_page_params: null }));
    await listTokenTransfers(ME, { direction: 'in', token }, { fetchImpl: b.f });
    expect(Object.fromEntries(b.calls[1]!.searchParams)).toEqual({ type: 'ERC-20', filter: 'to', token: token.toLowerCase(), index: '1' });
  });

  test('exactly a hundred pages is fine: it is the hundred and first that is too many', async () => {
    let calls = 0;
    const b = blockscout(() => ({ items: [], next_page_params: ++calls < 100 ? { index: calls } : null }));
    await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f })).resolves.toEqual([]);
    expect(b.calls).toHaveLength(100);
  });

  test('transfers at the very same moment are ordered by their transaction hash, whatever order they came in', async () => {
    const a = { ...v2Page1.items[0]!, transaction_hash: `0x${'a'.repeat(64)}` };
    const z = { ...v2Page1.items[0]!, transaction_hash: `0x${'f'.repeat(64)}` };
    const out = await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => ({ items: [z, a], next_page_params: null })).f });
    expect(out.map((t) => t.txHash)).toEqual([a.transaction_hash, z.transaction_hash]);
  });

  test('a next_page_params that is not an object ends the listing', async () => {
    for (const next of ['x', 5, [], true]) {
      const b = blockscout(() => ({ items: [], next_page_params: next }));
      await listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f });
      expect(b.calls).toHaveLength(1);
    }
  });

  test('more than a hundred pages is an error, because a list cut short would pass for the whole truth', async () => {
    const b = blockscout(() => ({ items: [], next_page_params: { index: 1 } }));
    await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: b.f })).rejects.toThrow(/pages/);
    expect(b.calls).toHaveLength(100);
  });

  test('a reply that is not a page is an error', async () => {
    for (const reply of [null, 'x', [], { items: 'nope' }, { next_page_params: null }]) {
      await expect(listTokenTransfers(ME, { direction: 'in' }, { fetchImpl: blockscout(() => Response.json(reply)).f }), JSON.stringify(reply)).rejects.toThrow(/Blockscout/);
    }
  });

  test.each([['0x123'], ['nope'], ['']])('an address of %j is refused', async (address) => {
    const b = blockscout(() => ({ items: [], next_page_params: null }));
    await expect(listTokenTransfers(address, { direction: 'in' }, { fetchImpl: b.f })).rejects.toThrow(/address/);
    expect(b.calls).toEqual([]);
  });

  test('a token that is not an address is refused, and so is a direction that is neither in nor out', async () => {
    const b = blockscout(() => ({ items: [], next_page_params: null }));
    await expect(listTokenTransfers(ME, { direction: 'in', token: 'USDC' }, { fetchImpl: b.f })).rejects.toThrow(/token/);
    await expect(listTokenTransfers(ME, { direction: 'sideways' as 'in' }, { fetchImpl: b.f })).rejects.toThrow(/direction/);
    expect(b.calls).toEqual([]);
  });
});
