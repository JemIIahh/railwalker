import { resolve } from 'node:path';
import { CELO_MAINNET, DEFAULT_POLICY, SpendLedger, parseSafeUrl, type AssetSymbol, type EndpointFacts } from '@railwalker/core';
import { sellerKeyFor } from '@railwalker/data';
import type { Endpoint } from '@railwalker/discovery';
import type { CheckReport, ConfirmOptions } from '@railwalker/scanner';
import type { Parsed } from '../args';
import { Refusal, UsageError } from '../errors';
import { loadSpendState, runBatch } from '../run-batch';
import type { Balances, Ctx } from '../types';

/** What a scheduled run pays with, most wanted first: the faucet's token, then USDC. USDT is never paid with. */
const PAY_WITH: readonly ('USAT' | 'USDC')[] = ['USAT', 'USDC'];
const SCAN_CONCURRENCY = 8;

/** The asset to pay a seller with: one it offers on Celo mainnet at a whole-number price that the wallet holds enough of. */
export function chooseAsset(report: CheckReport, balances: Balances): AssetSymbol | null {
  for (const symbol of PAY_WITH) {
    const offer = report.challenge?.accepts.find((a) => a.chainId === CELO_MAINNET && a.assetInfo?.symbol === symbol);
    if (!offer || !/^\d+$/.test(offer.amountAtomic)) continue;
    if (balances[symbol] >= BigInt(offer.amountAtomic)) return symbol;
  }
  return null;
}

/** The fixtures that have no payment path are there to be scanned: paying them would only waste a payment slot. */
const isScanOnlyFixture = (e: Endpoint): boolean => e.source === 'fixture' && new URL(e.url).pathname.includes('/bad/');

function parseCount(raw: string | true | undefined, name: string, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new UsageError(`${name} must be a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw new UsageError(`${name} must be between ${min} and ${max}`);
  return n;
}

/**
 * One scheduled run: scans everything for free, then pays a few targets in turn through one spend ledger, and writes what it
 * learned to the data folder. Everything it prints is safe for a public log: it never names a seller nobody asked us to look at.
 */
export async function runBatchCommand(ctx: Ctx, args: Parsed & { ok: true }): Promise<number> {
  const dataDir = args.flags.data;
  if (typeof dataDir !== 'string' || dataDir === '') throw new UsageError('--data <dir> is required: the folder that holds the saved state and the published files');
  const dryRun = args.flags['dry-run'] === true;
  const maxPaid = parseCount(args.flags['max-paid'], '--max-paid', 3, 0, 20);
  const budgetSec = parseCount(args.flags['budget-sec'], '--budget-sec', 600, 10, 3000);
  const fixturesUrl = (typeof args.flags.fixtures === 'string' ? args.flags.fixtures : ctx.deps.env.RAILWALKER_FIXTURES_URL) || undefined;
  if (fixturesUrl !== undefined) {
    try {
      parseSafeUrl(fixturesUrl);
    } catch {
      throw new UsageError('the fixtures URL must be an https URL on a public host');
    }
  }

  const cfg = ctx.deps.loadConfig();
  if (cfg.network !== 'mainnet' && !dryRun) throw new Refusal('run-batch pays on Celo mainnet only: set RAILWALKER_NETWORK=mainnet (or use --dry-run)');

  const store = ctx.deps.openStore(resolve(ctx.deps.cwd, dataDir));
  const ledger = new SpendLedger(DEFAULT_POLICY, await loadSpendState(store)); // refuses, before anything else, a state it cannot trust

  let balances: Balances;
  try {
    balances = await ctx.deps.readBalances(cfg);
  } catch (err) {
    throw new Error(`could not read the wallet balance (${err instanceof Error ? err.message : String(err)}): refusing to run without knowing it`);
  }

  const result = await runBatch({
    store,
    discover: async (cursor) => {
      const found = await ctx.deps.discover(cfg, cursor, fixturesUrl === undefined ? {} : { fixturesUrl });
      for (const problem of found.problems) ctx.err(`run-batch: ${problem}\n`);
      return { endpoints: found.endpoints, cursor: found.cursor };
    },
    scan: (e) =>
      ctx.deps.scan({ url: e.url, method: e.method, ...(e.bodyTemplate === undefined ? {} : { body: e.bodyTemplate }), ...(e.agentWallet === undefined ? {} : { agentWallet: e.agentWallet }) }),
    confirm: async (e, report, stage) => {
      const asset = chooseAsset(report, balances);
      if (asset === null) throw new Error('nothing to pay with'); // payable() has already said yes, so this is a bug
      const facts: EndpointFacts = { url: e.url, method: e.method, description: report.challenge?.resource.description ?? e.description, capabilityId: e.capabilityId, source: e.source };
      const opts: ConfirmOptions = { stage, assets: [asset], facts, optedOut: false, ...(e.bodyTemplate === undefined ? {} : { body: e.bodyTemplate }) };
      return ctx.deps.confirmThrough(cfg, ledger, sellerKeyFor(stage, new URL(e.url).hostname, cfg.sellerSalt), report, opts);
    },
    ledger,
    salt: cfg.sellerSalt,
    now: ctx.deps.now,
    maxPaidPerRun: maxPaid,
    scanConcurrency: SCAN_CONCURRENCY,
    budgetMs: budgetSec * 1000,
    payable: (e, report) => !isScanOnlyFixture(e) && chooseAsset(report, balances) !== null,
    dryRun,
  });

  if (result.plan) {
    ctx.err(`run-batch (dry run): scanned ${result.scanned}, would pay ${result.plan.length}\n${result.plan.map((p) => `  ${p.stage.padEnd(12)}${p.label}\n`).join('')}`);
  } else {
    ctx.err(`run-batch: scanned ${result.scanned}, paid ${result.paid}, failed ${result.failed}, wrote ${result.wrote.length} files\n`);
  }
  ctx.out(`${JSON.stringify(result)}\n`);
  return 0;
}
