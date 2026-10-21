import { x402Client } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm';
import { ExactEvmSchemeV1 } from '@x402/evm/exact/v1/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import {
  ASSETS,
  CELO_MAINNET,
  DeadlineExceeded,
  RAILWALKER_USER_AGENT,
  chainIdOf,
  createDeadline,
  parseSafeUrl,
  readCapped,
  type AssetInfo,
  type AssetSymbol,
  type Deadline,
  type FindingCode,
} from '@railwalker/core';
import { isAddress, type Hash, type LocalAccount } from 'viem';
import { SecondPaymentRefused, guardPayments, type PaymentGuard } from './payment-guard';

/** All the payer needs from the chain: reads, so the Permit2 flow can see the wallet's allowance and nonce. Any viem public client fits. */
export interface ChainReader {
  readContract(args: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

export interface PayerDeps {
  account: LocalAccount;
  publicClient: ChainReader;
  fetchImpl?: typeof fetch;
}

export interface PayRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  asset: AssetSymbol;
  /** The most this request may pay, in the asset's atomic units. */
  maxAtomic: string;
  /** One deadline for the whole exchange: the probe, the signing, the paid request and its body. */
  timeoutMs: number;
  /** Default 262144. */
  maxBodyBytes?: number;
}

/** Every failure a payment can have is also a finding code, so a failed payment becomes a finding without translation. */
export const PAY_FAILURE_CODES = [
  'settle_failed',
  'permit2_allowance_required',
  'insufficient_credits',
  'facilitator_error',
  'nonce_race',
  'no_matching_accept',
  'ambiguous_after_payment',
  // No payment was ever attempted: the seller never produced a challenge to pay.
  'challenge_timeout',
  'not_x402',
] as const satisfies readonly FindingCode[];
export type PayFailureCode = (typeof PAY_FAILURE_CODES)[number];

export interface PayOutcome {
  /** A settlement receipt with a transaction hash came back: the seller took the money. */
  paid: boolean;
  status: number | null;
  headers: Record<string, string>;
  bodyText: string;
  truncated: boolean;
  settlement?: { txHash: Hash; payer: string; network: string };
  latencyMs: number;
  failure?: { code: PayFailureCode; detail: string };
}

const DEFAULT_MAX_BODY_BYTES = 262_144;
/** Spend-control ceiling for default assets with no per-asset entry; the per-request `maxAtomic` is the real cap. */
const USD_CEILING = '$0.05';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const PAYLOAD_ERROR_PREFIX = 'Failed to create payment payload: ';
/** What the x402 client throws when no accept survives its filters; nothing was paid. */
const NO_ACCEPT = /^(No network\/scheme registered|All payment requirements were (rejected|filtered)|No payment requirements with a recognized|No client registered)/;

const clip = (s: string, n = 200) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const describe = (err: unknown) => clip(err instanceof Error ? err.message : String(err));

function buildClient(deps: PayerDeps, asset: AssetInfo, maxAtomic: string): x402Client {
  const signer = toClientEvmSigner(deps.account, deps.publicClient);
  const wanted = asset.address.toLowerCase();
  // The typings want a CAIP-2 name, but the client matches the pattern as an anchored string, so the v1 name 'celo' works.
  const allow = (network: string) => ({ network: network as Network, asset: asset.address, maxAmountPerPayment: maxAtomic });
  return (
    new x402Client()
      .register('eip155:42220', new ExactEvmScheme(signer))
      // The v1 protocol names the network 'celo'; 'celo-sepolia' is deliberately not registered, so the sandbox entry cannot be paid.
      .registerV1('celo', new ExactEvmSchemeV1(signer))
      // Defence in depth over the registrations: only Celo mainnet, only the requested asset, only a payee that is a real address.
      .registerPolicy((_version, accepts) =>
        accepts.filter((a) => chainIdOf(a.network) === CELO_MAINNET && a.asset.toLowerCase() === wanted && isAddress(a.payTo, { strict: true }) && a.payTo !== ZERO_ADDRESS),
      )
      .setSpendControls({ maxAmountPerPayment: USD_CEILING, allowedAssets: [allow('eip155:42220'), allow('celo')] })
  );
}

type Receipt =
  | { state: 'absent' }
  | { state: 'invalid'; why: string }
  | { state: 'failed'; reason: string }
  | { state: 'settled'; txHash: Hash; payer: string; network: string | null };

/** Both protocol versions: `payment-response` (v2) or `x-payment-response` (v1). The v1 client never fires its response hooks, so headers are read directly. */
function readReceipt(headers: Record<string, string>): Receipt {
  const raw = headers['payment-response'] ?? headers['x-payment-response'];
  if (!raw) return { state: 'absent' };
  let r: Record<string, unknown>;
  try {
    r = decodePaymentResponseHeader(raw) as unknown as Record<string, unknown>;
  } catch {
    return { state: 'invalid', why: 'the settlement receipt is not base64-encoded JSON' };
  }
  if (typeof r !== 'object' || r === null || typeof r.success !== 'boolean') return { state: 'invalid', why: 'the settlement receipt has no success flag' };
  if (!r.success) {
    const reason = [r.errorReason, r.errorMessage].filter((x): x is string => typeof x === 'string' && x !== '').join(': ');
    return { state: 'failed', reason: reason || 'settlement failed' };
  }
  if (typeof r.transaction !== 'string' || !TX_HASH.test(r.transaction)) return { state: 'invalid', why: 'the settlement receipt has no valid transaction hash' };
  return {
    state: 'settled',
    txHash: r.transaction as Hash,
    payer: typeof r.payer === 'string' ? r.payer : '',
    network: typeof r.network === 'string' ? r.network : null,
  };
}

/** The seller's own words for what went wrong: the JSON body's `error`, and the `error` of a re-sent payment-required header. */
function sellerError(headers: Record<string, string>, bodyText: string): string {
  const found: string[] = [];
  try {
    const body = JSON.parse(bodyText) as { error?: unknown } | null;
    if (typeof body?.error === 'string') found.push(body.error);
  } catch {
    /* not JSON */
  }
  if (headers['payment-required']) {
    try {
      const error = decodePaymentRequiredHeader(headers['payment-required']).error;
      if (typeof error === 'string') found.push(error);
    } catch {
      /* not a challenge */
    }
  }
  return clip(found.join(' | '));
}

type Failure = NonNullable<PayOutcome['failure']>;
const failure = (code: PayFailureCode, detail: string): Failure => ({ code, detail });

/** Why a payment that was sent did not come back settled. Only called when the receipt did not say 'settled'. */
function paidFailure(status: number, receipt: Receipt, headers: Record<string, string>, bodyText: string): Failure {
  if (receipt.state === 'failed') return failure(/nonce/i.test(receipt.reason) ? 'nonce_race' : 'settle_failed', clip(receipt.reason));
  if (receipt.state === 'invalid') return failure('ambiguous_after_payment', receipt.why);

  const said = sellerError(headers, bodyText);
  if (said.includes('permit2_allowance_required')) return failure('permit2_allowance_required', said);
  if (said.includes('insufficient_credits')) return failure('insufficient_credits', said);
  // Without a receipt, a 4xx means the seller refused the payment, so no money moved; anything else leaves it unknowable.
  if (status >= 400 && status < 500) return failure('facilitator_error', said || `payment not accepted: HTTP ${status}`);
  if (status >= 500) return failure('ambiguous_after_payment', `HTTP ${status} after the payment was sent, with no settlement receipt`);
  return failure('ambiguous_after_payment', `HTTP ${status} after the payment was sent, with no settlement receipt`);
}

interface Exchange {
  guard: PaymentGuard;
  deadline: Deadline;
  cap: number;
  started: number;
}

/** What the exchange looked like when no complete answer came back. */
function noAnswer(err: unknown, x: Exchange): PayOutcome {
  // The seller's unpaid challenge is evidence for a failure before payment only; once a payment is out, no answer is no answer.
  const unpaid = x.guard.paymentSent() ? null : x.guard.unpaid();
  const base = {
    paid: false,
    status: unpaid?.status ?? null,
    headers: unpaid?.headers ?? {},
    bodyText: unpaid?.bodyText ?? '',
    truncated: unpaid?.truncated ?? false,
    latencyMs: Date.now() - x.started,
  };
  const timedOut = err instanceof DeadlineExceeded || x.deadline.hasExpired();

  if (x.guard.paymentSent()) {
    return { ...base, failure: failure('ambiguous_after_payment', timedOut ? 'the payment was sent and no complete answer arrived in time' : `the payment was sent and the request failed: ${describe(err)}`) };
  }
  if (timedOut) return { ...base, failure: failure('challenge_timeout', 'no complete answer arrived before the deadline') };

  const message = err instanceof Error ? err.message : '';
  if (message.startsWith('Failed to parse payment requirements')) return { ...base, failure: failure('not_x402', describe(err)) };
  if (message.startsWith(PAYLOAD_ERROR_PREFIX) && NO_ACCEPT.test(message.slice(PAYLOAD_ERROR_PREFIX.length))) {
    return { ...base, failure: failure('no_matching_accept', clip(message.slice(PAYLOAD_ERROR_PREFIX.length))) };
  }
  if (err instanceof TypeError) return { ...base, failure: failure('not_x402', describe(err)) }; // fetch failed: nothing reachable to pay
  throw err; // our own failure (an RPC read, a signing error): not a verdict about the seller
}

async function answered(res: Response, x: Exchange): Promise<PayOutcome> {
  const headers = Object.fromEntries(res.headers);
  let body = { text: '', truncated: false };
  let bodyError: unknown;
  try {
    const read = await readCapped(res, x.cap, x.deadline, 'truncate');
    if (read.ok) body = { text: read.text, truncated: read.truncated };
  } catch (err) {
    bodyError = err;
  }

  const outcome: PayOutcome = { paid: false, status: res.status, headers, bodyText: body.text, truncated: body.truncated, latencyMs: Date.now() - x.started };

  if (!x.guard.paymentSent()) {
    // The endpoint was not paywalled (or answered a payment-less probe with something that is not a challenge).
    if (bodyError) outcome.failure = failure(bodyError instanceof DeadlineExceeded || x.deadline.hasExpired() ? 'challenge_timeout' : 'not_x402', describe(bodyError));
    return outcome;
  }

  const receipt = readReceipt(headers);
  if (receipt.state === 'settled') {
    outcome.paid = true;
    outcome.settlement = { txHash: receipt.txHash, payer: receipt.payer, network: receipt.network ?? x.guard.paymentNetwork() ?? '' };
  } else {
    outcome.failure = paidFailure(res.status, receipt, headers, body.text);
  }
  // Money moved, or may have, and the body never fully arrived: nobody can say what came back.
  if (bodyError) outcome.failure = failure('ambiguous_after_payment', `the response body did not arrive: ${describe(bodyError)}`);
  return outcome;
}

/**
 * Pays an x402 endpoint in one asset, on Celo mainnet only, for at most `maxAtomic`. A request that carried a payment is never
 * retried and never followed through a redirect: a failure after the payment left is reported as it is, never repaired.
 * The caller scans first; the static URL checks here are the last line, not the only one.
 */
export async function payEndpoint(deps: PayerDeps, req: PayRequest): Promise<PayOutcome> {
  if (!/^[1-9]\d*$/.test(req.maxAtomic)) throw new RangeError('maxAtomic must be a positive integer string of atomic units');
  parseSafeUrl(req.url); // throws UnsafeUrlError

  const started = Date.now();
  const cap = req.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const deadline = createDeadline(req.timeoutMs);
  const guard = guardPayments(deps.fetchImpl ?? fetch, deadline, cap);
  const x: Exchange = { guard, deadline, cap, started };
  const post = req.method === 'POST';
  const pay = wrapFetchWithPayment(guard.fetch, buildClient(deps, ASSETS[req.asset], req.maxAtomic));

  try {
    let res: Response;
    try {
      res = await deadline.race(
        pay(req.url, {
          method: post ? 'POST' : 'GET', // never a side-effect verb
          redirect: 'manual', // a payment header must never follow a redirect to another host
          signal: deadline.signal,
          headers: { 'user-agent': RAILWALKER_USER_AGENT, accept: 'application/json', ...(post ? { 'content-type': 'application/json' } : {}) },
          ...(post ? { body: JSON.stringify(req.body ?? {}) } : {}),
        }),
      );
    } catch (err) {
      // The client library retries only when a response hook asks it to; ours never does. If something did, answer from the first paid response.
      const first = err instanceof SecondPaymentRefused ? guard.paidResponse() : null;
      return first ? await answered(first, x) : noAnswer(err, x);
    }
    return await answered(res, x);
  } finally {
    deadline.clear();
  }
}
