import { describe, expect, test } from 'vitest';
import { decodeFunctionData, encodePacked, erc20Abi, parseAbi, type Hex } from 'viem';
import { ASSETS } from '@railwalker/core';
import {
  FALLBACK_PESO_USD,
  FUNDABLE_PESOS,
  MAX_FUNDING_USD,
  POOL_FEE,
  UNISWAP_V3,
  encodeRoute,
  executeSwap,
  minOutFor,
  planSwap,
  readPesoRates,
  routeFor,
  type Clients,
  type PesoReader,
} from '../src';

const OWNER = '0x3333333333333333333333333333333333333333' as const;
const ROUTER_ABI = parseAbi(['function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)']);

/** A reader that answers the quoter the way the real one does: tokens out for a given path and amount. */
function quoter(rule: (path: Hex, amountIn: bigint) => bigint | Error): PesoReader & { asked: Array<{ path: Hex; amountIn: bigint }> } {
  const asked: Array<{ path: Hex; amountIn: bigint }> = [];
  return {
    asked,
    async readContract(a) {
      if (a.functionName !== 'quoteExactInput') throw new Error(`unexpected read ${a.functionName}`);
      const [path, amountIn] = a.args as [Hex, bigint];
      asked.push({ path, amountIn });
      const out = rule(path, amountIn);
      if (out instanceof Error) throw out;
      return [out, [], [], 0n];
    },
  };
}

describe('routeFor / encodeRoute', () => {
  test('USDT -> a peso is one hop through the 0.01% pool', () => {
    const r = routeFor('USDT', 'wARS');
    expect(r.tokens).toEqual([ASSETS.USDT.address, ASSETS.wARS.address]);
    expect(r.fees).toEqual([POOL_FEE]);
    expect(POOL_FEE).toBe(100);
  });

  test('USAT -> a peso goes through USDT, because the faucet pays USAT and only USDT has peso pools', () => {
    const r = routeFor('USAT', 'wBRL');
    expect(r.tokens).toEqual([ASSETS.USAT.address, ASSETS.USDT.address, ASSETS.wBRL.address]);
    expect(r.fees).toEqual([POOL_FEE, POOL_FEE]);
  });

  test('the path is token, fee, token, fee, token, packed (20 + 3 + 20 + 3 + 20 bytes)', () => {
    const path = encodeRoute(routeFor('USAT', 'wARS'));
    expect(path).toBe(encodePacked(['address', 'uint24', 'address', 'uint24', 'address'], [ASSETS.USAT.address, 100, ASSETS.USDT.address, 100, ASSETS.wARS.address]));
    expect((path.length - 2) / 2).toBe(66);
  });

  test('only the pesos that have a pool can be funded', () => {
    expect([...FUNDABLE_PESOS]).toEqual(['wARS', 'wBRL']);
  });
});

describe('minOutFor', () => {
  test('is the quote less the slippage, rounded down', () => {
    expect(minOutFor(10_000n, 100)).toBe(9_900n);
    expect(minOutFor(1_001n, 100)).toBe(990n);
    expect(minOutFor(1_630_000_000_000_000_000_000n, 50)).toBe(1_621_850_000_000_000_000_000n);
  });

  test('refuses a slippage that is not a whole number of basis points from 1 to 500', () => {
    for (const bad of [0, -1, 501, 1.5, Number.NaN]) expect(() => minOutFor(10_000n, bad)).toThrow(RangeError);
  });
});

describe('planSwap', () => {
  test('quotes the whole route and floors the output at the slippage', async () => {
    const reader = quoter(() => 163_000_000_000_000_000_000n); // 163 wARS for $0.10
    const plan = await planSwap(reader, { from: 'USAT', to: 'wARS', amountIn: 100_000n, slippageBps: 100 });
    expect(plan.amountIn).toBe(100_000n);
    expect(plan.quotedOut).toBe(163_000_000_000_000_000_000n);
    expect(plan.minOut).toBe(161_370_000_000_000_000_000n);
    expect(plan.path).toBe(encodeRoute(routeFor('USAT', 'wARS')));
    expect(reader.asked).toEqual([{ path: plan.path, amountIn: 100_000n }]);
  });

  test('refuses more than the funding cap in one swap, and nothing that is not a positive whole amount', async () => {
    const reader = quoter(() => 1n);
    const cap = BigInt(Math.round(MAX_FUNDING_USD * 1e6));
    await expect(planSwap(reader, { from: 'USDT', to: 'wARS', amountIn: cap + 1n })).rejects.toThrow(RangeError);
    await expect(planSwap(reader, { from: 'USDT', to: 'wARS', amountIn: 0n })).rejects.toThrow(RangeError);
    expect(reader.asked).toEqual([]);
    await expect(planSwap(reader, { from: 'USDT', to: 'wARS', amountIn: cap })).resolves.toMatchObject({ amountIn: cap });
  });

  test('refuses a quote of nothing: a pool with no depth must not be swapped into', async () => {
    await expect(planSwap(quoter(() => 0n), { from: 'USDT', to: 'wBRL', amountIn: 100_000n })).rejects.toThrow(/no depth|nothing/i);
  });
});

