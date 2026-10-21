import { describe, expect, test } from 'vitest';
import { ConfigError } from '@railwalker/chain';
import { fakeFetch } from '@railwalker/testkit';
import { scanEndpoint, type CheckReport } from '@railwalker/scanner';
import { ASSETS, emptySpendState, type SpendState } from '@railwalker/core';
import { sellerKeyFor } from '@railwalker/data';
import { CODE, FAUCET, KEY, MAINNET_ENV, SALT, SEPOLIA_ENV, URL_OK, challengeWith, confirmedFrom, harness, scanReport } from './harness';

const SPEND_PATH = '/work/data/spend.json';
const ARGS = ['check', URL_OK, '--assets', 'USAT', '--stage', 'buy'];

const jsonOf = (files: Map<string, { data: string }>, path: string) => JSON.parse(files.get(path)!.data);

describe('check: consent', () => {
  test('without --yes: exit 2, what it would pay is printed first, and nothing is sent or written', async () => {
    const h = harness();
    expect(await h.run(...ARGS)).toBe(2);
    expect(h.err()).toContain(URL_OK);
    expect(h.err()).toMatch(/USAT\s+\$0\.0050/);
    expect(h.err()).toMatch(/would pay/i);
    expect(h.err()).toMatch(/--yes/);
    expect(h.calls.confirm).toEqual([]);
    expect(h.files.has(SPEND_PATH)).toBe(false);
  });

  test('with --yes it pays: confirm is called once, with the stage, the assets and the endpoint facts', async () => {
    const h = harness();
    expect(await h.run(...ARGS, '--yes')).toBe(0);
    expect(h.calls.confirm).toHaveLength(1);
    expect(h.calls.confirm[0]!.opts).toMatchObject({
      stage: 'buy',
      assets: ['USAT'],
      optedOut: false,
      facts: { url: URL_OK, method: 'GET', source: 'buy' },
    });
    expect(h.err()).toMatch(/USAT\s+PASS/);
    expect(h.err()).toContain('CONFIRMED');
  });

  test('stdout is the final JSON report, with the CONFIRMED verdict', async () => {
    const h = harness();
    await h.run(...ARGS, '--yes');
    const printed = JSON.parse(h.out()) as CheckReport;
    expect(printed.verdicts.find((v) => v.assetSymbol === 'USAT')).toMatchObject({ kind: 'PASS', basis: 'CONFIRMED' });
  });
});

describe('check: usage errors (exit 2, nothing happens)', () => {
  test.each([
    ['no --assets', ['check', URL_OK, '--stage', 'buy'], /--assets is required/],
    ['no --stage', ['check', URL_OK, '--assets', 'USAT'], /--stage is required/],
    ['an unknown asset', ['check', URL_OK, '--assets', 'DOGE', '--stage', 'buy'], /unknown asset "DOGE"/],
    ['an empty asset list', ['check', URL_OK, '--assets', ',', '--stage', 'buy'], /--assets/],
    ['an unknown stage', ['check', URL_OK, '--assets', 'USAT', '--stage', 'yolo'], /unknown stage "yolo"/],
    ['the customer stage without --fee-paid', ['check', URL_OK, '--assets', 'USAT', '--stage', 'customer'], /--fee-paid is required for the customer stage/],
    ['a non-positive --fee-paid', ['check', URL_OK, '--assets', 'USAT', '--stage', 'customer', '--fee-paid', '0'], /--fee-paid must be a positive number/],
    ['--deliveries 0', [...ARGS, '--deliveries', '0'], /--deliveries must be 1, 2 or 3/],
    ['--deliveries 4', [...ARGS, '--deliveries', '4'], /--deliveries must be 1, 2 or 3/],
    ['--deliveries x', [...ARGS, '--deliveries', 'x'], /--deliveries must be 1, 2 or 3/],
    ['a body that is not JSON', [...ARGS, '--body', '{nope'], /--body must be valid JSON/],
    ['no URL', ['check', '--assets', 'USAT', '--stage', 'buy'], /needs 1 argument/],
  ] as const)('%s', async (_name, argv, message) => {
    const h = harness();
    expect(await h.run(...(argv as unknown as string[]), '--yes')).toBe(2);
    expect(h.err()).toMatch(message);
    expect(h.calls.scan).toEqual([]);
    expect(h.calls.confirm).toEqual([]);
  });

  test('--fee-paid and --deliveries are accepted where they belong', async () => {
    const h = harness();
    expect(await h.run('check', URL_OK, '--assets', 'USAT', '--stage', 'customer', '--fee-paid', '0.02', '--deliveries', '3', '--yes')).toBe(0);
    expect(h.calls.confirm[0]!.opts).toMatchObject({ stage: 'customer', feePaidUsd: 0.02, deliveries: 3 });
  });
});

