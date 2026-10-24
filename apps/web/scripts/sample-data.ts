/**
 * SAMPLE data for looking at the site before there is any real data. Never published, never mistaken for the real thing: it goes in a
 * git-ignored folder, every URL is on a reserved `.example` host, the transaction hashes are made up, and the site shows a banner on
 * every page while it is reading from here (RAILWALKER_SAMPLE=1).
 *
 * The reports and run records are produced by the real scanner and the real paid-check code against stand-ins for the network, so a
 * sample replay reads like a real one. Only the money and the chain are pretend.
 *
 *   pnpm --filter @railwalker/web sample-data        (writes apps/web/.sample-data)
 */
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PayOutcome } from '@railwalker/chain';
import { ASSETS, DEFAULT_POLICY, SpendLedger, emptySpendState, type AssetSymbol, type Stage } from '@railwalker/core';
import { LedgerFileSchema, MapFileSchema, RunRecordSchema, ScanSummarySchema, buildLedger, mapCells, summarize } from '@railwalker/data';
import { confirmEndpoint, scanEndpoint, type CheckReport, type ConfirmDeps, type RunRecord } from '@railwalker/scanner';
import { buyV1Challenge, fakeFetch } from '@railwalker/testkit';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.sample-data');
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const HACKATHON_START = '2026-10-06T00:00:00.000Z';
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tx = (s: string): `0x${string}` => `0x${sha(`sample tx ${s}`)}`;
const address = (hex: string): `0x${string}` => `0x${hex.repeat(20)}`;
const AGENT = address('a9');
const FIXTURE_PAY_TO = address('5e');
const BUY_PAY_TO = address('b7');
const ZERO = address('00');

const FIXTURES = 'https://railwalker-sample.example/api/fixtures';
const BUY = 'https://gateway.sample.example/v1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

// ---- what sellers offer ------------------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const accept = (symbol: AssetSymbol, over: Raw = {}, payTo: string = FIXTURE_PAY_TO): Raw => ({
  scheme: 'exact',
  network: 'eip155:42220',
  amount: ASSETS[symbol].decimals === 6 ? '5000' : '5000000000000000',
  asset: ASSETS[symbol].address,
  payTo,
  maxTimeoutSeconds: 300,
  extra: { name: ASSETS[symbol].eip712Name, version: ASSETS[symbol].eip712Version, ...(ASSETS[symbol].method === 'permit2' ? { assetTransferMethod: 'permit2' } : {}) },
  ...over,
});
const challenge = (url: string, ...accepts: Raw[]) => ({ x402Version: 2, resource: { url, mimeType: 'application/json' }, accepts });
const good = (url: string, payTo: string = FIXTURE_PAY_TO) => challenge(url, accept('USDC', {}, payTo), accept('USDT', {}, payTo), accept('USAT', {}, payTo));

type Wire = { status?: number; challenge?: unknown; v1?: boolean; headers?: Record<string, string>; body?: string };
function respond(w: Wire): Response {
  if (w.challenge === undefined) return new Response(w.body ?? '<html>not a payment endpoint</html>', { status: w.status ?? 200, headers: { 'content-type': 'text/html' } });
  if (w.v1) return new Response(JSON.stringify(w.challenge), { status: 402, headers: { 'content-type': 'application/json', ...(w.headers ?? CORS) } });
  return new Response('{}', { status: 402, headers: { 'payment-required': b64(w.challenge), ...(w.headers ?? CORS) } });
}

async function scan(url: string, wire: Wire, method: 'GET' | 'POST' = 'GET'): Promise<CheckReport> {
  return scanEndpoint(
    { fetchImpl: fakeFetch({ [new URL(url).href]: () => respond(wire) }), resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => NOW, userAgent: 'railwalker-sample' },
    { url, method },
  );
}

// ---- the paid check, against a pretend network -------------------------------------------------------------------------------

const settled = (key: string, body: string, latencyMs: number, status = 200): PayOutcome => ({
  paid: true,
  status,
  headers: { 'content-type': 'application/json' },
  bodyText: body,
  truncated: false,
  settlement: { txHash: tx(key), payer: AGENT, network: 'eip155:42220' },
  latencyMs,
});

async function confirm(stage: Stage, report: CheckReport, startedAt: Date, assets: AssetSymbol[], outcome: PayOutcome | null, key: string): Promise<{ report: CheckReport; run: RunRecord }> {
  let ms = startedAt.getTime();
  const deps: ConfirmDeps = {
    pay: async () => {
      ms += outcome?.latencyMs ?? 0;
      return outcome!;
    },
    verifyTransfer: async () => ({ ok: true }),
    ledger: new SpendLedger(DEFAULT_POLICY, emptySpendState()),
    payer: AGENT,
    sellerKey: new URL(report.endpoint.url).hostname,
    balanceUsd: async () => 1.42,
    now: () => new Date((ms += 140 + (sha(`${key}${ms}`).charCodeAt(0) % 160))),
  };
  return confirmEndpoint(deps, report, { stage, assets, facts: { url: report.endpoint.url, method: report.endpoint.method, source: stage === 'buy' ? 'buy' : 'fixture' }, optedOut: false });
}

