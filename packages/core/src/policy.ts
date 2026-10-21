import { ASSETS, type AssetSymbol } from './assets';
import type { DenyReason } from './findings';

export interface Policy {
  perProbeMaxUsd: number;
  perEndpointDayMaxUsd: number;
  eventMaxUsd: number;
  unsolicitedMaxSettlementsPerSeller: number;
  unsolicitedMinPriceUsd: number;
  /** Nothing is paid if the balance after paying would fall below this. */
  reserveUsd: number;
  /** A customer-requested check may pay its targets at most this fraction of the fee received. */
  customerSpendFraction: number;
}

export const DEFAULT_POLICY: Policy = {
  perProbeMaxUsd: 0.05,
  perEndpointDayMaxUsd: 0.25,
  eventMaxUsd: 3,
  unsolicitedMaxSettlementsPerSeller: 3,
  unsolicitedMinPriceUsd: 0.005,
  reserveUsd: 0.1,
  customerSpendFraction: 0.5,
};

export type Stage = 'buy' | 'fixture' | 'customer' | 'unsolicited';

export interface SpendState {
  totalUsd: number;
  /** key `${sellerKey}|${YYYY-MM-DD}` (UTC) */
  byEndpointDay: Record<string, number>;
  settlementsBySeller: Record<string, number>;
}

export const emptySpendState = (): SpendState => ({ totalUsd: 0, byEndpointDay: {}, settlementsBySeller: {} });

export interface PayQuery {
  stage: Stage;
  sellerKey: string;
  /** null when the asset cannot be priced in USD. */
  priceUsd: number | null;
  readStyle: boolean;
  optedOut: boolean;
  balanceUsd: number;
  now: Date;
  feePaidUsd?: number;
  spentOnThisCheckUsd?: number;
}

export type PayDecision = { allow: true } | { allow: false; reason: DenyReason };

const EPS = 1e-9;
const dayKey = (q: PayQuery) => `${q.sellerKey}|${q.now.toISOString().slice(0, 10)}`;
const deny = (reason: DenyReason): PayDecision => ({ allow: false, reason });

/** Pure. The checks run in a fixed order so the reason reported is always the most fundamental one. */
export function decidePay(policy: Policy, state: SpendState, q: PayQuery): PayDecision {
  if (!q.readStyle) return deny('not_read_style');
  if (q.optedOut) return deny('opted_out');
  if (q.priceUsd === null) return deny('unpriced_asset');
  const price = q.priceUsd;
  if (price > policy.perProbeMaxUsd + EPS) return deny('over_probe_cap');
  if (q.stage === 'unsolicited' && price + EPS < policy.unsolicitedMinPriceUsd) return deny('price_below_unsolicited_minimum');
  if (q.balanceUsd - price < policy.reserveUsd - EPS) return deny('below_reserve');
  if (state.totalUsd + price > policy.eventMaxUsd + EPS) return deny('over_event_cap');
  if ((state.byEndpointDay[dayKey(q)] ?? 0) + price > policy.perEndpointDayMaxUsd + EPS) return deny('over_endpoint_day_cap');
  if (q.stage === 'unsolicited' && (state.settlementsBySeller[q.sellerKey] ?? 0) >= policy.unsolicitedMaxSettlementsPerSeller) {
    return deny('seller_settlement_limit');
  }
  if (q.stage === 'customer') {
    const budget = (q.feePaidUsd ?? 0) * policy.customerSpendFraction;
    if ((q.spentOnThisCheckUsd ?? 0) + price > budget + EPS) return deny('customer_fee_fraction_exceeded');
  }
  return { allow: true };
}

/**
 * Decides and records in one serialised step, so concurrent probes can never overspend:
 * the runner and the web app share one ledger per process, and the wallet balance caps everything else.
 */
export class SpendLedger {
  private state: SpendState;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly policy: Policy,
    initial: SpendState,
  ) {
    this.state = structuredClone(initial);
  }

  reserve(q: PayQuery): Promise<PayDecision> {
    const run = this.chain.then(() => this.reserveNow(q));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private reserveNow(q: PayQuery): PayDecision {
    const decision = decidePay(this.policy, this.state, q);
    if (decision.allow && q.priceUsd !== null) this.apply(q, q.priceUsd, 1);
    return decision;
  }

  /** Give a reservation back when no money actually moved. */
  release(q: PayQuery): void {
    if (q.priceUsd !== null) this.apply(q, -q.priceUsd, -1);
  }

  private apply(q: PayQuery, usd: number, settlements: number): void {
    const key = dayKey(q);
    this.state.totalUsd = Math.max(0, this.state.totalUsd + usd);
    this.state.byEndpointDay[key] = Math.max(0, (this.state.byEndpointDay[key] ?? 0) + usd);
    this.state.settlementsBySeller[q.sellerKey] = Math.max(0, (this.state.settlementsBySeller[q.sellerKey] ?? 0) + settlements);
  }

  snapshot(): SpendState {
    return structuredClone(this.state);
  }
}

/** USD value of an atomic amount; null for non-USD assets without a configured rate (they are never paid unpriced). */
export function toUsd(symbol: AssetSymbol, amountAtomic: string, pesoRates: Partial<Record<AssetSymbol, number>> = {}): number | null {
  if (!/^\d+$/.test(amountAtomic)) return null;
  const info = ASSETS[symbol];
  const units = Number(BigInt(amountAtomic)) / 10 ** info.decimals;
  if (info.usdPegged) return units;
  const rate = pesoRates[symbol];
  return rate === undefined ? null : units * rate;
}
