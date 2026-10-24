import { describe, expect, test } from 'vitest';
import { ASSETS, type TokenTransfer, type WalletFacts } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import { LedgerFileSchema, buildLedger, type LedgerInput } from '../src';

const AGENT = '0xa000000000000000000000000000000000000001';
const PROBE = '0xb000000000000000000000000000000000000002';
const PAYER = '0xc000000000000000000000000000000000000003';
const PAYER2 = '0xd000000000000000000000000000000000000004';
const PAYER3 = '0xe000000000000000000000000000000000000005';
const SELLER = '0x1111111111111111111111111111111111111111';
const FUNDER = '0xf00000000000000000000000000000000000000f';
const START = '2026-10-06T00:00:00Z';

let n = 0;
const transfer = (o: { from: string; to: string; token?: string; amount?: string; hash?: string }): TokenTransfer => ({
  txHash: o.hash ?? `0x${(++n).toString(16).padStart(64, '0')}`,
  from: o.from,
  to: o.to,
  token: (o.token ?? ASSETS.USDC.address).toLowerCase(),
  amountAtomic: o.amount ?? '5000',
  at: '2026-10-22T12:00:00.000Z',
});
const facts = (address: string, over: Partial<WalletFacts> = {}): WalletFacts => ({ address, firstActivityAt: '2026-09-01T10:00:00.000Z', firstFunder: FUNDER, ...over });
const empty: LedgerInput = { agent: AGENT, projectWallets: [], incoming: [], outgoing: [], runs: [], facts: {}, hackathonStart: START };
const ledger = (over: Partial<LedgerInput> = {}) => buildLedger({ ...empty, ...over });

