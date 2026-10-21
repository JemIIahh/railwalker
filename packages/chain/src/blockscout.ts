import { DeadlineExceeded, createDeadline, discard, readCapped, type TokenTransfer, type WalletFacts } from '@railwalker/core';
import { isAddress } from 'viem';

export type { TokenTransfer };

const BLOCKSCOUT_URL = 'https://celo.blockscout.com';
/** Blockscout's public API sits behind a gateway that turns away clients that do not look like a browser. */
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 25;
const MAX_FUNDER_PAGES = 4;
const MAX_TRANSFER_PAGES = 100;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface BlockscoutDeps {
  fetchImpl?: typeof fetch;
  /** Waits between retries. Tests replace it so they need no real time. */
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

const baseOf = (deps: BlockscoutDeps) => (deps.baseUrl ?? BLOCKSCOUT_URL).replace(/\/+$/, '');
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const DIGITS = /^\d{1,78}$/;

/**
 * One GET under one deadline per attempt. A 429 is retried (the wait it asks for, up to thirty seconds, else 0.5 s doubling),
 * five attempts at most; any other answer that is not 2xx is an error, a redirect included, and the body is read at most 5 MiB.
 */
async function getJson(url: URL, deps: BlockscoutDeps): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    const deadline = createDeadline(TIMEOUT_MS);
    let wait: number;
    try {
      const res = await deadline.race(
        fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal: deadline.signal, headers: { accept: 'application/json', 'user-agent': BROWSER_USER_AGENT } }),
      );
      if (res.status !== 429) {
        if (res.status < 200 || res.status >= 300) {
          discard(res);
          throw new Error(`Blockscout answered ${res.status}`);
        }
        const body = await readCapped(res, MAX_BODY_BYTES, deadline, 'refuse');
        if (!body.ok) throw new Error('Blockscout sent an answer that is too large to read');
        try {
          return JSON.parse(body.text);
        } catch {
          throw new Error('Blockscout sent an answer that is not JSON');
        }
      }
      discard(res);
      if (attempt >= MAX_ATTEMPTS) throw new Error(`Blockscout rate limit: still refusing after ${MAX_ATTEMPTS} attempts`);
      const header = res.headers.get('retry-after');
      const asked = header !== null && header.trim() !== '' ? Number(header) : Number.NaN;
      wait = Number.isFinite(asked) && asked >= 0 ? Math.min(asked * 1000, MAX_RETRY_AFTER_MS) : BASE_DELAY_MS * 2 ** (attempt - 1);
    } catch (err) {
      if (err instanceof DeadlineExceeded) throw new Error('Blockscout did not answer in time');
      throw err;
    } finally {
      deadline.clear();
    }
    await sleep(wait);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the wallet's history is made of, from the Etherscan-compatible API: only what looks like a record is kept. Only transactions can fail. */
interface Rec {
  block: bigint;
  /** Unix seconds. */
  at: number;
  from: string;
  to: string;
  value: bigint;
  failed: boolean;
}

function parseRecord(raw: unknown): Rec | null {
  if (!isRecord(raw)) return null;
  const { timeStamp, blockNumber, from, to, value } = raw;
  if (typeof timeStamp !== 'string' || !/^\d{1,11}$/.test(timeStamp)) return null;
  if (typeof blockNumber !== 'string' || !/^\d{1,12}$/.test(blockNumber)) return null;
  if (typeof from !== 'string' || !ADDRESS.test(from)) return null;
  if (typeof to !== 'string' || (to !== '' && !ADDRESS.test(to))) return null; // a contract creation has no `to`
  if (typeof value !== 'string' || !DIGITS.test(value)) return null;
  return { block: BigInt(blockNumber), at: Number(timeStamp), from: from.toLowerCase(), to: to.toLowerCase(), value: BigInt(value), failed: raw.isError === '1' };
}

const earlier = (a: Rec, b: Rec): boolean => a.block < b.block || (a.block === b.block && a.at < b.at);

/** One page of a wallet's history, oldest first. "None found" is an empty list; anything else that is not a list is an error. */
async function history(action: 'txlist' | 'tokentx', me: string, page: number, deps: BlockscoutDeps): Promise<unknown[]> {
  const url = new URL(`${baseOf(deps)}/api`);
  for (const [key, value] of Object.entries({ module: 'account', action, address: me, sort: 'asc', page: String(page), offset: String(PAGE_SIZE) })) url.searchParams.set(key, value);
  const body = await getJson(url, deps);
  if (!isRecord(body)) throw new Error('Blockscout sent an answer in a shape nobody expected');
  if (Array.isArray(body.result)) return body.result;
  throw new Error(typeof body.message === 'string' && body.status === '0' ? `Blockscout: ${body.message.slice(0, 120)}` : 'Blockscout sent a result that is not a list');
}

/** The wallet's earliest record, and its earliest inbound one that moved value, looking at most four pages deep for the latter. */
async function earliest(action: 'txlist' | 'tokentx', me: string, deps: BlockscoutDeps): Promise<{ first: Rec | null; inbound: Rec | null }> {
  let first: Rec | null = null;
  let inbound: Rec | null = null;
  for (let page = 1; page <= MAX_FUNDER_PAGES; page++) {
    const items = await history(action, me, page, deps);
    for (const raw of items) {
      const rec = parseRecord(raw);
      if (!rec) continue;
      if (first === null || earlier(rec, first)) first = rec;
      if (!rec.failed && rec.to === me && rec.value > 0n && (inbound === null || earlier(rec, inbound))) inbound = rec;
    }
    if (inbound !== null || items.length < PAGE_SIZE) break; // found one, or that was the last page
  }
  return { first, inbound };
}

