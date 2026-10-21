import { privateKeyToAddress } from 'viem/accounts';
import type { Parsed } from '../args';
import { fixed, usd } from '../format';
import type { Balances, Ctx } from '../types';

type Level = 'ok' | 'info' | 'warn' | 'FAIL';

/** The wallet is the hard spend cap, so it should never hold more than this. */
const FLOAT_CAP_USD = 3;

export const stablecoinUsd = (b: Balances) => Number(b.USDC + b.USDT + b.USAT) / 10 ** 6;

const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Checks what has to be true before anything is sent. Prints one line per check; never a secret, not even where it is only "set". */
export async function doctor(ctx: Ctx, _args: Parsed): Promise<number> {
  const rows: string[] = [];
  let failed = false;
  const row = (level: Level, name: string, text: string) => {
    if (level === 'FAIL') failed = true;
    rows.push(`${level.padEnd(5)} ${name.padEnd(13)} ${text}\n`);
  };
  const finish = () => {
    ctx.out(rows.join(''));
    return failed ? 1 : 0;
  };

  let cfg;
  try {
    cfg = ctx.deps.loadConfig();
  } catch (err) {
    row('FAIL', 'config', describeError(err)); // validator messages are static text: they never echo a value
    return finish();
  }

  row('ok', 'config', `valid (${cfg.network}, chain ${cfg.chainId}), repo ${cfg.repoSlug}`);
  if (cfg.attributionCode) row('ok', 'attribution', `${cfg.attributionCode} matches ${cfg.repoSlug}`);
  else row('warn', 'attribution', 'no code set: Sepolia development may run untagged, but nothing can be sent without one');
  row('info', 'rpc', ctx.deps.env.CELO_RPC_URL ? 'custom endpoint (not shown)' : 'default (forno)');
  row('info', 'x402 api key', cfg.x402ApiKey ? 'set' : 'not set (only needed to meter our own sellers)');
  row('info', 'payee', cfg.payTo);

  const address = privateKeyToAddress(cfg.agentPrivateKey);
  try {
    const b = await ctx.deps.readBalances(cfg);
    const total = stablecoinUsd(b);
    const parts = `USDC ${fixed(b.USDC, 6, 4)}, USDT ${fixed(b.USDT, 6, 4)}, USAT ${fixed(b.USAT, 6, 4)}, CELO ${fixed(b.celo, 18, 4)}`;
    if (total === 0) row('warn', 'wallet', `${address} holds no stablecoins: nothing can be paid (${parts})`);
    else if (total > FLOAT_CAP_USD) row('warn', 'wallet', `${address} holds ${usd(total)}, above the $${FLOAT_CAP_USD} float: the wallet is the hard spend cap, keep it small (${parts})`);
    else row('ok', 'wallet', `${address} holds ${usd(total)} in stablecoins (${parts})`);
  } catch (err) {
    row('FAIL', 'wallet', `${address}: could not read the balance (${describeError(err)})`);
  }

  if (cfg.agentId !== undefined) row('ok', 'identity', `agentId ${cfg.agentId}`);
  else row('info', 'identity', 'not registered yet (railwalker register)');
  return finish();
}