describe('buildLedger: money', () => {
  test('earned is what came in from others and spent is what went out to others, in dollars, exactly', () => {
    const l = ledger({
      incoming: [transfer({ from: PAYER, to: AGENT, amount: '5000' }), transfer({ from: PAYER2, to: AGENT, token: ASSETS.USAT.address, amount: '2500' }), transfer({ from: PAYER, to: AGENT, token: ASSETS.USDT.address, amount: '1' })],
      outgoing: [transfer({ from: AGENT, to: SELLER, token: ASSETS.USAT.address, amount: '5000' }), transfer({ from: AGENT, to: SELLER, amount: '1' })],
    });
    expect(l.earnedUsd).toBe(0.007501);
    expect(l.spentUsd).toBe(0.005001);
  });

  test('sums are exact however many small amounts there are: no floating-point drift', () => {
    const l = ledger({ incoming: Array.from({ length: 1000 }, () => transfer({ from: PAYER, to: AGENT, amount: '1' })) });
    expect(l.earnedUsd).toBe(0.001);
  });

  test('transfers between project wallets are self transfers, counted once, and in neither earned nor spent', () => {
    const toProbe = transfer({ from: AGENT, to: PROBE, amount: '50000' });
    const back = transfer({ from: PROBE, to: AGENT, amount: '49000' });
    const l = ledger({ projectWallets: [PROBE], outgoing: [toProbe, back], incoming: [back, toProbe] }); // both wallets' views, so each transfer is listed twice
    expect(l.selfTransfers).toBe(2);
    expect(l.earnedUsd).toBe(0);
    expect(l.spentUsd).toBe(0);
  });

  test('a transfer that appears in both lists is one transfer', () => {
    const t = transfer({ from: PAYER, to: AGENT, amount: '1234' });
    expect(ledger({ incoming: [t, { ...t }], outgoing: [{ ...t }] }).earnedUsd).toBe(0.001234);
  });

  test('two different transfers in one transaction are both counted', () => {
    const hash = `0x${'9'.repeat(64)}`;
    const l = ledger({ incoming: [transfer({ from: PAYER, to: AGENT, amount: '1000', hash }), transfer({ from: PAYER, to: AGENT, amount: '2000', hash })] });
    expect(l.earnedUsd).toBe(0.003);
  });

  test('the agent is a project wallet even when the caller did not list it', () => {
    const l = ledger({ projectWallets: [], incoming: [transfer({ from: AGENT, to: AGENT, amount: '5000' })] });
    expect(l.selfTransfers).toBe(1);
    expect(l.earnedUsd).toBe(0);
  });

  test('addresses are compared without regard to case', () => {
    const upper = (a: string) => `0x${a.slice(2).toUpperCase()}`;
    const l = ledger({ agent: upper(AGENT), projectWallets: [upper(PROBE)], incoming: [transfer({ from: PROBE, to: AGENT })], outgoing: [transfer({ from: AGENT, to: upper(SELLER), amount: '700' })] });
    expect(l.selfTransfers).toBe(1);
    expect(l.spentUsd).toBe(0.0007);
  });

  test('only dollar assets with six decimals are money: other tokens, pesos and a naira token are not summed', () => {
    const l = ledger({
      incoming: [
        transfer({ from: PAYER, to: AGENT, token: ASSETS.wARS.address, amount: '1000000000000000000' }), // 18 decimals, not dollars
        transfer({ from: PAYER, to: AGENT, token: ASSETS.cNGN.address, amount: '1000000' }), // six decimals, not dollars
        transfer({ from: PAYER, to: AGENT, token: '0x1234567890123456789012345678901234567890', amount: '1000000' }), // nobody has heard of it
        transfer({ from: PAYER, to: AGENT, amount: '1000000' }), // one dollar of USDC
      ],
    });
    expect(l.earnedUsd).toBe(1);
  });

  test('an amount that is not a whole number of units is not money', () => {
    const l = ledger({ incoming: [transfer({ from: PAYER, to: AGENT, amount: '1.5' }), transfer({ from: PAYER, to: AGENT, amount: '-5' }), transfer({ from: PAYER, to: AGENT, amount: '' }), transfer({ from: PAYER, to: AGENT, amount: '0x10' })] });
    expect(l.earnedUsd).toBe(0);
  });

  test('transfers that involve none of our wallets are ignored', () => {
    const l = ledger({ incoming: [transfer({ from: PAYER, to: PAYER2 })], outgoing: [transfer({ from: PAYER2, to: SELLER })] });
    expect(l).toMatchObject({ earnedUsd: 0, spentUsd: 0, selfTransfers: 0 });
  });

  test('a transfer between project wallets is a self transfer whatever the token is', () => {
    const l = ledger({ projectWallets: [PROBE], outgoing: [transfer({ from: AGENT, to: PROBE, token: ASSETS.wARS.address, amount: '5' })] });
    expect(l.selfTransfers).toBe(1);
  });

  test('nothing in, nothing out: zeros', () => {
    expect(ledger()).toEqual({ spentUsd: 0, earnedUsd: 0, byService: [], signers: [], selfTransfers: 0 });
  });

  test('the inputs are not changed', () => {
    const input: LedgerInput = { ...empty, projectWallets: [PROBE], incoming: [transfer({ from: PAYER, to: AGENT })], outgoing: [transfer({ from: AGENT, to: SELLER })], facts: { [PAYER]: facts(PAYER) } };
    const copy = structuredClone(input);
    buildLedger(input);
    expect(input).toEqual(copy);
  });

  test('a hackathon start that is not a date is refused, even with nobody to classify', () => {
    expect(() => ledger({ hackathonStart: 'soon' })).toThrow(/hackathonStart/);
  });
});

