import { resolve } from 'node:path';
import { privateKeyToAddress } from 'viem/accounts';
import type { Parsed } from '../args';
import { hasEnvValue, setEnvVar } from '../env-file';
import { Refusal } from '../errors';
import type { Ctx } from '../types';

/**
 * Creates the agent wallet: a fresh private key, written to `.env` (mode 0600) and nowhere else. Only the address is ever printed.
 * It never replaces a wallet, because a replaced key is a lost wallet.
 */
export async function walletNew(ctx: Ctx, _args: Parsed): Promise<number> {
  const { deps } = ctx;
  if ((deps.env.AGENT_PRIVATE_KEY ?? '') !== '') {
    throw new Refusal('AGENT_PRIVATE_KEY is already set in the environment: this command never replaces a wallet');
  }

  const path = resolve(deps.cwd, '.env');
  const existing = (await deps.fs.exists(path)) ? await deps.fs.readFile(path) : '';
  if (hasEnvValue(existing, 'AGENT_PRIVATE_KEY')) {
    throw new Refusal('.env already holds an AGENT_PRIVATE_KEY: this command never overwrites a key');
  }

  const key = deps.generateKey();
  ctx.addSecret(key); // from here on it is redacted from everything that is printed, whatever goes wrong
  try {
    await deps.fs.writeFile(path, setEnvVar(existing, 'AGENT_PRIVATE_KEY', key), { mode: 0o600 });
  } catch (err) {
    // An fs error can quote what it was writing: say only what kind of failure it was.
    throw new Error(`could not write .env (${(err as { code?: string }).code ?? 'write failed'})`);
  }

  ctx.out(
    [
      'Agent wallet created.',
      `Address: ${privateKeyToAddress(key)}`,
      'The private key is in .env (mode 0600). Never commit it, and never paste it into a chat, a prompt or an issue.',
      '',
    ].join('\n'),
  );
  return 0;
}
