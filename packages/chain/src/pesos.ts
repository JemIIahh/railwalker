import { ASSETS, type AssetSymbol } from '@railwalker/core';
import { encodeFunctionData, encodePacked, erc20Abi, parseAbi, type Hex } from 'viem';
import { sendTagged, type Clients, type FeeSymbol } from './wallet';

type Hash = `0x${string}`;

/** Uniswap v3 on Celo mainnet (docs.uniswap.org, Celo deployments). The router is SwapRouter02. */
export const UNISWAP_V3 = {
  swapRouter: '0x5615CDAb10dc425a742d643d949a7F474C01abc4',
  quoter: '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8',
} as const;

/** The 0.01% pools hold the depth: wARS/USDT, wBRL/USDT and USAT/USDT. The other tiers hold none, or no pool. */
export const POOL_FEE = 100;

/** Only these two pesos have a pool to buy from. wMXN, wCOP, wPEN and wCLP can only come from Ripio's ramp. */
export const FUNDABLE_PESOS = ['wARS', 'wBRL'] as const;
export type FundablePeso = (typeof FUNDABLE_PESOS)[number];

/** What the wallet can spend to buy pesos: the faucet pays USAT, and every peso pool is against USDT. */
export type FundingCoin = 'USAT' | 'USDT';

/** The most one funding swap may spend, in dollars. Pesos are bought a few cents at a time. */
export const MAX_FUNDING_USD = 0.5;
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 500;

export interface Route {
  tokens: Hash[];
  fees: number[];
}

export function routeFor(from: FundingCoin, to: FundablePeso): Route {
  const peso = ASSETS[to].address;
  const usdt = ASSETS.USDT.address;
  const tokens = from === 'USDT' ? [usdt, peso] : [ASSETS.USAT.address, usdt, peso];
  return { tokens, fees: tokens.slice(1).map(() => POOL_FEE) };
}

/** Uniswap v3's path encoding: token, fee, token, fee, token, packed with no padding. */
export function encodeRoute(route: Route): Hex {
  const types: Array<'address' | 'uint24'> = [];
  const values: Array<Hash | number> = [];
  route.tokens.forEach((token, i) => {
    if (i > 0) {
      types.push('uint24');
      values.push(route.fees[i - 1]!);
    }
    types.push('address');
    values.push(token);
  });
  return encodePacked(types, values);
}

/** The least a swap may return: the quote less the slippage, rounded down. */
export function minOutFor(quoted: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new RangeError(`slippage must be a whole number of basis points from 1 to ${MAX_SLIPPAGE_BPS}`);
  }
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}

// QuoterV2 is not declared `view` (it reverts to return), but an eth_call returns its answer. Declaring it view lets a plain read reach it.
const quoterAbi = parseAbi(['function quoteExactInput(bytes path, uint256 amountIn) view returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)']);
const routerAbi = parseAbi(['function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)']);

