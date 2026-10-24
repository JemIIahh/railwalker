import { AttributionMismatchError, ConfigError } from '@railwalker/chain';
import { parseArgs } from './args';
import { balance } from './commands/balance';
import { checkCommand } from './commands/check';
import { doctor } from './commands/doctor';
import { fundPesosCommand } from './commands/fund-pesos';
import { registerCommand } from './commands/register';
import { runBatchCommand } from './commands/run-batch';
import { scanCommand } from './commands/scan';
import { walletNew } from './commands/wallet-new';
import { Refusal, UsageError } from './errors';
import type { CliDeps, Ctx } from './types';

const USAGE = `railwalker: a mystery shopper for Celo x402 sellers

Usage: railwalker <command> [options]

Commands:
  scan <url> [--method GET|POST] [--body '<json>']
        Free. Scans one endpoint and prints the report as JSON. Never pays.
  check <url> --assets USAT,USDC --stage buy|fixture|customer|unsolicited [--yes]
        [--body '<json>'] [--record <dir>] [--fee-paid <usd>] [--deliveries 1|2|3]
        Shows what it would pay and what the policy refuses. Pays only with --yes.
  register [--sepolia|--mainnet] [--yes] [--fee USAT|USDC|USDT] [--web <url>] [--mcp <url>] [--image <uri>]
        Registers the agent's ERC-8004 identity. Permanent, so it needs --yes.
  run-batch --data <dir> [--dry-run] [--max-paid <n>] [--budget-sec <n>] [--fixtures <https url>]
        One scheduled run: scans everything for free, pays up to --max-paid targets (default 3) in turn, and writes the saved
        state, a summary and the public run records to <dir>. Nothing it writes or prints names a seller nobody asked about.
        --dry-run says what it would pay and writes nothing. RAILWALKER_FIXTURES_URL names our deployed fixtures.
  fund-pesos --to wARS|wBRL --usd <amount, at most 0.5> [--from USAT|USDT] [--fee USAT|USDC|USDT] [--yes]
        Buys pesos on Uniswap with a few cents of dollars (USAT goes through USDT). Quotes and sends nothing without --yes;
        with it, two tagged transactions: an exact approval, then the swap.
  wallet:new   Creates the agent wallet key in .env and prints the address only.
  doctor       Checks the configuration, the attribution code and the balance.
  balance      Shows the agent wallet's balances.
  help         This text.

Exit codes: 0 ok, 1 failed, 2 usage error, 3 refused by a safety rule (nothing was sent or paid).
`;

/** Environment variables whose values must never appear in anything printed. */
const SECRET_ENV = ['AGENT_PRIVATE_KEY', 'X402_API_KEY', 'SELLER_SALT', 'CELO_RPC_URL'];
/** Shorter values would blank out ordinary words. */
const MIN_SECRET_LENGTH = 8;

/**
 * Runs one command line and returns its exit code. Everything printed passes through a redactor that knows every secret the
 * environment holds (and any key generated during the run), so a bug, an error message or a report cannot leak one.
 */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const secrets = new Set<string>();
  const addSecret = (secret: string) => {
    if (secret.length < MIN_SECRET_LENGTH) return;
    secrets.add(secret);
    if (secret.startsWith('0x')) secrets.add(secret.slice(2));
  };
  for (const name of SECRET_ENV) addSecret(deps.env[name] ?? '');

  const redact = (text: string) => [...secrets].sort((a, b) => b.length - a.length).reduce((t, s) => t.split(s).join('[redacted]'), text);
  const ctx: Ctx = { deps, out: (t) => deps.stdout(redact(t)), err: (t) => deps.stderr(redact(t)), addSecret };

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    ctx.err(`railwalker: ${parsed.error}\nTry: railwalker help\n`);
    return 2;
  }
  if (parsed.command === 'help') {
    ctx.out(USAGE);
    return 0;
  }

  try {
    switch (parsed.command) {
      case 'wallet:new':
        return await walletNew(ctx, parsed);
      case 'doctor':
        return await doctor(ctx, parsed);
      case 'balance':
        return await balance(ctx, parsed);
      case 'scan':
        return await scanCommand(ctx, parsed);
      case 'check':
        return await checkCommand(ctx, parsed);
      case 'register':
        return await registerCommand(ctx, parsed);
      case 'fund-pesos':
        return await fundPesosCommand(ctx, parsed);
      case 'run-batch':
        return await runBatchCommand(ctx, parsed);
      default:
        ctx.err(`railwalker: unknown command "${parsed.command}"\nTry: railwalker help\n`);
        return 2;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UsageError) {
      ctx.err(`railwalker: ${message}\n`);
      return 2;
    }
    ctx.err(`railwalker: ${message}\n`);
    return err instanceof Refusal || err instanceof ConfigError || err instanceof AttributionMismatchError ? 3 : 1;
  }
}