describe('check: configuration (exit 3: a safety rule refuses)', () => {
  test('no wallet configured', async () => {
    const h = harness({ env: {} });
    expect(await h.run(...ARGS, '--yes')).toBe(3);
    expect(h.err()).toMatch(/AGENT_PRIVATE_KEY/);
    expect(h.calls.scan).toEqual([]);
    expect(h.calls.confirm).toEqual([]);
  });

  test('a configuration that fails validation is refused with the validator’s own message, never a value', async () => {
    const h = harness({
      loadConfig: () => {
        throw new ConfigError(`Invalid configuration. SELLER_SALT: required on mainnet`);
      },
    });
    expect(await h.run(...ARGS, '--yes')).toBe(3);
    expect(h.err()).toContain('SELLER_SALT: required on mainnet');
  });

  test('checks pay on Celo mainnet only: a Sepolia configuration is refused', async () => {
    const h = harness({ env: SEPOLIA_ENV });
    expect(await h.run(...ARGS, '--yes')).toBe(3);
    expect(h.err()).toMatch(/mainnet/i);
    expect(h.calls.confirm).toEqual([]);
  });
});

describe('check: the policy is applied before anything is paid', () => {
  test('--stage unsolicited against a non read-style endpoint exits 3 and pays nothing', async () => {
    const h = harness();
    expect(await h.run('check', 'https://seller.example/api/send-payment', '--assets', 'USAT', '--stage', 'unsolicited', '--yes')).toBe(3);
    expect(h.err()).toContain('not_read_style');
    expect(h.calls.confirm).toEqual([]);
  });

  test('a refusal is exit 3 even without --yes: no consent changes it', async () => {
    const h = harness();
    expect(await h.run('check', 'https://seller.example/api/send-payment', '--assets', 'USAT', '--stage', 'buy')).toBe(3);
  });

  test.each([
    ['a price over the per-probe cap', { amount: '60000' }, {}, 'over_probe_cap'],
    ['a balance that would fall under the reserve', { amount: '5000' }, { balance: 100_000n }, 'below_reserve'],
    ['an unsolicited price under $0.005', { amount: '500', stage: 'unsolicited' }, {}, 'price_below_unsolicited_minimum'],
    ['a customer price over half the fee', { amount: '12000', stage: 'customer', fee: '0.02' }, {}, 'customer_fee_fraction_exceeded'],
  ] as const)('%s -> exit 3 with the reason, and nothing is paid', async (_name, spec, bal, reason) => {
    const stage = (spec as { stage?: string }).stage ?? 'buy';
    const fee = (spec as { fee?: string }).fee;
    const challenge = challengeWith(spec.amount);
    const h = harness({
      scan: (req) => scanReport(req.url, challenge),
      readBalances: async () => ({ ...FAUCET, USAT: (bal as { balance?: bigint }).balance ?? FAUCET.USAT }),
    });
    const argv = ['check', URL_OK, '--assets', 'USAT', '--stage', stage, '--yes', ...(fee ? ['--fee-paid', fee] : [])];
    expect(await h.run(...argv)).toBe(3);
    expect(h.err()).toContain(reason);
    expect(h.calls.confirm).toEqual([]);
  });

  test('an unsolicited seller that already took three settlements is refused, from the saved spend state', async () => {
    const spend: SpendState = { ...emptySpendState(), settlementsBySeller: { [sellerKeyFor('unsolicited', 'seller.example', SALT)]: 3 } };
    const h = harness({ files: { [SPEND_PATH]: JSON.stringify(spend) } });
    expect(await h.run('check', URL_OK, '--assets', 'USAT', '--stage', 'unsolicited', '--yes')).toBe(3);
    expect(h.err()).toContain('seller_settlement_limit');
  });

  test('an unsolicited seller is known by a salted key, not its host: a count saved under the plain host does not count', async () => {
    const spend: SpendState = { ...emptySpendState(), settlementsBySeller: { 'seller.example': 3 } };
    const h = harness({ files: { [SPEND_PATH]: JSON.stringify(spend) } });
    expect(await h.run('check', URL_OK, '--assets', 'USAT', '--stage', 'unsolicited', '--yes')).toBe(0);
    expect(h.calls.confirm).toHaveLength(1);
  });

  test('a peso asset with no rate is refused as unpriced, and the priced asset is still checked', async () => {
    const challenge = {
      x402Version: 2,
      resource: { url: URL_OK, mimeType: 'application/json' },
      accepts: [
        { scheme: 'exact', network: 'eip155:42220', amount: '1000000000000000000', asset: ASSETS.wARS.address, payTo: '0x1111111111111111111111111111111111111111', maxTimeoutSeconds: 300, extra: { name: 'Peso Argentino', version: '1', assetTransferMethod: 'permit2' } },
        ...challengeWith('5000').accepts.slice(2),
      ],
    };
    const h = harness({ scan: (req) => scanReport(req.url, challenge) });
    expect(await h.run('check', URL_OK, '--assets', 'wARS,USAT', '--stage', 'buy', '--yes')).toBe(0);
    expect(h.err()).toMatch(/wARS.*unpriced_asset/);
    expect(h.calls.confirm).toHaveLength(1);
  });

  test('an asset named twice is planned and paid once', async () => {
    const h = harness();
    expect(await h.run('check', URL_OK, '--assets', 'USAT,USAT', '--stage', 'buy', '--yes')).toBe(0);
    expect(h.err().match(/USAT\s+\$0\.0050/g)).toHaveLength(1);
    expect(h.calls.confirm[0]!.opts.assets).toEqual(['USAT']);
  });

  test('customer stage: what the plan already spends counts against the customer’s share of the fee', async () => {
    // fee $0.02 -> $0.01 to spend; two targets at $0.006 each: the first fits, the second does not
    const h = harness({ scan: (req) => scanReport(req.url, challengeWith('6000')) });
    expect(await h.run('check', URL_OK, '--assets', 'USDC,USAT', '--stage', 'customer', '--fee-paid', '0.02', '--yes')).toBe(0);
    expect(h.err()).toMatch(/USDC\s+\$0\.0060\s+would pay/);
    expect(h.err()).toMatch(/USAT\s+\$0\.0060\s+refused: customer_fee_fraction_exceeded/);
    expect(h.calls.confirm).toHaveLength(1);
  });

  test('an asset the seller does not offer on mainnet is said so, and if nothing at all can be paid that is exit 1', async () => {
    const h = harness();
    expect(await h.run('check', URL_OK, '--assets', 'wBRL', '--stage', 'buy', '--yes')).toBe(1);
    expect(h.err()).toMatch(/wBRL.*not offered/);
    expect(h.calls.confirm).toEqual([]);
  });

  test('the wallet balance is read before paying, and if it cannot be read nothing is paid (exit 1)', async () => {
    const h = harness({
      readBalances: async () => {
        throw new Error('rpc down');
      },
    });
    expect(await h.run(...ARGS, '--yes')).toBe(1);
    expect(h.err()).toMatch(/balance/i);
    expect(h.calls.confirm).toEqual([]);
  });
});

