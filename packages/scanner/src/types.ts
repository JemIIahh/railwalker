import type { Challenge, Finding, Patch, Verdict } from '@railwalker/core';

export interface ScanDeps {
  fetchImpl: typeof fetch;
  /** Every address the host resolves to: a host with any private address is refused. */
  resolveHost: (host: string) => Promise<string[]>;
  isOptedOut: (host: string) => Promise<boolean>;
  now: () => Date;
  userAgent: string;
  /** A challenge slower than this gets an info finding. Default 3000. */
  slowMs?: number;
  /** One deadline for the whole scan: lookups, every hop and every body read. Default 10000. */
  timeoutMs?: number;
}

export interface ScanRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  agentWallet?: string | null;
}

export interface CheckReport {
  id: string;
  endpoint: { url: string; method: 'GET' | 'POST' };
  scannedAt: string;
  /** The HTTP status of the answer that was read; null when nothing was read. */
  status: number | null;
  latencyMs: number;
  challenge: Challenge | null;
  findings: Finding[];
  verdicts: Verdict[];
  patches: Patch[];
}
