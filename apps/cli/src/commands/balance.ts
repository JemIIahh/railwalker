import { privateKeyToAddress } from 'viem/accounts';
import type { Parsed } from '../args';
import { fixed, usd } from '../format';
import type { Ctx } from '../types';
import { stablecoinUsd } from './doctor';

export async function balance(ctx: Ctx, _args: Parsed): Promise<number> {
  const cfg = ctx.deps.loadConfig();
  const b = await ctx.deps.readBalances(cfg);
  ctx.out(
    [
      `${privateKeyToAddress(cfg.agentPrivateKey)}  (${cfg.network})`,
      `  USDC  ${fixed(b.USDC, 6)}`,
      `  USDT  ${fixed(b.USDT, 6)}`,
      `  USAT  ${fixed(b.USAT, 6)}`,
      ...(b.wARS === undefined ? [] : [`  wARS  ${fixed(b.wARS, 18)}`]),
      ...(b.wBRL === undefined ? [] : [`  wBRL  ${fixed(b.wBRL, 18)}`]),
      `  CELO  ${fixed(b.celo, 18)}`,
      `stablecoins  ${usd(stablecoinUsd(b))}`,
      '',
    ].join('\n'),
  );
  return 0;
}
