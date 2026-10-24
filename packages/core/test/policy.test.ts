import { describe, expect, test } from 'vitest';
import { DEFAULT_POLICY, SpendLedger, decidePay, emptySpendState, toUsd, type PayQuery } from '../src/policy';

const NOW = new Date('2026-10-22T12:00:00Z');
const q = (over: Partial<PayQuery> = {}): PayQuery => ({
  stage: 'buy',
  sellerKey: 's',
  priceUsd: 0.005,
  readStyle: true,
  optedOut: false,
  balanceUsd: 1,
  now: NOW,
  ...over,
});
const state = (over: Partial<ReturnType<typeof emptySpendState>> = {}) => ({ ...emptySpendState(), ...over });

describe('decidePay', () => {
  test('DEFAULT_POLICY is the spec', () => {
    expect(DEFAULT_POLICY).toEqual({
      perProbeMaxUsd: 0.05,
      perEndpointDayMaxUsd: 0.25,
      eventMaxUsd: 3,
      unsolicitedMaxSettlementsPerSeller: 3,
      unsolicitedMinPriceUsd: 0.005,
      reserveUsd: 0.1,
      customerSpendFraction: 0.5,
    });
  });

  test('buy $0.005 allowed; $0.05 allowed; $0.06 over_probe_cap', () => {
    expect(decidePay(DEFAULT_POLICY, state(), q({ priceUsd: 0.005 }))).toEqual({ allow: true });
    expect(decidePay(DEFAULT_POLICY, state(), q({ priceUsd: 0.05 }))).toEqual({ allow: true });
    expect(decidePay(DEFAULT_POLICY, state(), q({ priceUsd: 0.06 }))).toEqual({ allow: false, reason: 'over_probe_cap' });
  });

  test('unsolicited $0.004 -> price_below_unsolicited_minimum; $0.005 allowed', () => {
    expect(decidePay(DEFAULT_POLICY, state(), q({ stage: 'unsolicited', priceUsd: 0.004 }))).toEqual({ allow: false, reason: 'price_below_unsolicited_minimum' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ stage: 'unsolicited', priceUsd: 0.005 }))).toEqual({ allow: true });
  });

  test('the 4th settlement for one unsolicited seller -> seller_settlement_limit; another seller is unaffected', () => {
    const s = state({ settlementsBySeller: { s: 3 } });
    expect(decidePay(DEFAULT_POLICY, s, q({ stage: 'unsolicited' }))).toEqual({ allow: false, reason: 'seller_settlement_limit' });
    expect(decidePay(DEFAULT_POLICY, s, q({ stage: 'unsolicited', sellerKey: 'other' }))).toEqual({ allow: true });
    // consenting stages are not subject to the unsolicited limit
    expect(decidePay(DEFAULT_POLICY, s, q({ stage: 'buy' }))).toEqual({ allow: true });
  });

  test('event total 2.99 + 0.02 -> over_event_cap', () => {
    expect(decidePay(DEFAULT_POLICY, state({ totalUsd: 2.99 }), q({ priceUsd: 0.02 }))).toEqual({ allow: false, reason: 'over_event_cap' });
    expect(decidePay(DEFAULT_POLICY, state({ totalUsd: 2.99 }), q({ priceUsd: 0.01 }))).toEqual({ allow: true });
  });

  test('endpoint-day 0.24 + 0.02 -> over_endpoint_day_cap; the next UTC day starts fresh', () => {
    const s = state({ byEndpointDay: { 's|2026-10-22': 0.24 } });
    expect(decidePay(DEFAULT_POLICY, s, q({ priceUsd: 0.02 }))).toEqual({ allow: false, reason: 'over_endpoint_day_cap' });
    expect(decidePay(DEFAULT_POLICY, s, q({ priceUsd: 0.02, now: new Date('2026-10-23T00:00:01Z') }))).toEqual({ allow: true });
  });

  test('balance 0.05 -> below_reserve (the reserve of $0.10 must survive the payment)', () => {
    expect(decidePay(DEFAULT_POLICY, state(), q({ balanceUsd: 0.05 }))).toEqual({ allow: false, reason: 'below_reserve' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ balanceUsd: 0.105, priceUsd: 0.005 }))).toEqual({ allow: true });
    expect(decidePay(DEFAULT_POLICY, state(), q({ balanceUsd: 0.1, priceUsd: 0.005 }))).toEqual({ allow: false, reason: 'below_reserve' });
  });

  test('a wallet that does not hold the price in the asset -> insufficient_asset_balance, after the dollar checks; unknown holdings do not block', () => {
    expect(decidePay(DEFAULT_POLICY, state(), q({ holdsPrice: false }))).toEqual({ allow: false, reason: 'insufficient_asset_balance' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ holdsPrice: true }))).toEqual({ allow: true });
    expect(decidePay(DEFAULT_POLICY, state(), q({ holdsPrice: undefined }))).toEqual({ allow: true });
    // The reason reported is the most fundamental one: a wallet under its reserve says so first.
    expect(decidePay(DEFAULT_POLICY, state(), q({ holdsPrice: false, balanceUsd: 0.05 }))).toEqual({ allow: false, reason: 'below_reserve' });
  });

  test('customer: fee 0.02, price 0.012 -> customer_fee_fraction_exceeded; price 0.01 allowed; spend so far counts', () => {
    expect(decidePay(DEFAULT_POLICY, state(), q({ stage: 'customer', feePaidUsd: 0.02, priceUsd: 0.012 }))).toEqual({ allow: false, reason: 'customer_fee_fraction_exceeded' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ stage: 'customer', feePaidUsd: 0.02, priceUsd: 0.01 }))).toEqual({ allow: true });
    expect(decidePay(DEFAULT_POLICY, state(), q({ stage: 'customer', feePaidUsd: 0.25, priceUsd: 0.05, spentOnThisCheckUsd: 0.1 }))).toEqual({ allow: false, reason: 'customer_fee_fraction_exceeded' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ stage: 'customer', priceUsd: 0.005 }))).toEqual({ allow: false, reason: 'customer_fee_fraction_exceeded' });
  });

  test('opted out -> opted_out; not read style -> not_read_style; priceUsd null -> unpriced_asset', () => {
    expect(decidePay(DEFAULT_POLICY, state(), q({ optedOut: true }))).toEqual({ allow: false, reason: 'opted_out' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ readStyle: false }))).toEqual({ allow: false, reason: 'not_read_style' });
    expect(decidePay(DEFAULT_POLICY, state(), q({ priceUsd: null }))).toEqual({ allow: false, reason: 'unpriced_asset' });
  });

  test('a non read-style endpoint is refused before anything else', () => {
    expect(decidePay(DEFAULT_POLICY, state({ totalUsd: 99 }), q({ readStyle: false, optedOut: true }))).toEqual({ allow: false, reason: 'not_read_style' });
  });

  test('deciding never mutates the state', () => {
    const s = state({ totalUsd: 1, settlementsBySeller: { s: 1 } });
    const before = JSON.stringify(s);
    decidePay(DEFAULT_POLICY, s, q());
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('toUsd', () => {
  test('USDC 5000 -> 0.005; wARS without a rate -> null; wARS 1e18 with rate 0.0007 -> 0.0007', () => {
    expect(toUsd('USDC', '5000')).toBeCloseTo(0.005, 10);
    expect(toUsd('USAT', '250000')).toBeCloseTo(0.25, 10);
    expect(toUsd('wARS', '1000000000000000000')).toBeNull();
    expect(toUsd('wARS', '1000000000000000000', { wARS: 0.0007 })).toBeCloseTo(0.0007, 10);
  });

  test('cNGN is not USD pegged: null without a rate', () => {
    expect(toUsd('cNGN', '1000000')).toBeNull();
    expect(toUsd('cNGN', '1000000', { cNGN: 0.0006 })).toBeCloseTo(0.0006, 10);
  });

  test('a malformed amount is null', () => {
    expect(toUsd('USDC', '')).toBeNull();
    expect(toUsd('USDC', '1.5')).toBeNull();
    expect(toUsd('USDC', '-5')).toBeNull();
  });
});

describe('SpendLedger (Review Focus 5)', () => {
  test('ten concurrent reserves of $0.05 against eventMaxUsd 0.2 allow exactly four', async () => {
    const ledger = new SpendLedger({ ...DEFAULT_POLICY, eventMaxUsd: 0.2 }, emptySpendState());
    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reserve(q({ priceUsd: 0.05, sellerKey: 's' }))));
    expect(results.filter((r) => r.allow)).toHaveLength(4);
    expect(results.find((r) => !r.allow)).toMatchObject({ allow: false, reason: 'over_event_cap' });
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.2, 10);
  });

  test('release returns the reservation; four sequential unsolicited reserves for one seller allow three', async () => {
    const ledger = new SpendLedger(DEFAULT_POLICY, emptySpendState());
    const query = q({ stage: 'unsolicited', priceUsd: 0.01 });
    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await ledger.reserve(query));
    expect(decisions.map((d) => d.allow)).toEqual([true, true, true, false]);

    ledger.release(query);
    expect(ledger.snapshot().settlementsBySeller.s).toBe(2);
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.02, 10);
    expect((await ledger.reserve(query)).allow).toBe(true);
  });

  test('a denied reserve records nothing', async () => {
    const ledger = new SpendLedger(DEFAULT_POLICY, emptySpendState());
    expect((await ledger.reserve(q({ priceUsd: 0.5 }))).allow).toBe(false);
    expect(ledger.snapshot()).toEqual(emptySpendState());
  });

  test('snapshot is a copy: mutating it does not change the ledger', async () => {
    const ledger = new SpendLedger(DEFAULT_POLICY, emptySpendState());
    await ledger.reserve(q());
    const snap = ledger.snapshot();
    snap.totalUsd = 999;
    snap.settlementsBySeller.s = 999;
    expect(ledger.snapshot().totalUsd).toBeCloseTo(0.005, 10);
    expect(ledger.snapshot().settlementsBySeller.s).toBe(1);
  });

  test('the ledger starts from an existing state', async () => {
    const ledger = new SpendLedger(DEFAULT_POLICY, { totalUsd: 2.99, byEndpointDay: {}, settlementsBySeller: {} });
    expect((await ledger.reserve(q({ priceUsd: 0.02 }))).allow).toBe(false);
  });
});