describe('buildLedger: who paid us, and who counts', () => {
  const paid = (from: string) => transfer({ from, to: AGENT, amount: '5000' });

  test('each payer is classified by the hackathon’s rule, with the reason', () => {
    const l = ledger({
      projectWallets: [PROBE],
      incoming: [paid(PAYER), paid(PAYER2), paid(PAYER3), paid(SELLER), paid(FUNDER)],
      facts: {
        [PAYER]: facts(PAYER), // active in September, funded by a stranger
        [PAYER2]: facts(PAYER2, { firstActivityAt: '2026-10-10T00:00:00Z' }), // first seen after the start
        [PAYER3]: facts(PAYER3, { firstFunder: PROBE }), // we funded it
        [SELLER]: facts(SELLER, { firstActivityAt: null, firstFunder: null }), // never active
        // FUNDER: nothing known about it at all
      },
    });
    expect(Object.fromEntries(l.signers.map((s) => [s.address, [s.counted, s.reason]]))).toEqual({
      [PAYER]: [true, 'counted'],
      [PAYER2]: [false, 'activity_after_start'],
      [PAYER3]: [false, 'funded_by_project'],
      [SELLER]: [false, 'no_prior_activity'],
      [FUNDER]: [false, 'no_prior_activity'],
    });
  });

  test('a payer is listed once however many times it paid, and the counted ones come first, then by address', () => {
    const l = ledger({ incoming: [paid(PAYER3), paid(PAYER2), paid(PAYER), paid(PAYER2), paid(PAYER3)], facts: { [PAYER]: facts(PAYER), [PAYER2]: facts(PAYER2, { firstActivityAt: null }), [PAYER3]: facts(PAYER3) } });
    expect(l.signers.map((s) => [s.address, s.counted])).toEqual([[PAYER, true], [PAYER3, true], [PAYER2, false]]);
  });

  test('facts are found whatever the case their address was keyed in', () => {
    const l = ledger({ incoming: [paid(PAYER)], facts: { [PAYER.toUpperCase().replace('0X', '0x')]: facts(PAYER) } });
    expect(l.signers).toEqual([{ address: PAYER, counted: true, reason: 'counted' }]);
  });

  test('a project wallet is never a signer: what it sent us is a self transfer', () => {
    const l = ledger({ projectWallets: [PROBE], incoming: [paid(PROBE)] });
    expect(l.signers).toEqual([]);
    expect(l.selfTransfers).toBe(1);
  });

  test('someone who sent us nothing of value, or a token that is not a dollar, is not a signer: dust and spam do not pad the list', () => {
    const l = ledger({
      incoming: [transfer({ from: PAYER, to: AGENT, amount: '0' }), transfer({ from: PAYER2, to: AGENT, token: ASSETS.cNGN.address, amount: '5000' }), transfer({ from: PAYER3, to: AGENT, token: '0x1234567890123456789012345678901234567890' })],
    });
    expect(l.signers).toEqual([]);
  });

  test('people we paid are not signers', () => {
    expect(ledger({ outgoing: [transfer({ from: AGENT, to: SELLER })] }).signers).toEqual([]);
  });

  test('the address in the answer is lower case, whatever the transfer said', () => {
    const l = ledger({ incoming: [transfer({ from: PAYER.toUpperCase().replace('0X', '0x'), to: AGENT })] });
    expect(l.signers[0]!.address).toBe(PAYER);
  });
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: '0123456789abcdef',
  kind: 'buy',
  startedAt: '2026-10-22T12:00:00.000Z',
  endpoint: { url: 'https://gateway.usebuy.ai/v1/social/x/posts/search', method: 'POST' },
  steps: [],
  verdicts: [],
  payments: [],
  ...over,
});
const payment = (over: Partial<RunRecord['payments'][number]> = {}) => ({ asset: ASSETS.USAT.address, symbol: 'USAT', amountAtomic: '5000', payTo: SELLER, txHash: `0x${'a'.repeat(64)}`, ...over });