describe('check: what the scan found', () => {
  test('a URL the scanner refuses (https://127.0.0.1/) is exit 3 and nothing is paid', async () => {
    const h = harness();
    expect(await h.run('check', 'https://127.0.0.1/', '--assets', 'USAT', '--stage', 'buy', '--yes')).toBe(3);
    expect(h.err()).toContain('SKIPPED:unsafe_url');
    expect(h.calls.confirm).toEqual([]);
  });

  test('an endpoint that is not x402 has nothing to pay: exit 0, said plainly, nothing paid', async () => {
    const h = harness({
      scan: (req) =>
        scanEndpoint(
          { fetchImpl: fakeFetch({ [req.url]: () => new Response('hello', { status: 200 }) }), resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date(), userAgent: 't' },
          req,
        ),
    });
    expect(await h.run(...ARGS, '--yes')).toBe(0);
    expect(h.err()).toMatch(/not_x402|nothing to pay/i);
    expect(h.calls.confirm).toEqual([]);
  });

  test('a body makes it a POST, for the scan and for the payment', async () => {
    const h = harness();
    await h.run(...ARGS, '--body', '{"q":1}', '--yes');
    expect(h.calls.scan).toEqual([{ url: URL_OK, method: 'POST', body: { q: 1 } }]);
    expect(h.calls.confirm[0]!.opts).toMatchObject({ body: { q: 1 }, facts: { method: 'POST' } });
  });

  test('the stage decides how the seller is classified: customer is a visitor, unsolicited an ERC-8004 seller, fixture a fixture', async () => {
    for (const [stage, source, extra] of [
      ['customer', 'visitor', ['--fee-paid', '0.02']],
      ['unsolicited', 'erc8004', []],
      ['fixture', 'fixture', []],
    ] as const) {
      const h = harness({ scan: (req) => scanReport(req.url, challengeWith('5000')) });
      await h.run('check', URL_OK, '--assets', 'USAT', '--stage', stage, '--yes', ...extra);
      expect(h.calls.confirm[0]!.opts.facts.source, stage).toBe(source);
    }
  });
});

