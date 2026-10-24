import {
  ASSETS,
  CELO_MAINNET,
  classifyReadStyle,
  makeFinding,
  shapeOf,
  toUsd,
  verdictFromFindings,
  type Accept,
  type AssetSymbol,
  type Basis,
  type Challenge,
  type EndpointFacts,
  type Finding,
  type FindingCode,
  type PayQuery,
  type Shape,
  type SpendLedger,
  type Stage,
  type Verdict,
} from '@railwalker/core';
import type { PayFailureCode, PayOutcome, PayRequest } from '@railwalker/chain';
import { verifyDelivery } from './delivery';
import { RunRecorder, type RunRecord } from './run-record';
import { patchesFor } from './scan';
import type { CheckReport } from './types';

export interface ConfirmDeps {
  pay: (req: PayRequest) => Promise<PayOutcome>;
  verifyTransfer: (a: { txHash: `0x${string}`; asset: string; from: string; to: string; amountAtomic: string }) => Promise<{ ok: boolean; reason?: string }>;
  ledger: SpendLedger;
  /** The wallet that pays: the settlement must come from this address. */
  payer: string;
  /** Identifies the seller in the ledger's per-seller and per-day caps. */
  sellerKey: string;
  balanceUsd: () => Promise<number>;
  now: () => Date;
  pesoRates?: Partial<Record<AssetSymbol, number>>;
  learnedShape?: Shape | null;
  /** Default 15000. */
  tooSlowMs?: number;
  /** The payer's deadline for one whole payment. Default 30000: Celo settles in about 9 s at the median, 18 s at p95. */
  payTimeoutMs?: number;
}

export interface ConfirmOptions {
  stage: Stage;
  assets: AssetSymbol[];
  facts: EndpointFacts;
  feePaidUsd?: number;
  body?: unknown;
  optedOut: boolean;
  /** Default 1; the lab tier uses 3. */
  deliveries?: number;
}

const DEFAULT_TOO_SLOW_MS = 15_000;
const DEFAULT_PAY_TIMEOUT_MS = 30_000;

/**
 * What a failed payment tells us. `observed`: a real payment was sent and refused, so the verdict is CONFIRMED.
 * `ambiguous`: it was sent and nobody can say what happened. `not_attempted`: nothing was sent, so the observation is only a
 * prediction. `inconclusive`: our own collision says nothing about the seller, so the asset's verdict is left alone.
 */
type OutcomeKind = 'observed' | 'ambiguous' | 'not_attempted' | 'inconclusive';
const KIND: Record<PayFailureCode, OutcomeKind> = {
  settle_failed: 'observed',
  permit2_allowance_required: 'observed',
  insufficient_credits: 'observed',
  facilitator_error: 'observed',
  ambiguous_after_payment: 'ambiguous',
  no_matching_accept: 'not_attempted',
  challenge_timeout: 'not_attempted',
  not_x402: 'not_attempted',
  nonce_race: 'inconclusive',
};

const MESSAGE: Record<PayFailureCode, string> = {
  settle_failed: 'The payment was signed and sent, but the facilitator could not settle it.',
  permit2_allowance_required: 'A first-time wallet is refused: the seller wants the Permit2 allowance in place before it takes the payment.',
  insufficient_credits: 'The seller answered the payment with insufficient_credits.',
  facilitator_error: 'The seller refused the payment it was given.',
  nonce_race: 'The payment collided with another from the same wallet. Nothing was charged and nothing is concluded.',
  no_matching_accept: 'The payer found no acceptable way to pay the quoted price on Celo mainnet.',
  ambiguous_after_payment: 'The payment was sent and what came back cannot be told: it may have settled.',
  challenge_timeout: 'The seller did not answer the payment probe in time.',
  not_x402: 'The seller did not answer the payment probe with an x402 challenge.',
};

const usd = (n: number | null) => (n === null ? 'an unpriced amount' : `$${n.toFixed(4)}`);
const shortTx = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

interface Ctx {
  deps: ConfirmDeps;
  rec: RunRecorder;
  report: CheckReport;
  challenge: Challenge;
  opts: ConfirmOptions;
  readStyle: boolean;
  deliveries: number;
  /** Reserved for this confirmation so far, for the customer stage's share of the fee. */
  spent: { usd: number };
}

interface AssetResult {
  /** null: leave the asset's verdict as the scan had it. */
  verdict: Verdict | null;
  findings: Finding[];
}

function recordScan(rec: RunRecorder, report: CheckReport): void {
  const c = report.challenge;
  rec.step('challenge', c !== null, c ? `402 challenge parsed (v${c.version}, ${c.accepts.length} accepts)` : 'no x402 challenge', { status: report.status });
  if (!c) return;
  const errors = report.findings.filter((f) => f.severity === 'error').length;
  const warnings = report.findings.filter((f) => f.severity === 'warn').length;
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  rec.step('lints', errors === 0, `${n(report.findings.length, 'finding')}: ${n(errors, 'error')}, ${n(warnings, 'warning')}`, { codes: report.findings.map((f) => f.code) });
}

