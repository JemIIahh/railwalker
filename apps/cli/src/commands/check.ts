import { resolve } from 'node:path';
import { ASSETS, CELO_MAINNET, DEFAULT_POLICY, STAGES, classifyReadStyle, decidePay, toUsd, type AssetSymbol, type EndpointFacts, type Stage } from '@railwalker/core';
import { sellerKeyFor } from '@railwalker/data';
import type { ConfirmOptions } from '@railwalker/scanner';
import type { Parsed } from '../args';
import { Refusal, UsageError } from '../errors';
import { findingLines, usd, verdictLines } from '../format';
import { loadSpend, saveSpend } from '../spend-file';
import type { Ctx } from '../types';
import { stablecoinUsd } from './doctor';
import { parseBody } from './scan';

/** How each stage's seller is classified for the read-style and policy rules. */
const SOURCE: Record<Stage, EndpointFacts['source']> = { buy: 'buy', fixture: 'fixture', customer: 'visitor', unsolicited: 'erc8004' };

function parseAssets(raw: string | true | undefined): AssetSymbol[] {
  if (raw === undefined) throw new UsageError('--assets is required (for example --assets USAT,USDC)');
  const names = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new UsageError('--assets needs at least one asset (for example --assets USAT,USDC)');
  for (const n of names) if (!(n in ASSETS)) throw new UsageError(`unknown asset "${n}": choose from ${Object.keys(ASSETS).join(', ')}`);
  return [...new Set(names)] as AssetSymbol[];
}

function parseStage(raw: string | true | undefined): Stage {
  if (raw === undefined) throw new UsageError(`--stage is required (${STAGES.join(', ')})`);
  if (!(STAGES as readonly string[]).includes(raw as string)) throw new UsageError(`unknown stage "${raw}": choose from ${STAGES.join(', ')}`);
  return raw as Stage;
}