describe('check: the spend state survives between runs', () => {
  test('is loaded from data/spend.json, passed to confirm, and the updated state is written back', async () => {
    const before: SpendState = { totalUsd: 1.25, byEndpointDay: { 'seller.example|2026-10-22': 0.1 }, settlementsBySeller: { 'seller.example': 2 } };
    const h = harness({ files: { [SPEND_PATH]: JSON.stringify(before) } });
    expect(await h.run(...ARGS, '--yes')).toBe(0);
    expect(h.calls.confirm[0]!.spend).toEqual(before);
    expect(jsonOf(h.files, SPEND_PATH).totalUsd).toBeCloseTo(1.255, 6);
  });

  test('a missing file means nothing has been spent, and it is created', async () => {
    const h = harness();
    await h.run(...ARGS, '--yes');
    expect(h.calls.confirm[0]!.spend).toEqual(emptySpendState());
    expect(h.files.has(SPEND_PATH)).toBe(true);
  });

  test.each([
    ['not JSON', '{nope'],
    ['not a spend state', '{"hello":1}'],
    ['a negative total', JSON.stringify({ totalUsd: -1, byEndpointDay: {}, settlementsBySeller: {} })],
    ['a total that is not a number', JSON.stringify({ totalUsd: 'lots', byEndpointDay: {}, settlementsBySeller: {} })],
  ])('a corrupt state file (%s) is refused with exit 3: without it the caps cannot be enforced', async (_name, data) => {
    const h = harness({ files: { [SPEND_PATH]: data } });
    expect(await h.run(...ARGS, '--yes')).toBe(3);
    expect(h.err()).toMatch(/spend state/i);
    expect(h.calls.confirm).toEqual([]);
  });

  test('DATA_DIR moves the state file', async () => {
    const h = harness({ env: { ...MAINNET_ENV, DATA_DIR: '/var/rw' } });
    await h.run(...ARGS, '--yes');
    expect(h.files.has('/var/rw/spend.json')).toBe(true);
    expect(h.files.has(SPEND_PATH)).toBe(false);
  });

  test('a confirmation that throws leaves the saved state alone and is exit 1', async () => {
    const before = JSON.stringify({ ...emptySpendState(), totalUsd: 0.5 });
    const h = harness({
      files: { [SPEND_PATH]: before },
      confirm: async () => {
        throw new Error('rpc down');
      },
    });
    expect(await h.run(...ARGS, '--yes')).toBe(1);
    expect(h.files.get(SPEND_PATH)!.data).toBe(before);
    expect(h.err()).toContain('rpc down');
  });
});

