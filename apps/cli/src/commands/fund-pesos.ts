import { FUNDABLE_PESOS, MAX_FUNDING_USD, feeCurrencyFor, type FeeSymbol, type FundablePeso, type FundingCoin } from '@railwalker/chain';
import { DEFAULT_POLICY, assetByAddress } from '@railwalker/core';
import type { Parsed } from '../args';
import { Refusal, UsageError } from '../errors';
import { fixed } from '../format';
import type { Ctx } from '../types';
import { stablecoinUsd } from './doctor';

const FROM: FundingCoin[] = ['USAT', 'USDT'];
const FEES: FeeSymbol[] = ['USAT', 'USDC', 'USDT'];
const USD = /^\d+(\.\d{1,6})?$/;

/** A dollar amount as 6-decimal atomic units, without ever going through a float. */
function parseUsd(raw: string | true | undefined): bigint {
  if (typeof raw !== 'string') throw new UsageError('--usd is required: how many dollars of USAT or USDT to spend, for example --usd 0.25');
  if (!USD.test(raw)) throw new UsageError('--usd must be a dollar amount such as 0.25, with at most six decimals');
  const [whole, fraction = ''] = raw.split('.');
  const atomic = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (atomic === 0n) throw new UsageError('--usd must be more than zero');
  if (atomic > BigInt(Math.round(MAX_FUNDING_USD * 1e6))) throw new UsageError(`--usd must be at most $${MAX_FUNDING_USD}: pesos are bought a few cents at a time`);
  return atomic;
}

/**
 * Buys a few cents of pesos with the dollars the wallet holds, on Uniswap. Everything is shown first; nothing is sent without
 * --yes. It never spends the wallet's reserve (which pays the gas), and both transactions it sends carry the attribution tag.
 */
export async function fundPesosCommand(ctx: Ctx, args: Parsed & { ok: true }): Promise<number> {
  const to = args.flags.to as FundablePeso | undefined;
  if (typeof to !== 'string' || !FUNDABLE_PESOS.includes(to)) throw new UsageError('--to must be wARS or wBRL: the only pesos with a pool to buy from');
  const amountIn = parseUsd(args.flags.usd);
  if (args.flags.from !== undefined && !FROM.includes(args.flags.from as FundingCoin)) throw new UsageError('--from must be USAT or USDT');
  if (args.flags.fee !== undefined && !FEES.includes(args.flags.fee as FeeSymbol)) throw new UsageError('--fee must be USAT, USDC or USDT');
  const yes = args.flags.yes === true;

  const cfg = ctx.deps.loadConfig();
  if (cfg.network !== 'mainnet') throw new Refusal('fund-pesos buys on Celo mainnet only: the pesos do not exist anywhere else');
  if (cfg.attributionCode === '') throw new Refusal('no attribution code is configured: a swap cannot be tagged afterwards, so it is refused');

  const b = await ctx.deps.readBalances(cfg);
  const from = (args.flags.from as FundingCoin | undefined) ?? (b.USDT > b.USAT ? 'USDT' : 'USAT');
  const fee = (args.flags.fee as FeeSymbol | undefined) ?? from;
  const usd = Number(amountIn) / 1e6;

  if (b[from] < amountIn) throw new Refusal(`the wallet holds only ${fixed(b[from], 6)} ${from}, and ${fixed(amountIn, 6)} was asked for`);
  if (b[fee] === 0n) throw new Refusal(`the wallet holds no ${fee} to pay gas with: pass --fee with a coin it holds`);
  if (stablecoinUsd(b) - usd < DEFAULT_POLICY.reserveUsd) {
    throw new Refusal(`the swap would leave the wallet under its $${DEFAULT_POLICY.reserveUsd.toFixed(2)} reserve, which is what pays the gas: spend less or fund the wallet first`);
  }

  const plan = await ctx.deps.planPesos(cfg, { from, to, amountIn });
  const route = plan.route.tokens.map((t) => assetByAddress(t)?.symbol ?? t).join(' > ');
  ctx.err(
    [
      `buy ${to} on ${cfg.network}`,
      `  spend      ${fixed(amountIn, 6)} ${from}`,
      `  expect     ${fixed(plan.quotedOut, 18)} ${to}  (Uniswap v3: ${route})`,
      `  at least   ${fixed(plan.minOut, 18)} ${to}  (the swap fails rather than take less)`,
      `  gas        paid in ${fee} (fee adapter ${feeCurrencyFor(fee)})`,
      `  tag        ${cfg.attributionCode} (ERC-8021, carried by both transactions)`,
      '',
    ].join('\n'),
  );
  if (!yes) {
    ctx.err('Nothing was sent. Re-run with --yes to swap.\n');
    return 2;
  }

  const result = await ctx.deps.fundPesos(cfg, plan, { from, fee });
  const tagged = result.tagged?.includes(cfg.attributionCode) === true;
  ctx.out(
    [
      'Swapped.',
      `  approve  ${result.approveHash ?? 'none needed: the router already had an allowance'}`,
      `  swap     ${result.swapHash}`,
      `  tag      ${tagged ? `${cfg.attributionCode} (verified on the transaction)` : 'NOT VERIFIED'}`,
      `  holds    ${fixed(result.balances[to] ?? 0n, 18)} ${to}, ${fixed(result.balances[from], 6)} ${from}`,
      '',
    ].join('\n'),
  );
  if (!tagged) {
    ctx.err(`The swap is on chain (${result.swapHash}) but the ${cfg.attributionCode} tag could not be verified on it. Check the transaction before relying on it.\n`);
    return 1;
  }
  return 0;
}