// ---- our own endpoints -------------------------------------------------------------------------------------------------------

interface Ours {
  stage: 'fixture' | 'buy';
  url: string;
  method?: 'GET' | 'POST';
  wire: Wire;
  /** Minutes since this endpoint was last tried. */
  ago: number;
  /** Absent: a free scan only. */
  pay?: PayOutcome;
}

const ok = (u: string) => `${FIXTURES}/${u}`;
const OK_BODY = '{"ok":true}';
const buyRoute = (p: string) => `${BUY}/${p}`;
const v1 = (p: string) => ({ challenge: { ...(buyV1Challenge as object), resource: buyRoute(p) }, v1: true });
const OURS: Ours[] = [
  { stage: 'fixture', url: ok('ok'), wire: { challenge: good(ok('ok')) }, ago: 6, pay: settled('ok', OK_BODY, 8_900) },
  { stage: 'fixture', url: ok('paid/slow'), wire: { challenge: good(ok('paid/slow')) }, ago: 66, pay: settled('slow', OK_BODY, 29_300) },
  { stage: 'fixture', url: ok('paid/empty'), wire: { challenge: good(ok('paid/empty')) }, ago: 126, pay: settled('empty', '', 9_300) },
  { stage: 'fixture', url: ok('paid/bad-json'), wire: { challenge: good(ok('paid/bad-json')) }, ago: 186, pay: settled('bad-json', '{"ok":', 9_100) },
  { stage: 'fixture', url: ok('paid/500'), wire: { challenge: good(ok('paid/500')) }, ago: 246, pay: settled('500', '{"error":"internal error"}', 9_600, 500) },
  { stage: 'fixture', url: ok('bad/decimals'), wire: { challenge: challenge(ok('bad/decimals'), accept('USDC', { amount: '5000000000000000' })) }, ago: 306 },
  { stage: 'fixture', url: ok('bad/domain-name'), wire: { challenge: challenge(ok('bad/domain-name'), accept('USDC', { extra: { name: 'USD Coin', version: ASSETS.USDC.eip712Version } })) }, ago: 312 },
  { stage: 'fixture', url: ok('bad/adapter-asset'), wire: { challenge: challenge(ok('bad/adapter-asset'), accept('USDC', { asset: ASSETS.USDC.feeAdapter })) }, ago: 318 },
  { stage: 'fixture', url: ok('bad/payto-zero'), wire: { challenge: challenge(ok('bad/payto-zero'), accept('USDC', {}, ZERO)) }, ago: 324 },
  { stage: 'fixture', url: ok('bad/permit2-method'), wire: { challenge: challenge(ok('bad/permit2-method'), accept('wARS', { extra: { name: ASSETS.wARS.eip712Name, version: ASSETS.wARS.eip712Version } })) }, ago: 330 },
  { stage: 'fixture', url: ok('bad/no-cors'), wire: { challenge: good(ok('bad/no-cors')), headers: {} }, ago: 336 },
  { stage: 'buy', url: buyRoute('social/x/posts/search'), method: 'POST', wire: v1('social/x/posts/search'), ago: 36, pay: settled('buy-x-search', '{"posts":[{"id":"1"}]}', 11_800) },
  { stage: 'buy', url: buyRoute('browser/sessions'), method: 'POST', wire: v1('browser/sessions'), ago: 96, pay: settled('buy-browser', '{"session":"s_1"}', 12_700) },
  { stage: 'buy', url: buyRoute('social/instagram/tools/apify-apify-instagram-hashtag-scraper'), method: 'POST', wire: v1('social/instagram/tools/apify-apify-instagram-hashtag-scraper'), ago: 156, pay: settled('buy-insta', '{"items":[]}', 16_900) },
  { stage: 'buy', url: buyRoute('social/x/tools/apify-apidojo-tweet-scraper'), method: 'POST', wire: v1('social/x/tools/apify-apidojo-tweet-scraper'), ago: 216, pay: settled('buy-tweets', '{"items":[{"id":"7"}]}', 10_200) },
];

// ---- everyone else: counts only ----------------------------------------------------------------------------------------------

