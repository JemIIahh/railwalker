import { loadConfig } from '@railwalker/chain';
import { ASSETS, emptySpendState, type SpendLedger, type SpendState, type Verdict } from '@railwalker/core';
import type { DataStore, DiscoveryState } from '@railwalker/data';
import type { Endpoint } from '@railwalker/discovery';
import { fakeFetch, v2MultiAssetChallenge } from '@railwalker/testkit';
import { RunRecorder, scanEndpoint, type CheckReport, type ConfirmOptions, type RunRecord, type ScanRequest } from '@railwalker/scanner';
import { privateKeyToAddress } from 'viem/accounts';
import { runCli, type Balances, type CliDeps, type RegisterResult } from '../src';

export const KEY = `0x${'ab'.repeat(32)}` as const;
export const OTHER_KEY = `0x${'cd'.repeat(32)}` as const;
export const ADDRESS = privateKeyToAddress(KEY);
export const CODE = 'celo_29928c447ace';
export const SALT = 'a-long-secret-salt-1234';
export const API_KEY = 'x402_live_super_secret_value';
export const URL_OK = 'https://seller.example/api/data';

export const MAINNET_ENV = { AGENT_PRIVATE_KEY: KEY, RAILWALKER_NETWORK: 'mainnet', RAILWALKER_ATTRIBUTION_CODE: CODE, SELLER_SALT: SALT, X402_API_KEY: API_KEY };
export const SEPOLIA_ENV = { AGENT_PRIVATE_KEY: KEY, RAILWALKER_ATTRIBUTION_CODE: CODE, X402_API_KEY: API_KEY };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };

/** The v2 fixture challenge with every amount set to `amount` atomic units. */
export const challengeWith = (amount: string) => ({ ...v2MultiAssetChallenge, accepts: v2MultiAssetChallenge.accepts.map((a) => ({ ...a, amount })) });

/** A real scan report, made by the real scanner against a fake seller: no network. */
export async function scanReport(url = URL_OK, challenge: unknown = challengeWith('5000')): Promise<CheckReport> {
  const f = fakeFetch({ [url]: () => new Response('{}', { status: 402, headers: { 'payment-required': b64(challenge), ...CORS } }) });
  return scanEndpoint(
    { fetchImpl: f, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 'test' },
    { url, method: 'GET' },
  );
}

/** What a confirmation would return for a payment that worked, without paying: the asked-for assets become CONFIRMED PASS. */
export function confirmedFrom(report: CheckReport, assets: string[], spend: SpendState, usd: number): { report: CheckReport; run: RunRecord; spend: SpendState } {
  const verdicts: Verdict[] = report.verdicts.map((v) => (assets.includes(v.assetSymbol ?? '') ? { ...v, kind: 'PASS', basis: 'CONFIRMED' } : v));
  const run: RunRecord = {
    id: 'run0123456789abcd',
    kind: 'fixture',
    startedAt: '2026-10-22T12:00:00.000Z',
    endpoint: report.endpoint,
    steps: [{ t: 0, stage: 'verdict', ok: true, label: 'ok' }],
    verdicts,
    payments: [],
  };
  return { report: { ...report, verdicts }, run, spend: { ...spend, totalUsd: spend.totalUsd + usd } };
}

/** A store that lives in memory, so a command can be tested without a disk. */
export function memoryStore(initial: Record<string, string> = {}): DataStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => void files.set(path, content),
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

/** What a confirmation through a shared ledger returns for a payment that worked: the ledger is asked first, as the real one does. */
export async function confirmedThrough(ledger: SpendLedger, sellerKey: string, report: CheckReport, opts: ConfirmOptions, now: Date) {
  const symbol = opts.assets[0]!;
  const decision = await ledger.reserve({ stage: opts.stage, sellerKey, priceUsd: 0.005, readStyle: true, optedOut: false, balanceUsd: 2, now });
  const rec = new RunRecorder(() => now, opts.stage, { url: report.endpoint.url, method: report.endpoint.method });
  if (!decision.allow) {
    rec.step('wallet', false, `${symbol}: payment refused (${decision.reason})`, { reason: decision.reason });
    const verdicts: Verdict[] = [{ kind: 'SKIPPED', code: decision.reason, basis: 'PREDICTED', assetSymbol: symbol, findings: [] }];
    return { report: { ...report, verdicts }, run: rec.finish(verdicts) };
  }
  const accept = report.challenge!.accepts.find((a) => a.assetInfo?.symbol === symbol)!;
  rec.step('settle', true, `${symbol}: settled`);
  rec.payment({ asset: ASSETS[symbol].address, symbol, amountAtomic: accept.amountAtomic, payTo: accept.payTo, txHash: `0x${'ab'.repeat(32)}` });
  const verdicts: Verdict[] = [{ kind: 'PASS', basis: 'CONFIRMED', assetSymbol: symbol, findings: [] }];
  return { report: { ...report, verdicts }, run: rec.finish(verdicts) };
}