describe('readPesoRates', () => {
  test('is never lower than the fallback: a pool that says the peso is worth less cannot loosen a cap', async () => {
    // 1630 wARS per dollar and 5.0 wBRL per dollar: the market today.
    const reader = quoter((path) => (path.toLowerCase().includes(ASSETS.wARS.address.slice(2).toLowerCase()) ? 1_630n * 10n ** 18n : 5n * 10n ** 18n));
    const { rates, source } = await readPesoRates(reader);
    expect(source).toBe('pools');
    expect(rates.wARS).toBe(FALLBACK_PESO_USD.wARS);
    expect(rates.wBRL).toBe(FALLBACK_PESO_USD.wBRL);
  });

  test('rises with the pool when the peso strengthens past the fallback, with a margin on top', async () => {
    const reader = quoter(() => 500n * 10n ** 18n); // 500 pesos per dollar: dearer than the fallback assumes
    const { rates } = await readPesoRates(reader);
    expect(rates.wARS).toBeCloseTo((1 / 500) * 1.25, 12);
    expect(rates.wARS!).toBeGreaterThan(FALLBACK_PESO_USD.wARS);
  });

  test('a pool that cannot be read falls back, and says so', async () => {
    const { rates, source } = await readPesoRates(quoter(() => new Error('rpc down')));
    expect(source).toBe('fallback');
    expect(rates).toEqual({ wARS: FALLBACK_PESO_USD.wARS, wBRL: FALLBACK_PESO_USD.wBRL });
  });

  test('prices only the pesos that can be obtained: a peso with no pool stays unpriced and is therefore never paid', async () => {
    const { rates } = await readPesoRates(quoter(() => 1n));
    expect(Object.keys(rates).sort()).toEqual(['wARS', 'wBRL']);
  });

  test('the fallback overstates what a peso is worth, which is the safe direction for a spending cap', () => {
    expect(FALLBACK_PESO_USD.wARS).toBeGreaterThan(1 / 1630);
    expect(FALLBACK_PESO_USD.wBRL).toBeGreaterThan(1 / 5.0);
  });
});

describe('executeSwap', () => {
  interface Sent {
    to: string;
    data: Hex;
    feeCurrency?: string;
  }
  function wallet(allowance: bigint, reverts: 'none' | 'approve' | 'swap' = 'none') {
    const sent: Sent[] = [];
    const reads: string[] = [];
    const c = {
      account: { address: OWNER },
      attributionCode: 'celo_29928c447ace',
      publicClient: {
        readContract: async (a: { functionName: string }) => {
          reads.push(a.functionName);
          return allowance;
        },
        waitForTransactionReceipt: async ({ hash }: { hash: string }) => ({ status: (hash === '0x01' && reverts === 'approve') || (hash.endsWith('02') && reverts === 'swap') ? 'reverted' : 'success' }),
      },
      walletClient: {
        sendTransaction: async (tx: Sent) => {
          sent.push(tx);
          return `0x0${sent.length}` as Hex;
        },
      },
    } as unknown as Clients;
    return { c, sent, reads };
  }
  const plan = { route: routeFor('USAT', 'wARS'), path: encodeRoute(routeFor('USAT', 'wARS')), amountIn: 250_000n, quotedOut: 400n * 10n ** 18n, minOut: 396n * 10n ** 18n };

  test('approves exactly the amount, then swaps to the wallet itself, both tagged and both paying gas in the fee adapter', async () => {
    const { c, sent } = wallet(0n);
    const done = await executeSwap(c, plan, { from: 'USAT', fee: 'USAT' });

    expect(sent).toHaveLength(2);
    expect(sent[0]!.to).toBe(ASSETS.USAT.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[0]!.data })).toEqual({ functionName: 'approve', args: [UNISWAP_V3.swapRouter, 250_000n] });
    expect(sent[1]!.to).toBe(UNISWAP_V3.swapRouter);
    expect(decodeFunctionData({ abi: ROUTER_ABI, data: sent[1]!.data })).toEqual({
      functionName: 'exactInput',
      args: [{ path: plan.path, recipient: OWNER, amountIn: 250_000n, amountOutMinimum: 396n * 10n ** 18n }],
    });
    for (const tx of sent) expect(tx.feeCurrency).toBe(ASSETS.USAT.feeAdapter);
    expect(done).toEqual({ approveHash: '0x01', swapHash: '0x02' });
  });

  test('skips the approval when the router already may spend enough', async () => {
    const { c, sent } = wallet(250_000n);
    const done = await executeSwap(c, plan, { from: 'USAT', fee: 'USDT' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(UNISWAP_V3.swapRouter);
    expect(sent[0]!.feeCurrency?.toLowerCase()).toBe(ASSETS.USDT.feeAdapter!.toLowerCase());
    expect(done.approveHash).toBeNull();
  });

  test('a reverted approval stops before the swap, and a reverted swap is an error, never a success', async () => {
    const a = wallet(0n, 'approve');
    await expect(executeSwap(a.c, plan, { from: 'USAT', fee: 'USAT' })).rejects.toThrow(/approval.*reverted/i);
    expect(a.sent).toHaveLength(1);

    const b = wallet(0n, 'swap');
    await expect(executeSwap(b.c, plan, { from: 'USAT', fee: 'USAT' })).rejects.toThrow(/swap.*reverted/i);
  });

  test('refuses to send a swap that is not tagged', async () => {
    const { c } = wallet(0n);
    (c as { attributionCode: string }).attributionCode = '';
    // The walletClient stub would happily send; sendTagged is what refuses.
    await expect(executeSwap(c, plan, { from: 'USAT', fee: 'USAT' })).rejects.toThrow(/untagged|attribution/i);
  });
});