async function confirmAsset(c: Ctx, symbol: AssetSymbol, accept: Accept): Promise<AssetResult> {
  const { deps, rec, opts } = c;
  const info = ASSETS[symbol];
  const priceUsd = toUsd(symbol, accept.amountAtomic, deps.pesoRates);
  const staticFindings = c.report.findings.filter((f) => !f.assetSymbol || f.assetSymbol === symbol);
  const found: Finding[] = [];
  let confirmedAny = false;
  let shape = deps.learnedShape ?? null;
  const tag = (code: FindingCode, message: string, evidence: Record<string, unknown>, basis: Basis) => makeFinding(code, message, evidence, { assetSymbol: symbol, basis });
  const payment = (txHash?: string) => rec.payment({ asset: info.address, symbol, amountAtomic: accept.amountAtomic, payTo: accept.payTo, ...(txHash ? { txHash } : {}) });

  for (let delivery = 1; delivery <= c.deliveries; delivery++) {
    const q: PayQuery = {
      stage: opts.stage,
      sellerKey: deps.sellerKey,
      priceUsd,
      readStyle: c.readStyle,
      optedOut: opts.optedOut,
      balanceUsd: await deps.balanceUsd(),
      now: deps.now(),
      feePaidUsd: opts.feePaidUsd,
      spentOnThisCheckUsd: c.spent.usd,
    };
    const decision = await deps.ledger.reserve(q);
    if (!decision.allow) {
      rec.step('wallet', false, `${symbol}: payment refused (${decision.reason})`, { reason: decision.reason, delivery });
      // Replaces the PREDICTED verdict, but keeps what the scan found, so nothing is lost.
      if (delivery === 1) return { verdict: { kind: 'SKIPPED', code: decision.reason, basis: 'PREDICTED', assetSymbol: symbol, findings: staticFindings }, findings: [] };
      break;
    }
    c.spent.usd += priceUsd ?? 0;
    rec.step('wallet', true, `${symbol}: reserved ${usd(priceUsd)} of the ${usd(q.balanceUsd)} balance`, { priceUsd, balanceUsd: q.balanceUsd, delivery });
    const giveBack = () => {
      deps.ledger.release(q);
      c.spent.usd -= priceUsd ?? 0;
    };

    let o: PayOutcome;
    try {
      // The cap is the quoted price: a seller cannot charge more than was reserved.
      o = await deps.pay({
        url: c.report.endpoint.url,
        method: c.report.endpoint.method,
        ...(opts.body === undefined ? {} : { body: opts.body }),
        asset: symbol,
        maxAtomic: accept.amountAtomic,
        timeoutMs: deps.payTimeoutMs ?? DEFAULT_PAY_TIMEOUT_MS,
      });
    } catch (err) {
      giveBack(); // nothing was sent: the payer throws only before a payment leaves
      throw err;
    }

    const failure = o.failure ?? (o.paid ? undefined : { code: 'not_x402' as const, detail: `the endpoint answered HTTP ${o.status ?? 'nothing'} without asking for payment` });
    if (failure) {
      const kind = KIND[failure.code];
      const finding = (basis: Basis) => tag(failure.code, MESSAGE[failure.code], { detail: failure.detail, status: o.status, delivery }, basis);
      if (kind === 'ambiguous') {
        rec.step('sign', true, `${symbol}: payment sent`, { delivery });
        rec.step('settle', null, `${symbol}: ${failure.detail}`, { delivery });
        found.push(finding('CONFIRMED'));
        payment(o.settlement?.txHash); // the money may have moved: the ledger keeps the spend
        confirmedAny = true;
      } else {
        giveBack(); // no money moved
        if (kind === 'observed') {
          rec.step('sign', true, `${symbol}: payment sent`, { delivery });
          rec.step('settle', false, `${symbol}: ${failure.code}: ${failure.detail}`, { delivery });
          found.push(finding('CONFIRMED'));
          confirmedAny = true;
        } else if (kind === 'not_attempted') {
          rec.step('sign', false, `${symbol}: no payment sent (${failure.code})`, { delivery });
          found.push(finding('PREDICTED'));
        } else {
          rec.step('sign', true, `${symbol}: payment sent`, { delivery });
          rec.step('settle', null, `${symbol}: ${failure.code}: inconclusive`, { delivery });
          found.push(finding('PREDICTED'));
        }
      }
      break; // never retried, and nothing more is bought from a seller that just failed
    }

    const settlement = o.settlement!;
    rec.step('sign', true, `${symbol}: payment signed and sent`, { delivery });
    payment(settlement.txHash);
    confirmedAny = true;

    let check: { ok: boolean; reason?: string };
    try {
      check = await deps.verifyTransfer({ txHash: settlement.txHash, asset: info.address, from: deps.payer, to: accept.payTo, amountAtomic: accept.amountAtomic });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      rec.step('settle', null, `${symbol}: settlement reported but not checkable on chain`, { txHash: settlement.txHash, delivery });
      found.push(tag('ambiguous_after_payment', `${MESSAGE.ambiguous_after_payment} The seller reported a settlement that could not be checked on chain: ${why}.`, { txHash: settlement.txHash, delivery }, 'CONFIRMED'));
      break;
    }
    if (!check.ok) {
      const code: FindingCode = check.reason === 'reverted' ? 'settle_failed' : check.reason === 'tx_not_found' ? 'tx_not_found' : 'transfer_mismatch';
      rec.step('settle', false, `${symbol}: settlement ${code.replace('_', ' ')}`, { txHash: settlement.txHash, reason: check.reason, delivery });
      found.push(tag(code, `The seller's settlement ${shortTx(settlement.txHash)} does not check out on chain (${check.reason ?? 'transfer_mismatch'}).`, { txHash: settlement.txHash, reason: check.reason, delivery }, 'CONFIRMED'));
      break;
    }
    rec.step('settle', true, `${symbol}: settled, ${shortTx(settlement.txHash)}, verified on chain`, { txHash: settlement.txHash, delivery });

    const delivered = verifyDelivery({
      status: o.status ?? 0,
      headers: o.headers,
      bodyText: o.bodyText,
      mimeType: c.challenge.resource.mimeType,
      learnedShape: shape,
      latencyMs: o.latencyMs,
      tooSlowMs: deps.tooSlowMs ?? DEFAULT_TOO_SLOW_MS,
      truncated: o.truncated,
    }).map((f): Finding => ({ ...f, assetSymbol: symbol, evidence: { ...f.evidence, delivery } }));
    found.push(...delivered);
    const failed = delivered.some((f) => f.severity === 'error');
    rec.step('deliver', !failed, `${symbol}: HTTP ${o.status}, ${o.bodyText.length} bytes, ${o.latencyMs} ms`, { status: o.status, latencyMs: o.latencyMs, delivery });
    if (failed) break;
    if (shape === null) {
      try {
        shape = shapeOf(JSON.parse(o.bodyText)); // the first good delivery says what this endpoint returns
      } catch {
        /* not JSON: nothing to learn */
      }
    }
  }

  const replace = confirmedAny || found.some((f) => f.code !== 'nonce_race');
  if (!replace) return { verdict: null, findings: found };
  const verdict = verdictFromFindings({ basis: confirmedAny ? 'CONFIRMED' : 'PREDICTED', assetSymbol: symbol, findings: [...staticFindings, ...found] });
  return { verdict, findings: found };
}

