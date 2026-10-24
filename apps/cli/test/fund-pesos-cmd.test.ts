import { describe, expect, test } from 'vitest';
import { CODE, FAUCET, MAINNET_ENV, SEPOLIA_ENV, harness } from './harness';

const APPROVE = `0x${'a1'.repeat(32)}`;
const SWAP = `0x${'b2'.repeat(32)}`;

describe('fund-pesos: consent', () => {
  test('without --yes: exit 2, shows the route, the quote and the floor, and sends nothing', async () => {
    const h = harness();
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25')).toBe(2);
    expect(h.calls.fundPesos).toEqual([]);
    expect(h.calls.planPesos).toEqual([{ from: 'USAT', to: 'wARS', amountIn: 250_000n }]);
    const text = h.all();
    expect(text).toContain('0.250000 USAT');
    expect(text).toContain('407.500000 wARS'); // 0.25 x 1,630
    expect(text).toContain('403.425000 wARS'); // less 1% slippage: the least it will accept
    expect(text).toContain(CODE);
    expect(text).toMatch(/Nothing was sent/);
    expect(text).toMatch(/--yes/);
  });

  test('--yes swaps once, tagged, and reports both hashes, the tag and the balance it leaves', async () => {
    const h = harness();
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--yes')).toBe(0);
    expect(h.calls.fundPesos).toHaveLength(1);
    expect(h.calls.fundPesos[0]!.opts).toEqual({ from: 'USAT', fee: 'USAT' });
    const text = h.out();
    expect(text).toContain(APPROVE);
    expect(text).toContain(SWAP);
    expect(text).toContain(`${CODE} (verified on the transaction)`);
    expect(text).toContain('407.500000 wARS');
  });

  test('a swap whose tag cannot be verified is exit 1 and says where the transaction is', async () => {
    const h = harness({ fundPesos: async () => ({ approveHash: null, swapHash: SWAP as `0x${string}`, tagged: null, balances: FAUCET }) });
    expect(await h.run('fund-pesos', '--to', 'wBRL', '--usd', '0.25', '--yes')).toBe(1);
    expect(h.err()).toContain(SWAP);
    expect(h.err()).toMatch(/tag/i);
  });
});

describe('fund-pesos: what it takes from the command line', () => {
  test.each([
    [['--to', 'wMXN', '--usd', '0.25'], /--to must be wARS or wBRL/],
    [['--usd', '0.25'], /--to must be wARS or wBRL/],
    [['--to', 'wARS'], /--usd/],
    [['--to', 'wARS', '--usd', '0'], /--usd/],
    [['--to', 'wARS', '--usd', '0.51'], /at most \$0\.5/],
    [['--to', 'wARS', '--usd', '1e-3'], /--usd/],
    [['--to', 'wARS', '--usd', '0.1234567'], /--usd/],
    [['--to', 'wARS', '--usd', '0.25', '--from', 'USDC'], /--from must be USAT or USDT/],
    [['--to', 'wARS', '--usd', '0.25', '--fee', 'DOGE'], /--fee must be USAT, USDC or USDT/],
  ])('%j is a usage error (exit 2) and nothing is quoted or sent', async (flags, message) => {
    const h = harness();
    expect(await h.run('fund-pesos', ...flags, '--yes')).toBe(2);
    expect(h.err()).toMatch(message);
    expect(h.calls.planPesos).toEqual([]);
    expect(h.calls.fundPesos).toEqual([]);
  });
});

describe('fund-pesos: the safety rules (exit 3)', () => {
  test('it buys on Celo mainnet only', async () => {
    const h = harness({ env: SEPOLIA_ENV });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--yes')).toBe(3);
    expect(h.err()).toMatch(/mainnet/);
    expect(h.calls.fundPesos).toEqual([]);
  });

  test('without an attribution code it refuses: a swap cannot be tagged afterwards', async () => {
    const { RAILWALKER_ATTRIBUTION_CODE: _c, ...rest } = MAINNET_ENV;
    const h = harness({ env: rest });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--yes')).toBe(3);
    expect(h.err()).toMatch(/attribution/i);
    expect(h.calls.fundPesos).toEqual([]);
  });

  test('a wallet that does not hold the amount in the coin it spends is refused', async () => {
    const h = harness({ readBalances: async () => ({ ...FAUCET, USAT: 100_000n }) });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--yes')).toBe(3);
    expect(h.err()).toMatch(/holds only 0\.100000 USAT/);
    expect(h.calls.fundPesos).toEqual([]);
  });

  test('a swap that would leave the wallet under its $0.10 reserve is refused: the reserve pays the gas', async () => {
    const h = harness({ readBalances: async () => ({ ...FAUCET, USAT: 300_000n }) });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--yes')).toBe(3);
    expect(h.err()).toMatch(/reserve/);
    expect(h.calls.fundPesos).toEqual([]);
  });

  test('a quote of nothing refuses, and the wallet is left alone', async () => {
    const h = harness({
      planPesos: async () => {
        throw new Error('the wARS pool quotes nothing for this amount: it has no depth, so nothing was swapped');
      },
    });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--yes')).toBe(1);
    expect(h.err()).toMatch(/no depth/);
    expect(h.calls.fundPesos).toEqual([]);
  });
});

describe('fund-pesos: which coin it spends', () => {
  test('by default the coin the wallet holds more of, and gas is paid in the same coin', async () => {
    const h = harness({ readBalances: async () => ({ ...FAUCET, USAT: 400_000n, USDT: 1_500_000n }) });
    expect(await h.run('fund-pesos', '--to', 'wBRL', '--usd', '0.25', '--yes')).toBe(0);
    expect(h.calls.planPesos).toEqual([{ from: 'USDT', to: 'wBRL', amountIn: 250_000n }]);
    expect(h.calls.fundPesos[0]!.opts).toEqual({ from: 'USDT', fee: 'USDT' });
  });

  test('--from and --fee are obeyed', async () => {
    const h = harness({ readBalances: async () => ({ ...FAUCET, USAT: 2_000_000n, USDT: 2_000_000n, USDC: 1_000_000n }) });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--from', 'USDT', '--fee', 'USDC', '--yes')).toBe(0);
    expect(h.calls.fundPesos[0]!.opts).toEqual({ from: 'USDT', fee: 'USDC' });
  });

  test('a fee coin the wallet does not hold is refused: the swap could not pay its gas', async () => {
    const h = harness({ readBalances: async () => ({ ...FAUCET, USAT: 2_000_000n, USDC: 0n }) });
    expect(await h.run('fund-pesos', '--to', 'wARS', '--usd', '0.25', '--fee', 'USDC', '--yes')).toBe(3);
    expect(h.err()).toMatch(/no USDC to pay gas with/);
  });
});