/** All a quote needs from the chain: reads. Any viem public client fits. */
export interface PesoReader {
  readContract(args: { address: Hash; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

async function quote(reader: PesoReader, path: Hex, amountIn: bigint): Promise<bigint> {
  const result = (await reader.readContract({ address: UNISWAP_V3.quoter, abi: quoterAbi, functionName: 'quoteExactInput', args: [path, amountIn] })) as readonly [bigint, ...unknown[]];
  return result[0];
}

export interface SwapPlan {
  route: Route;
  path: Hex;
  amountIn: bigint;
  quotedOut: bigint;
  minOut: bigint;
}

/** Quotes the whole route. Nothing is sent. */
export async function planSwap(reader: PesoReader, a: { from: FundingCoin; to: FundablePeso; amountIn: bigint; slippageBps?: number }): Promise<SwapPlan> {
  const cap = BigInt(Math.round(MAX_FUNDING_USD * 1e6));
  if (a.amountIn <= 0n) throw new RangeError('the amount to swap must be positive');
  if (a.amountIn > cap) throw new RangeError(`one swap may spend at most $${MAX_FUNDING_USD}: pesos are bought a few cents at a time`);
  const route = routeFor(a.from, a.to);
  const path = encodeRoute(route);
  const quotedOut = await quote(reader, path, a.amountIn);
  if (quotedOut <= 0n) throw new Error(`the ${a.to} pool quotes nothing for this amount: it has no depth, so nothing was swapped`);
  return { route, path, amountIn: a.amountIn, quotedOut, minOut: minOutFor(quotedOut, a.slippageBps ?? DEFAULT_SLIPPAGE_BPS) };
}

/**
 * Approves exactly the amount and swaps it to the wallet itself. Both transactions go through sendTagged, so both carry the
 * ERC-8021 tag, and both pay their gas in the fee adapter of `fee` (in CELO when none is given). A revert is an error: it is never reported as funded.
 */
export async function executeSwap(c: Clients, plan: SwapPlan, a: { from: FundingCoin; fee?: FeeSymbol }): Promise<{ approveHash: Hash | null; swapHash: Hash }> {
  const token = ASSETS[a.from].address;
  const allowed = (await c.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [c.account.address, UNISWAP_V3.swapRouter] })) as bigint;

  let approveHash: Hash | null = null;
  if (allowed < plan.amountIn) {
    approveHash = await sendTagged(c, {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [UNISWAP_V3.swapRouter, plan.amountIn] }),
      fee: a.fee,
    });
    const approved = await c.publicClient.waitForTransactionReceipt({ hash: approveHash });
    if (approved.status !== 'success') throw new Error(`the approval ${approveHash} reverted: nothing was swapped`);
  }

  const swapHash = await sendTagged(c, {
    to: UNISWAP_V3.swapRouter,
    data: encodeFunctionData({ abi: routerAbi, functionName: 'exactInput', args: [{ path: plan.path, recipient: c.account.address, amountIn: plan.amountIn, amountOutMinimum: plan.minOut }] }),
    fee: a.fee,
  });
  const swapped = await c.publicClient.waitForTransactionReceipt({ hash: swapHash });
  if (swapped.status !== 'success') throw new Error(`the swap ${swapHash} reverted`);
  return { approveHash, swapHash };
}

/**
 * Dollars per one whole peso token that a spending cap may rely on. Each is well above what the peso is worth today, so a cap in
 * dollars is never looser than it looks. readPesoRates raises it when the pools say the peso has strengthened past it.
 */
export const FALLBACK_PESO_USD: Record<FundablePeso, number> = { wARS: 1 / 1100, wBRL: 1 / 3.4 };
/** Added on top of a pool's price, because a spot quote can be moved by one trade. */
const RATE_MARGIN = 1.25;

export type PesoRates = Partial<Record<AssetSymbol, number>>;

/**
 * What the pesos that can be bought are worth in dollars, for the pay policy's caps. The larger of the fallback and the pools'
 * price plus a margin: a quote that makes a peso look cheap can never loosen a cap. A pool that cannot be read leaves the fallback.
 * A peso with no pool gets no rate here, so it stays unpriced and is never paid.
 */
export async function readPesoRates(reader: PesoReader): Promise<{ rates: PesoRates; source: 'pools' | 'fallback' }> {
  const rates: PesoRates = {};
  let allRead = true;
  for (const peso of FUNDABLE_PESOS) {
    let rate = FALLBACK_PESO_USD[peso];
    try {
      const out = await quote(reader, encodeRoute(routeFor('USDT', peso)), 1_000_000n);
      if (out <= 0n) throw new Error('no depth');
      rate = Math.max(rate, (1 / (Number(out) / 1e18)) * RATE_MARGIN);
    } catch {
      allRead = false;
    }
    rates[peso] = rate;
  }
  return { rates, source: allRead ? 'pools' : 'fallback' };
}