describe('buildLedger: what we bought, and from whom', () => {
  test('a row per service: calls, dollars and the transaction hashes that prove them', () => {
    const l = ledger({
      runs: [
        run({ id: '0000000000000001', payments: [payment({ txHash: `0x${'1'.repeat(64)}` })] }),
        run({ id: '0000000000000002', payments: [payment({ txHash: `0x${'2'.repeat(64)}`, amountAtomic: '6030' }), payment({ txHash: `0x${'3'.repeat(64)}`, amountAtomic: '3606' })] }),
        run({ id: '0000000000000003', endpoint: { url: 'https://other.example/v1/x', method: 'GET' }, payments: [payment({ txHash: `0x${'4'.repeat(64)}`, amountAtomic: '10000' })] }),
      ],
    });
    expect(l.byService).toEqual([
      { name: 'gateway.usebuy.ai', calls: 3, usd: 0.014636, proofs: [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`, `0x${'3'.repeat(64)}`] },
      { name: 'other.example', calls: 1, usd: 0.01, proofs: [`0x${'4'.repeat(64)}`] },
    ]);
  });

  test('our own fixtures are labelled self', () => {
    const l = ledger({ runs: [run({ kind: 'fixture', endpoint: { url: 'https://railwalker.example/api/fixtures/ok', method: 'GET' }, payments: [payment()] })] });
    expect(l.byService.map((s) => s.name)).toEqual(['self: fixtures']);
  });

  test('a run of a private kind is named by its kind and never by its host', () => {
    const l = ledger({
      runs: [run({ id: '0000000000000001', kind: 'unsolicited', endpoint: { url: 'https://secret-seller.example/x', method: 'GET' }, payments: [payment()] }), run({ id: '0000000000000002', kind: 'customer', endpoint: { url: 'https://customer.example/x', method: 'GET' }, payments: [payment()] })],
    });
    expect(l.byService.map((s) => s.name)).toEqual(['private: customer', 'private: unsolicited']);
    expect(JSON.stringify(l)).not.toMatch(/secret-seller|customer\.example/);
  });

  test('a payment that cannot be shown to have settled is still a call and a cost, but has no proof', () => {
    const { txHash: _drop, ...unsettled } = payment();
    const l = ledger({ runs: [run({ payments: [unsettled, payment({ txHash: undefined })] })] });
    expect(l.byService).toEqual([{ name: 'gateway.usebuy.ai', calls: 2, usd: 0.01, proofs: [] }]);
  });

  test('the same proof is listed once', () => {
    const l = ledger({ runs: [run({ payments: [payment(), payment()] })] });
    expect(l.byService[0]!.proofs).toHaveLength(1);
    expect(l.byService[0]!.calls).toBe(2);
  });

  test('a run that paid nothing makes no row, and the same run listed twice is one run', () => {
    const paidRun = run({ payments: [payment()] });
    expect(ledger({ runs: [run({ id: 'aaaaaaaaaaaaaaaa' })] }).byService).toEqual([]);
    expect(ledger({ runs: [paidRun, structuredClone(paidRun)] }).byService[0]!.calls).toBe(1);
  });

  test('a payment in an asset that is not a dollar costs nothing in dollars but is still a call', () => {
    const l = ledger({ runs: [run({ payments: [payment({ asset: ASSETS.wARS.address, symbol: 'wARS', amountAtomic: '1000000000000000000' }), payment({ asset: '0x1234567890123456789012345678901234567890' })] })] });
    expect(l.byService).toEqual([{ name: 'gateway.usebuy.ai', calls: 2, usd: 0, proofs: [`0x${'a'.repeat(64)}`] }]);
  });

  test('rows are sorted by name', () => {
    const l = ledger({
      runs: [
        run({ id: '0000000000000001', endpoint: { url: 'https://zzz.example/x', method: 'GET' }, payments: [payment()] }),
        run({ id: '0000000000000002', kind: 'fixture', payments: [payment()] }),
        run({ id: '0000000000000003', endpoint: { url: 'https://aaa.example/x', method: 'GET' }, payments: [payment()] }),
      ],
    });
    expect(l.byService.map((s) => s.name)).toEqual(['aaa.example', 'self: fixtures', 'zzz.example']);
  });

  test('a run whose endpoint is not a URL still counts, under a name that does not claim to be one', () => {
    const l = ledger({ runs: [run({ endpoint: { url: 'not a url', method: 'GET' }, payments: [payment()] })] });
    expect(l.byService.map((s) => s.name)).toEqual(['unknown service']);
  });
});

describe('LedgerFileSchema: the file the runner publishes and the ledger page reads', () => {
  const built = buildLedger({
    ...empty,
    projectWallets: [PROBE],
    incoming: [transfer({ from: PAYER, to: AGENT, amount: '5000' }), transfer({ from: PROBE, to: AGENT })],
    outgoing: [transfer({ from: AGENT, to: SELLER, token: ASSETS.USAT.address, amount: '6030' })],
    runs: [run({ payments: [payment()] }), run({ id: '0000000000000009', kind: 'fixture', endpoint: { url: 'https://railwalker.example/api/fixtures/ok', method: 'GET' }, payments: [payment()] })],
    facts: { [PAYER]: facts(PAYER) },
  });
  const ok = { generatedAt: '2026-10-22T12:00:00.000Z', hackathonStart: START.replace('Z', '.000Z'), agent: AGENT, ledger: built };

  test('accepts what the books build, and an empty ledger', () => {
    expect(LedgerFileSchema.parse(ok)).toEqual(ok);
    expect(LedgerFileSchema.safeParse({ ...ok, ledger: buildLedger(empty) }).success).toBe(true);
  });

  test('the books really do contain a service, a signer and a self transfer, so the case above means something', () => {
    expect(built.byService.length).toBeGreaterThan(1);
    expect(built.signers).toHaveLength(1);
    expect(built.selfTransfers).toBe(1);
  });

  const withLedger = (over: Record<string, unknown>) => ({ ...ok, ledger: { ...built, ...over } });
  const withService = (over: Record<string, unknown>) => withLedger({ byService: [{ ...built.byService[0]!, ...over }] });
  const withSigner = (over: Record<string, unknown>) => withLedger({ signers: [{ ...built.signers[0]!, ...over }] });

  test.each([
    ['an extra field on the file', { ...ok, privateKey: 'x' }],
    ['an extra field on the ledger', withLedger({ hosts: ['secret.example'] })],
    ['an extra field on a service', withService({ payTo: SELLER })],
    ['an extra field on a signer', withSigner({ firstFunder: FUNDER })],
    ['spent below zero', withLedger({ spentUsd: -0.01 })],
    ['earned below zero', withLedger({ earnedUsd: -0.01 })],
    ['earned that is not a number', withLedger({ earnedUsd: '5' })],
    ['earned that is infinite', withLedger({ earnedUsd: Number.POSITIVE_INFINITY })],
    ['a service with no name', withService({ name: '' })],
    ['a service with an absurd name', withService({ name: 'x'.repeat(200) })],
    ['fractional calls', withService({ calls: 1.5 })],
    ['negative calls', withService({ calls: -1 })],
    ['dollars below zero on a service', withService({ usd: -1 })],
    ['a proof that is not a transaction hash', withService({ proofs: ['0x123'] })],
    ['a signer address in capitals', withSigner({ address: PAYER.toUpperCase().replace('0X', '0x') })],
    ['a signer address that is not an address', withSigner({ address: 'someone' })],
    ['a reason that does not exist', withSigner({ reason: 'because' })],
    ['a signer counted as text', withSigner({ counted: 'yes' })],
    ['self transfers below zero', withLedger({ selfTransfers: -1 })],
    ['self transfers that are fractional', withLedger({ selfTransfers: 0.5 })],
    ['an agent that is not an address', { ...ok, agent: 'agent' }],
    ['a generation time that is not ISO', { ...ok, generatedAt: 'now' }],
    ['a hackathon start that is not ISO', { ...ok, hackathonStart: 'soon' }],
    ['no ledger', { generatedAt: ok.generatedAt, hackathonStart: ok.hackathonStart, agent: AGENT }],
    ['more services than there can be', withLedger({ byService: Array.from({ length: 501 }, () => built.byService[0]!) })],
    ['more signers than there can be', withLedger({ signers: Array.from({ length: 5001 }, () => built.signers[0]!) })],
    ['more proofs than a service can have', withService({ proofs: Array.from({ length: 1001 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`) })],
  ])('rejects %s', (_name, value) => {
    expect(LedgerFileSchema.safeParse(value).success).toBe(false);
  });
});
