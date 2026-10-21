import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig, loadRegistration, makeClients, payEndpoint, registerAgent, toAgentUri, buildRegistration, verifySettlementOnChain, verifyTagged, type Config } from '@railwalker/chain';
import { ASSETS, DEFAULT_POLICY, SpendLedger } from '@railwalker/core';
import { FileDataStore, sellerKeyFor } from '@railwalker/data';
import { discoverEndpoints, fixtureEndpoints } from '@railwalker/discovery';
import { confirmEndpoint, defaultScanDeps, scanEndpoint, type CheckReport, type ConfirmOptions } from '@railwalker/scanner';
import { erc20Abi } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { stablecoinUsd } from './commands/doctor';
import type { Balances, CliDeps } from './types';

async function readBalances(cfg: Config): Promise<Balances> {
  const c = makeClients(cfg);
  const owner = c.account.address;
  const token = (symbol: 'USDC' | 'USDT' | 'USAT') => c.publicClient.readContract({ address: ASSETS[symbol].address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
  const [celo, USDC, USDT, USAT] = await Promise.all([c.publicClient.getBalance({ address: owner }), token('USDC'), token('USDT'), token('USAT')]);
  return { celo, USDC, USDT, USAT };
}

/** What one scheduled run spends on finding things: a registry walk and a few registrations, all bounded, under a time budget. */
const DISCOVERY = { maxIds: 1000, maxRegistrations: 100, concurrency: 8, budgetMs: 120_000 } as const;

/** Pays through a ledger the caller keeps, from the wallet the configuration describes. */
async function confirmThrough(cfg: Config, ledger: SpendLedger, sellerKey: string, report: CheckReport, opts: ConfirmOptions) {
  const c = makeClients(cfg);
  return confirmEndpoint(
    {
      pay: (req) => payEndpoint({ account: c.account, publicClient: c.publicClient }, req),
      verifyTransfer: (a) => verifySettlementOnChain(c.publicClient, a),
      ledger,
      payer: c.account.address,
      sellerKey,
      balanceUsd: async () => stablecoinUsd(await readBalances(cfg)),
      now: () => new Date(),
    },
    report,
    opts,
  );
}

/** The real thing: the real disk, the real network, and a wallet built from the validated configuration only when a command needs one. */
export function realDeps(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): CliDeps {
  return {
    env,
    cwd,
    fs: {
      exists: async (path) => access(path).then(() => true, () => false),
      readFile: (path) => readFile(path, 'utf8'),
      writeFile: async (path, data, opts) => {
        await writeFile(path, data, { mode: opts?.mode });
        if (opts?.mode !== undefined) await chmod(path, opts.mode); // writeFile applies the mode only when it creates the file
      },
      mkdir: async (path) => void (await mkdir(path, { recursive: true })),
    },
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    now: () => new Date(),
    generateKey: () => generatePrivateKey(),

    scan: (req) => scanEndpoint(defaultScanDeps(), req),
    loadConfig: (overrides = {}) => loadConfig({ ...env, ...overrides }),
    readBalances,

    async confirm(cfg, report, opts, spend) {
      const ledger = new SpendLedger(DEFAULT_POLICY, spend);
      const sellerKey = sellerKeyFor(opts.stage, new URL(report.endpoint.url).hostname, cfg.sellerSalt);
      const result = await confirmThrough(cfg, ledger, sellerKey, report, opts);
      return { ...result, spend: ledger.snapshot() };
    },
    confirmThrough,

    openStore: (dir) => new FileDataStore(dir),

    async discover(cfg, cursor, o) {
      const c = makeClients(cfg);
      // The fixtures package carries a whole web server: load it only for the command that needs its route list.
      const fixtures = o.fixturesUrl === undefined ? [] : fixtureEndpoints(o.fixturesUrl, ['/ok', ...Object.keys((await import('@railwalker/fixtures')).FIXTURE_EXPECTATIONS)]);
      const found = await discoverEndpoints(
        { fetchImpl: fetch, lister: c.publicClient, cfg, loadRegistration: (uri) => loadRegistration(uri, fetch), now: () => Date.now() },
        { fixtures, nextId: BigInt(cursor.nextId), ...DISCOVERY },
      );
      return { endpoints: found.endpoints, cursor: { nextId: String(found.nextId) }, problems: found.problems };
    },

    async register(cfg, meta, opts) {
      const c = makeClients(cfg);
      const { hash, agentId } = await registerAgent(c, cfg, toAgentUri(buildRegistration(meta)), { fee: opts.fee });
      const tagged = await verifyTagged(c, hash);
      return { hash, agentId, tagged: tagged?.codes ?? null };
    },
  };
}
