import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig, makeClients, payEndpoint, registerAgent, toAgentUri, buildRegistration, verifySettlementOnChain, verifyTagged, type Config } from '@railwalker/chain';
import { ASSETS, DEFAULT_POLICY, SpendLedger } from '@railwalker/core';
import { confirmEndpoint, defaultScanDeps, scanEndpoint } from '@railwalker/scanner';
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
      const c = makeClients(cfg);
      const ledger = new SpendLedger(DEFAULT_POLICY, spend);
      const result = await confirmEndpoint(
        {
          pay: (req) => payEndpoint({ account: c.account, publicClient: c.publicClient }, req),
          verifyTransfer: (a) => verifySettlementOnChain(c.publicClient, a),
          ledger,
          payer: c.account.address,
          sellerKey: new URL(report.endpoint.url).hostname,
          balanceUsd: async () => stablecoinUsd(await readBalances(cfg)),
          now: () => new Date(),
        },
        report,
        opts,
      );
      return { ...result, spend: ledger.snapshot() };
    },

    async register(cfg, meta, opts) {
      const c = makeClients(cfg);
      const { hash, agentId } = await registerAgent(c, cfg, toAgentUri(buildRegistration(meta)), { fee: opts.fee });
      const tagged = await verifyTagged(c, hash);
      return { hash, agentId, tagged: tagged?.codes ?? null };
    },
  };
}