const describeVerdict = (v: Verdict) => `${v.assetSymbol ?? 'endpoint'}: ${v.kind === 'FAIL' || v.kind === 'SKIPPED' ? `${v.kind} ${v.code}` : v.kind} (${v.basis === 'CONFIRMED' ? 'confirmed' : 'predicted'})`;

/**
 * The paid half of a check. Each requested asset on a Celo mainnet accept is priced, reserved in the shared ledger, paid at most
 * once per delivery, verified on chain and judged on what came back. A confirmed asset gets a CONFIRMED verdict in place of its
 * PREDICTED one; every other asset keeps the scan's verdict. Nothing is ever retried.
 */
export async function confirmEndpoint(deps: ConfirmDeps, report: CheckReport, opts: ConfirmOptions): Promise<{ report: CheckReport; run: RunRecord }> {
  const rec = new RunRecorder(deps.now, opts.stage, report.endpoint);
  recordScan(rec, report);

  const verdicts = [...report.verdicts];
  const findings = [...report.findings];
  const attempted: Verdict[] = [];

  if (report.challenge) {
    const ctx: Ctx = {
      deps,
      rec,
      report,
      challenge: report.challenge,
      opts,
      readStyle: classifyReadStyle(opts.facts).readStyle,
      deliveries: Math.max(1, opts.deliveries ?? 1),
      spent: { usd: 0 },
    };
    for (const symbol of new Set(opts.assets)) {
      // Mainnet only: a sandbox accept is never requested, whatever address it lists.
      const accept = report.challenge.accepts.find((a) => a.chainId === CELO_MAINNET && a.assetInfo?.symbol === symbol);
      if (!accept) {
        rec.step('wallet', null, `${symbol}: not offered on Celo mainnet, nothing to confirm`);
        continue;
      }
      const result = await confirmAsset(ctx, symbol, accept);
      findings.push(...result.findings);
      if (!result.verdict) continue;
      attempted.push(result.verdict);
      const at = verdicts.findIndex((v) => v.assetSymbol === symbol);
      if (at >= 0) verdicts[at] = result.verdict;
      else verdicts.push(result.verdict);
    }
  }

  const judged = attempted.length > 0 ? attempted : verdicts;
  const ok = judged.some((v) => v.kind === 'FAIL') ? false : judged.every((v) => v.kind === 'PASS' || v.kind === 'PASS_WITH_WARNINGS') ? true : null;
  rec.step('verdict', ok, attempted.length > 0 ? attempted.map(describeVerdict).join('; ') : 'nothing was paid; the verdicts stand as predicted');

  return { report: { ...report, findings, verdicts, patches: patchesFor(findings) }, run: rec.finish(verdicts) };
}
