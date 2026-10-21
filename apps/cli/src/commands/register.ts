import { buildRegistration, feeCurrencyFor, REGISTRIES, type FeeSymbol, type RegistrationMeta } from '@railwalker/chain';
import { resolve } from 'node:path';
import type { Parsed } from '../args';
import { hasEnvValue, setEnvVar } from '../env-file';
import { Refusal, UsageError } from '../errors';
import type { Ctx } from '../types';
import { stablecoinUsd } from './doctor';

const FEES: FeeSymbol[] = ['USAT', 'USDC', 'USDT'];
const DESCRIPTION = 'Mystery shopper for Celo x402 sellers: scans for free, pays what its policy allows, and reports what breaks with exact patches.';

/**
 * Mints the agent's ERC-8004 identity. It is permanent, so it needs --yes, a named network (mainnet must be said even when the
 * environment already says mainnet), an attribution code, a wallet that can pay for it, and no identity already.
 */
export async function registerCommand(ctx: Ctx, args: Parsed & { ok: true }): Promise<number> {
  const sepolia = args.flags.sepolia === true;
  const mainnet = args.flags.mainnet === true;
  if (sepolia && mainnet) throw new UsageError('pass --sepolia or --mainnet, not both');
  const fee = String(args.flags.fee ?? 'USAT') as FeeSymbol;
  if (!FEES.includes(fee)) throw new UsageError('--fee must be USAT, USDC or USDT');
  const yes = args.flags.yes === true;

  const cfg = ctx.deps.loadConfig(sepolia ? { RAILWALKER_NETWORK: 'sepolia' } : mainnet ? { RAILWALKER_NETWORK: 'mainnet' } : {});
  if (cfg.network === 'mainnet' && !mainnet) throw new UsageError('registering on mainnet is permanent: pass --mainnet explicitly');
  if (cfg.attributionCode === '') throw new Refusal('no attribution code is configured: a registration cannot be tagged afterwards, so it is refused');
  if (cfg.agentId !== undefined) throw new Refusal(`already registered as agent ${cfg.agentId}: a second registration would mint a second identity`);

  const b = await ctx.deps.readBalances(cfg);
  if (b[fee] === 0n) throw new Refusal(`the wallet holds no ${fee} to pay gas with: fund it, or pass --fee with a coin it holds (balance ${stablecoinUsd(b).toFixed(4)} USD in stablecoins)`);

  const meta: RegistrationMeta = {
    name: 'Railwalker',
    description: DESCRIPTION,
    webUrl: typeof args.flags.web === 'string' ? args.flags.web : `https://github.com/${cfg.repoSlug}`,
    ...(typeof args.flags.mcp === 'string' ? { mcpUrl: args.flags.mcp } : {}),
    ...(typeof args.flags.image === 'string' ? { image: args.flags.image } : {}),
  };
  try {
    buildRegistration(meta); // validates what will be written, before anything is sent
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  ctx.err(
    [
      `register on ${cfg.network}`,
      `  registry   ${REGISTRIES[cfg.network].identity}  (ERC-8004 Identity Registry)`,
      `  agent      ${meta.name}`,
      `  services   web ${meta.webUrl}${meta.mcpUrl ? `, MCP ${meta.mcpUrl}` : ''}`,
      `  gas        paid in ${fee} (fee adapter ${feeCurrencyFor(fee)})`,
      `  tag        ${cfg.attributionCode} (ERC-8021, carried by the transaction)`,
      'This mints an ERC-721 agent identity and is permanent.',
      '',
    ].join('\n'),
  );
  if (!yes) {
    ctx.err('Nothing was sent. Re-run with --yes to register.\n');
    return 2;
  }

  const result = await ctx.deps.register(cfg, meta, { fee });

  const envPath = resolve(ctx.deps.cwd, '.env');
  let saved = false;
  if (await ctx.deps.fs.exists(envPath)) {
    const content = await ctx.deps.fs.readFile(envPath);
    if (!hasEnvValue(content, 'RAILWALKER_AGENT_ID')) {
      await ctx.deps.fs.writeFile(envPath, setEnvVar(content, 'RAILWALKER_AGENT_ID', String(result.agentId)));
      saved = true;
    }
  }

  const tagged = result.tagged?.includes(cfg.attributionCode) === true;
  ctx.out(
    [
      'Registered.',
      `  hash     ${result.hash}`,
      `  agentId  ${result.agentId}`,
      `  tag      ${tagged ? `${cfg.attributionCode} (verified on the transaction)` : 'NOT VERIFIED'}`,
      saved ? 'Saved RAILWALKER_AGENT_ID to .env.' : `Add to your environment: RAILWALKER_AGENT_ID=${result.agentId}`,
      '',
    ].join('\n'),
  );
  if (!tagged) {
    ctx.err(`The registration is on chain (${result.hash}) but the ${cfg.attributionCode} tag could not be verified on it. Check the transaction before relying on it.\n`);
    return 1;
  }
  return 0;
}