/** 5 USA₮ and nothing else: what the faucet gives. */
export const FAUCET: Balances = { celo: 0n, USDC: 0n, USDT: 0n, USAT: 2_000_000n };

export function harness(
  over: Partial<CliDeps> & {
    env?: Record<string, string | undefined>;
    files?: Record<string, string>;
    /** What openStore hands back. */
    store?: ReturnType<typeof memoryStore>;
    /** What discover finds. */
    found?: { endpoints: Endpoint[]; cursor?: DiscoveryState; problems?: string[] };
  } = {},
) {
  const { env = MAINNET_ENV, files: initial = {}, store = memoryStore(), found = { endpoints: [] }, ...rest } = over;
  const files = new Map<string, { data: string; mode?: number }>(Object.entries(initial).map(([p, data]) => [p, { data }]));
  const out: string[] = [];
  const err: string[] = [];
  const calls = {
    scan: [] as ScanRequest[],
    loadConfig: 0,
    readBalances: 0,
    confirm: [] as { cfg: unknown; opts: ConfirmOptions; spend: SpendState }[],
    register: [] as { cfg: unknown; meta: unknown; opts: unknown }[],
    confirmThrough: [] as { cfg: unknown; ledger: SpendLedger; sellerKey: string; report: CheckReport; opts: ConfirmOptions }[],
    openStore: [] as string[],
    discover: [] as { cursor: DiscoveryState; fixturesUrl?: string }[],
  };

  const deps: CliDeps = {
    env,
    cwd: '/work',
    fs: {
      exists: async (p) => files.has(p),
      readFile: async (p) => {
        const f = files.get(p);
        if (!f) throw new Error(`ENOENT: ${p}`);
        return f.data;
      },
      writeFile: async (p, data, o) => void files.set(p, { data, mode: o?.mode }),
      mkdir: async () => {},
    },
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    now: () => new Date('2026-10-22T12:00:00Z'),
    generateKey: () => KEY,
    scan: async (req) => {
      calls.scan.push(req);
      return scanReport(req.url);
    },
    loadConfig: (overrides = {}) => {
      calls.loadConfig++;
      return loadConfig({ ...env, ...overrides });
    },
    readBalances: async () => {
      calls.readBalances++;
      return FAUCET;
    },
    confirm: async (cfg, report, opts, spend) => {
      calls.confirm.push({ cfg, opts, spend });
      return confirmedFrom(report, opts.assets, spend, 0.005);
    },
    confirmThrough: async (cfg, ledger, sellerKey, report, opts) => {
      calls.confirmThrough.push({ cfg, ledger, sellerKey, report, opts });
      return confirmedThrough(ledger, sellerKey, report, opts, new Date('2026-10-22T12:00:00Z'));
    },
    openStore: (dir) => {
      calls.openStore.push(dir);
      return store;
    },
    discover: async (_cfg, cursor, o) => {
      calls.discover.push({ cursor, ...(o.fixturesUrl === undefined ? {} : { fixturesUrl: o.fixturesUrl }) });
      return { endpoints: found.endpoints, cursor: found.cursor ?? cursor, problems: found.problems ?? [] };
    },
    register: async (cfg, meta, opts) => {
      calls.register.push({ cfg, meta, opts });
      return { hash: `0x${'12'.repeat(32)}`, agentId: 7n, tagged: [CODE] } satisfies RegisterResult;
    },
    ...rest,
  };

  const run = (...argv: string[]) => runCli(argv, deps);
  return { deps, files, store, calls, run, out: () => out.join(''), err: () => err.join(''), all: () => out.join('') + err.join('') };
}

export { emptySpendState, ASSETS };
