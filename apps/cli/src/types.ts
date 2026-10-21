import type { Config, FeeSymbol, RegistrationMeta } from '@railwalker/chain';
import type { SpendState } from '@railwalker/core';
import type { CheckReport, ConfirmOptions, RunRecord, ScanRequest } from '@railwalker/scanner';

export interface CliFs {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, opts?: { mode?: number }): Promise<void>;
  mkdir(path: string): Promise<void>;
}

/** Atomic units: 6 decimals for the three stablecoins, 18 for CELO. */
export interface Balances {
  celo: bigint;
  USDC: bigint;
  USDT: bigint;
  USAT: bigint;
}

export interface CheckResult {
  report: CheckReport;
  run: RunRecord;
  /** The spend state after this confirmation, to be saved. */
  spend: SpendState;
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
  register: (cfg: Config, meta: RegistrationMeta, opts: { fee: FeeSymbol }) => Promise<RegisterResult>;
}

/** What a command gets: the dependencies, redacting writers, and a way to register a secret that must never be printed. */
export interface Ctx {
  deps: CliDeps;
  out: (text: string) => void;
  err: (text: string) => void;
  addSecret: (secret: string) => void;
}