function parseFeePaid(raw: string | true | undefined, stage: Stage): number | undefined {
  if (raw === undefined) {
    if (stage === 'customer') throw new UsageError('--fee-paid is required for the customer stage (the USD amount the customer paid)');
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError('--fee-paid must be a positive number of USD');
  return n;
}

function parseDeliveries(raw: string | true | undefined): number {
  if (raw === undefined) return 1;
  if (!/^[123]$/.test(String(raw))) throw new UsageError('--deliveries must be 1, 2 or 3');
  return Number(raw);
}

type PlanRow = { symbol: AssetSymbol; state: 'pay'; priceUsd: number } | { symbol: AssetSymbol; state: 'refused'; priceUsd: number | null; reason: string } | { symbol: AssetSymbol; state: 'absent' };

/**
 * Scans for free, shows what would be paid and what the policy refuses, and only with --yes pays. Every payment goes through the
 * shared spend ledger, whose state is saved between runs. The policy is checked here too, before any wallet call, so a refusal
 * costs nothing and says why.
 */
export async function checkCommand(ctx: Ctx, args: Parsed & { ok: true }): Promise<number> {
  const url = args.positionals[0]!;
  const assets = parseAssets(args.flags.assets);
  const stage = parseStage(args.flags.stage);
  const body = parseBody(args.flags.body);
  const method = body === undefined ? 'GET' : 'POST';
  const feePaidUsd = parseFeePaid(args.flags['fee-paid'], stage);
  const deliveries = parseDeliveries(args.flags.deliveries);
  const yes = args.flags.yes === true;
  const record = typeof args.flags.record === 'string' ? args.flags.record : undefined;

  const cfg = ctx.deps.loadConfig();
  if (cfg.network !== 'mainnet') throw new Refusal('check pays on Celo mainnet only: set RAILWALKER_NETWORK=mainnet');

  const report = await ctx.deps.scan({ url, method, ...(body === undefined ? {} : { body }) });
  const challenge = report.challenge;
  if (!challenge) {
    ctx.out(`${JSON.stringify(report, null, 2)}\n`);
    ctx.err(verdictLines(report.verdicts));
    if (report.verdicts.some((v) => v.kind === 'SKIPPED')) throw new Refusal('nothing can be paid: the scan was refused by a safety rule');
    ctx.err('Nothing to pay: the endpoint did not answer with an x402 challenge.\n');
    return 0;
  }

  const spend = await loadSpend(ctx);
  let balanceUsd: number;
  try {
    balanceUsd = stablecoinUsd(await ctx.deps.readBalances(cfg));
  } catch (err) {
    throw new Error(`could not read the wallet balance (${err instanceof Error ? err.message : String(err)}): refusing to pay without knowing it`);
  }

  const facts: EndpointFacts = { url, method, description: challenge.resource.description, source: SOURCE[stage] };
  const { readStyle } = classifyReadStyle(facts);
  const sellerKey = sellerKeyFor(stage, new URL(url).hostname, cfg.sellerSalt); // a salted hash for anyone we do not publish by name
  let spentOnThisCheckUsd = 0;
  const plan: PlanRow[] = assets.map((symbol): PlanRow => {
    const accept = challenge.accepts.find((a) => a.chainId === CELO_MAINNET && a.assetInfo?.symbol === symbol);
    if (!accept) return { symbol, state: 'absent' };
    const priceUsd = toUsd(symbol, accept.amountAtomic);
    const decision = decidePay(DEFAULT_POLICY, spend, { stage, sellerKey, priceUsd, readStyle, optedOut: false, balanceUsd, now: ctx.deps.now(), feePaidUsd, spentOnThisCheckUsd });
    if (!decision.allow) return { symbol, state: 'refused', priceUsd, reason: decision.reason };
    spentOnThisCheckUsd += priceUsd ?? 0;
    return { symbol, state: 'pay', priceUsd: priceUsd ?? 0 };
  });

  ctx.err(
    `check ${url}  (stage ${stage}, wallet ${usd(balanceUsd)})\n` +
      plan
        .map((p) => {
          if (p.state === 'pay') return `  ${p.symbol.padEnd(7)}${usd(p.priceUsd).padEnd(11)}would pay${deliveries > 1 ? ` x${deliveries} deliveries` : ''}\n`;
          if (p.state === 'refused') return `  ${p.symbol.padEnd(7)}${(p.priceUsd === null ? 'unpriced' : usd(p.priceUsd)).padEnd(11)}refused: ${p.reason}\n`;
          return `  ${p.symbol.padEnd(7)}${'-'.padEnd(11)}not offered on Celo mainnet\n`;
        })
        .join(''),
  );

  if (!plan.some((p) => p.state === 'pay')) {
    if (plan.some((p) => p.state === 'refused')) throw new Refusal('every requested asset was refused by a safety rule: nothing will be paid');
    throw new Error('nothing to pay: none of the requested assets is offered on Celo mainnet');
  }
  if (!yes) {
    ctx.err('Nothing was paid. Re-run with --yes to pay.\n');
    return 2;
  }

  const opts: ConfirmOptions = {
    stage,
    assets,
    facts,
    optedOut: false,
    ...(feePaidUsd === undefined ? {} : { feePaidUsd }),
    ...(body === undefined ? {} : { body }),
    ...(deliveries > 1 ? { deliveries } : {}),
  };
  const result = await ctx.deps.confirm(cfg, report, opts, spend);
  await saveSpend(ctx, result.spend); // first: what was spent must be remembered even if printing fails

  if (record !== undefined) {
    const dir = resolve(ctx.deps.cwd, record);
    await ctx.deps.fs.mkdir(dir);
    await ctx.deps.fs.writeFile(resolve(dir, `${result.run.id}.run.json`), `${JSON.stringify(result.run, null, 2)}\n`);
    await ctx.deps.fs.writeFile(resolve(dir, `${result.report.id}.report.json`), `${JSON.stringify(result.report, null, 2)}\n`);
  }

  ctx.out(`${JSON.stringify(result.report, null, 2)}\n`);
  ctx.err(verdictLines(result.report.verdicts) + findingLines(result.report.findings));

  const asked = result.report.verdicts.filter((v) => v.assetSymbol !== undefined && assets.includes(v.assetSymbol));
  if (asked.length > 0 && asked.every((v) => v.kind === 'SKIPPED')) throw new Refusal('every requested asset was skipped by a safety rule: nothing was paid');
  return 0;
}