const OTHERS: { n: number; make: (url: string) => Wire }[] = [
  { n: 11, make: (u) => ({ challenge: good(u, address('c1')) }) },
  { n: 9, make: (u) => ({ challenge: challenge(u, accept('USDC', {}, address('c2'))) }) },
  { n: 6, make: (u) => ({ challenge: challenge(u, accept('USDC', {}, address('c3'))), headers: {} }) },
  { n: 5, make: (u) => ({ challenge: challenge(u, accept('USDC', {}, address('c4'))), headers: { 'access-control-allow-origin': '*' } }) },
  { n: 4, make: (u) => ({ challenge: challenge(u, accept('USDC', { maxTimeoutSeconds: 10 }, address('c5'))) }) },
  { n: 4, make: (u) => ({ challenge: challenge(u, accept('USDC', { extra: { name: 'USD Coin', version: '2' } }, address('c6'))) }) },
  { n: 3, make: (u) => ({ challenge: challenge(u, accept('USDC', { amount: '5000000000000000' }, address('c7'))) }) },
  { n: 3, make: (u) => ({ challenge: challenge(u, accept('USDC', { network: 'eip155:11142220' }, address('c8'))) }) },
  { n: 3, make: (u) => ({ challenge: challenge(u, accept('USDC', {}, address('c9')), accept('USDC', { network: 'eip155:11142220' }, address('c9'))) }) },
  { n: 2, make: (u) => ({ challenge: challenge(u, accept('wARS', { extra: { name: ASSETS.wARS.eip712Name, version: ASSETS.wARS.eip712Version } }, address('d1'))) }) },
  { n: 3, make: (u) => ({ challenge: { ...(buyV1Challenge as object), resource: u }, v1: true }) },
  { n: 5, make: () => ({}) },
  { n: 2, make: (u) => ({ challenge: challenge(u, accept('USDC', { amount: '900000' }, address('d2'))) }) },
  { n: 1, make: (u) => ({ challenge: challenge(u, accept('USDC', {}, ZERO)) }) },
];

// ---- write it ---------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'runs'), { recursive: true });
  const put = (file: string, value: unknown) => writeFile(path.join(OUT, file), `${JSON.stringify(value, null, 2)}\n`);

  const runs: RunRecord[] = [];
  for (const e of OURS) {
    const startedAt = minutesAgo(e.ago);
    const report = await scan(e.url, e.wire, e.method);
    const assets: AssetSymbol[] = e.pay ? ['USAT'] : [];
    const { run } = await confirm(e.stage, report, startedAt, assets, e.pay ?? null, e.url);
    runs.push(RunRecordSchema.parse(run));
  }
  for (const run of runs) await put(`runs/${run.id}.json`, run);
  await put('map.json', MapFileSchema.parse({ updatedAt: NOW.toISOString(), cells: mapCells(runs) }));

  // The wider ecosystem: scanned, counted, never named.
  const reports: CheckReport[] = [];
  let i = 0;
  for (const profile of OTHERS) {
    for (let k = 0; k < profile.n; k++, i++) {
      const url = `https://seller-${i}.example/api/data`;
      let report = await scan(url, profile.make(url));
      if (i % 9 === 0 && report.challenge) report = (await confirm('unsolicited', report, minutesAgo(30 + i), ['USDC'], settled(`other-${i}`, OK_BODY, 9_000), url)).report;
      reports.push(report);
    }
  }
  await put('summary.json', ScanSummarySchema.parse(summarize(reports, NOW)));

  // The books: what we paid (and to ourselves), and the few people who paid us.
  const outgoing = runs.flatMap((run) =>
    run.payments.map((p) => ({ txHash: p.txHash ?? tx(run.id), from: AGENT, to: p.payTo.toLowerCase(), token: p.asset.toLowerCase(), amountAtomic: p.amountAtomic, at: run.startedAt })),
  );
  const payers = [address('e1'), address('e2'), address('e3')];
  const incoming = [
    { txHash: tx('in-1'), from: payers[0]!, to: AGENT, token: ASSETS.USAT.address.toLowerCase(), amountAtomic: '250000', at: minutesAgo(50).toISOString() },
    { txHash: tx('in-2'), from: payers[1]!, to: AGENT, token: ASSETS.USAT.address.toLowerCase(), amountAtomic: '20000', at: minutesAgo(40).toISOString() },
    { txHash: tx('in-3'), from: payers[2]!, to: AGENT, token: ASSETS.USDC.address.toLowerCase(), amountAtomic: '20000', at: minutesAgo(20).toISOString() },
  ];
  const ledger = buildLedger({
    agent: AGENT,
    projectWallets: [FIXTURE_PAY_TO],
    incoming,
    outgoing,
    runs,
    facts: {
      [payers[0]!]: { address: payers[0]!, firstActivityAt: '2026-09-02T10:00:00.000Z', firstFunder: address('f1') },
      [payers[1]!]: { address: payers[1]!, firstActivityAt: '2026-10-08T09:00:00.000Z', firstFunder: AGENT },
      [payers[2]!]: { address: payers[2]!, firstActivityAt: null, firstFunder: null },
    },
    hackathonStart: HACKATHON_START,
  });
  await put('ledger.json', LedgerFileSchema.parse({ generatedAt: NOW.toISOString(), hackathonStart: HACKATHON_START, agent: AGENT, ledger }));

  // A real scan report of a broken endpoint, for showing the check widget's result without a network: the shots script answers /api/scan with it.
  const demoUrl = 'https://seller.sample.example/api/data';
  await put('scan-demo.json', await scan(demoUrl, { challenge: challenge(demoUrl, accept('USDC', { amount: '5000000000000000', extra: { name: 'USD Coin', version: '2' } }, address('d3'))), headers: { 'access-control-allow-origin': '*' } }));

  console.log(`sample data written to ${OUT}`);
  console.log(`  ${runs.length} runs, ${mapCells(runs).length} map cells, ${reports.length} other endpoints, ${ledger.byService.length} services, ${ledger.signers.length} signers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
