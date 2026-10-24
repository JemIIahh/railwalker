import type { Config, FeeSymbol, FundablePeso, FundingCoin, RegistrationMeta, SwapPlan } from '@railwalker/chain';
import type { SpendLedger, SpendState } from '@railwalker/core';
import type { DataStore, DiscoveryState } from '@railwalker/data';
import type { Endpoint } from '@railwalker/discovery';
import type { CheckReport, ConfirmOptions, RunRecord, ScanRequest } from '@railwalker/scanner';

export interface CliFs {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, opts?: { mode?: number }): Promise<void>;
  mkdir(path: string): Promise<void>;
}

/** Atomic units: 6 decimals for the three stablecoins, 18 for CELO and the pesos. */
export interface Balances {
  celo: bigint;
  USDC: bigint;
  USDT: bigint;
  USAT: bigint;
  /** The pesos the wallet holds. Absent when they were not read, which a payment treats as none. */
  wARS?: bigint;
  wBRL?: bigint;
}

export interface CheckResult {
  report: CheckReport;
  run: RunRecord;
  /** The spend state after this confirmation, to be saved. */
  spend: SpendState;
}

export interface FundResult {
  /** null when the router already had an allowance that covered the swap. */
  approveHash: `0x${string}` | null;
  swapHash: `0x${string}`;
  /** The ERC-8021 codes found on the swap, or null if it could not be verified. */
  tagged: string[] | null;
  /** The wallet after the swap. */
  balances: Balances;
}

export interface RegisterResult {
  hash: `0x${string}`;
  agentId: bigint;
  /** The ERC-8021 codes found on the registration transaction, or null if it could not be verified. */
  tagged: string[] | null;
}

/** Everything the commands touch outside themselves, so the whole CLI can be tested without a disk, a network or a key. */
export interface CliDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  fs: CliFs;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now: () => Date;
  generateKey: () => `0x${string}`;
  /** Free: never pays. Needs no configuration. */
  scan: (req: ScanRequest) => Promise<CheckReport>;
  /** The validated configuration, with optional overrides of environment variables. Throws when it is invalid. */
  loadConfig: (overrides?: Record<string, string>) => Config;
  readBalances: (cfg: Config) => Promise<Balances>;
  confirm: (cfg: Config, report: CheckReport, opts: ConfirmOptions, spend: SpendState) => Promise<CheckResult>;
  /** Pays through a ledger the caller keeps, so everything that pays in one process answers to the same caps. */
  confirmThrough: (cfg: Config, ledger: SpendLedger, sellerKey: string, report: CheckReport, opts: ConfirmOptions) => Promise<{ report: CheckReport; run: RunRecord }>;
  /** The data folder: plain files, and in the scheduled workflow a git checkout of the public `data` branch. */
  openStore: (dir: string) => DataStore;
  /** Free: what to look at this run, where the registry walk got to, and what went wrong on the way (never naming a seller). */
  discover: (cfg: Config, cursor: DiscoveryState, o: { fixturesUrl?: string }) => Promise<{ endpoints: Endpoint[]; cursor: DiscoveryState; problems: string[] }>;
  register: (cfg: Config, meta: RegistrationMeta, opts: { fee: FeeSymbol }) => Promise<RegisterResult>;
  /** Free: quotes a swap of dollars into a peso. Nothing is sent. */
  planPesos: (cfg: Config, a: { from: FundingCoin; to: FundablePeso; amountIn: bigint }) => Promise<SwapPlan>;
  /** Sends the swap, tagged, and reports what it did. */
  fundPesos: (cfg: Config, plan: SwapPlan, opts: { from: FundingCoin; fee: FeeSymbol }) => Promise<FundResult>;
}

/** What a command gets: the dependencies, redacting writers, and a way to register a secret that must never be printed. */
export interface Ctx {
  deps: CliDeps;
  out: (text: string) => void;
  err: (text: string) => void;
  addSecret: (secret: string) => void;
}