/**
 * When a wallet was first active on Celo and who first funded it. Activity is the earlier of its first transaction and its first
 * token transfer (a gasless signer has only the latter); the funder is the sender of the earliest inbound transfer of value, native
 * or token. An unknown funder is null, never guessed. Both halves must answer: facts from one half could make a wallet look independent.
 * The Etherscan-compatible API is used because it can sort ascending; the v2 token-transfers endpoint has no ordering and answers 422.
 */
export async function getWalletFacts(address: string, deps: BlockscoutDeps = {}): Promise<WalletFacts> {
  if (!isAddress(address, { strict: false })) throw new Error('not an address');
  const me = address.toLowerCase();
  const [transactions, transfers] = await Promise.all([earliest('txlist', me, deps), earliest('tokentx', me, deps)]);

  const firsts = [transactions.first, transfers.first].filter((r): r is Rec => r !== null);
  const firstActivityAt = firsts.length === 0 ? null : new Date(Math.min(...firsts.map((r) => r.at)) * 1000).toISOString();
  // On a tie the transaction wins: it was listed first.
  const funder = [transactions.inbound, transfers.inbound].filter((r): r is Rec => r !== null).reduce<Rec | null>((best, r) => (best === null || earlier(r, best) ? r : best), null);
  return { address, firstActivityAt, firstFunder: funder?.from ?? null };
}

const PARAM_NAME = /^[a-z_]{1,32}$/;

/** next_page_params is the server's to define, but only short plain values under plain names are sent back. */
function nextParams(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!PARAM_NAME.test(key)) continue;
    if ((typeof v === 'string' && v.length <= 100) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[key] = String(v);
  }
  return out;
}

function parseTransfer(raw: unknown): TokenTransfer | null {
  if (!isRecord(raw)) return null;
  const hash = raw.transaction_hash;
  const from = isRecord(raw.from) ? raw.from.hash : undefined;
  const to = isRecord(raw.to) ? raw.to.hash : undefined;
  const token = isRecord(raw.token) ? raw.token.address_hash : undefined;
  const value = isRecord(raw.total) ? raw.total.value : undefined;
  const at = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN;
  if (typeof hash !== 'string' || !TX_HASH.test(hash)) return null;
  if (typeof from !== 'string' || !ADDRESS.test(from) || typeof to !== 'string' || !ADDRESS.test(to) || typeof token !== 'string' || !ADDRESS.test(token)) return null;
  if (typeof value !== 'string' || !DIGITS.test(value) || Number.isNaN(at)) return null;
  return { txHash: hash, from: from.toLowerCase(), to: to.toLowerCase(), token: token.toLowerCase(), amountAtomic: value, at: new Date(at).toISOString() };
}

/**
 * The ERC-20 transfers into (`in`) or out of (`out`) a wallet, optionally of one token and no older than `since`, oldest first.
 * Pages are followed until the end, or until one reaches transfers older than `since`. More than a hundred pages is an error: a
 * list cut short would pass for the whole truth in a ledger.
 */
export async function listTokenTransfers(address: string, o: { direction: 'in' | 'out'; token?: string; since?: string }, deps: BlockscoutDeps = {}): Promise<TokenTransfer[]> {
  if (!isAddress(address, { strict: false })) throw new Error('not an address');
  if (o.direction !== 'in' && o.direction !== 'out') throw new Error('direction must be in or out');
  if (o.token !== undefined && !isAddress(o.token, { strict: false })) throw new Error('token must be an address');
  const since = o.since === undefined ? null : Date.parse(o.since);
  if (since !== null && Number.isNaN(since)) throw new Error('since is not a date');
  const me = address.toLowerCase();

  const found: TokenTransfer[] = [];
  let next: Record<string, string> = {};
  for (let pageNumber = 1; ; pageNumber++) {
    if (pageNumber > MAX_TRANSFER_PAGES) throw new Error(`Blockscout has more than ${MAX_TRANSFER_PAGES} pages of transfers for this wallet: too many to list`);
    const url = new URL(`${baseOf(deps)}/api/v2/addresses/${me}/token-transfers`);
    for (const [key, value] of Object.entries(next)) url.searchParams.set(key, value);
    url.searchParams.set('type', 'ERC-20'); // what we ask for is not the server's to change
    url.searchParams.set('filter', o.direction === 'in' ? 'to' : 'from');
    if (o.token !== undefined) url.searchParams.set('token', o.token.toLowerCase());

    const body = await getJson(url, deps);
    if (!isRecord(body) || !Array.isArray(body.items)) throw new Error('Blockscout sent a page in a shape nobody expected');
    let reachedOlder = false;
    for (const raw of body.items) {
      const transfer = parseTransfer(raw);
      if (!transfer) continue;
      if (since !== null && Date.parse(transfer.at) < since) reachedOlder = true;
      else found.push(transfer);
    }
    const following = nextParams(body.next_page_params);
    if (reachedOlder || following === null) break; // newest first: nothing after an older transfer is wanted
    next = following;
  }
  return found.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : 0));
}