describe('check --record', () => {
  test('writes the run and the report as JSON files named by id', async () => {
    const h = harness();
    expect(await h.run(...ARGS, '--yes', '--record', 'evidence')).toBe(0);
    const names = [...h.files.keys()].filter((p) => p.startsWith('/work/evidence/')).sort();
    expect(names).toHaveLength(2);
    expect(names.some((n) => /\/[0-9a-f]{16}\.report\.json$/.test(n))).toBe(true);
    expect(names).toContain('/work/evidence/run0123456789abcd.run.json');
    expect(jsonOf(h.files, '/work/evidence/run0123456789abcd.run.json')).toMatchObject({ id: 'run0123456789abcd', kind: 'fixture' });
  });

  test('nothing is written when nothing was paid', async () => {
    const h = harness();
    await h.run(...ARGS, '--record', 'evidence'); // no --yes
    expect([...h.files.keys()].some((p) => p.includes('evidence'))).toBe(false);
  });
});

describe('check: the outcome decides the exit code', () => {
  test('a seller that fails the check is still exit 0: the tool worked', async () => {
    const h = harness({
      confirm: async (_cfg, report, opts, spend) => {
        const r = confirmedFrom(report, opts.assets, spend, 0.005);
        return { ...r, report: { ...r.report, verdicts: r.report.verdicts.map((v) => (v.assetSymbol === 'USAT' ? { ...v, kind: 'FAIL', code: 'paid_not_delivered' } : v)) } };
      },
    });
    expect(await h.run(...ARGS, '--yes')).toBe(0);
    expect(h.err()).toContain('FAIL:paid_not_delivered');
  });

  test('when the confirmation skipped every requested asset it is exit 3', async () => {
    const h = harness({
      confirm: async (_cfg, report, _opts, spend) => ({
        report: { ...report, verdicts: report.verdicts.map((v) => (v.assetSymbol === 'USAT' ? { kind: 'SKIPPED' as const, code: 'over_event_cap' as const, basis: 'PREDICTED' as const, assetSymbol: 'USAT' as const, findings: [] } : v)) },
        run: confirmedFrom(report, [], spend, 0).run,
        spend,
      }),
    });
    expect(await h.run(...ARGS, '--yes')).toBe(3);
    expect(h.err()).toContain('SKIPPED:over_event_cap');
  });

  test('an ambiguous payment is reported as AMBIGUOUS and is not hidden by exit 0 silence', async () => {
    const h = harness({
      confirm: async (_cfg, report, opts, spend) => {
        const r = confirmedFrom(report, opts.assets, spend, 0.005);
        return { ...r, report: { ...r.report, verdicts: r.report.verdicts.map((v) => (v.assetSymbol === 'USAT' ? { ...v, kind: 'AMBIGUOUS', code: 'ambiguous_after_payment' } : v)) } };
      },
    });
    expect(await h.run(...ARGS, '--yes')).toBe(0);
    expect(h.err()).toContain('AMBIGUOUS');
  });
});

describe('check: secrets', () => {
  test('nothing printed contains the key', async () => {
    const h = harness();
    await h.run(...ARGS, '--yes');
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(KEY.slice(2));
    expect(CODE).toBeTruthy();
  });
});
