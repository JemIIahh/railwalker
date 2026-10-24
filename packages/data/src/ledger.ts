import { INDEPENDENCE_REASONS, assetByAddress, classifyIndependence, type IndependenceReason, type TokenTransfer, type WalletFacts } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import { z } from 'zod';
import { TxHashSchema } from './schemas';

export interface LedgerService {
  name: string;
  calls: number;
  usd: number;
  /** Transaction hashes that show the payments settled. */
  proofs: string[];
}

export interface LedgerSigner {
  address: string;
  counted: boolean;
  reason: IndependenceReason;
}

export interface Ledger {
  spentUsd: number;
  earnedUsd: number;
  byService: LedgerService[];
  signers: LedgerSigner[];
  selfTransfers: number;
}

export interface LedgerInput {
  agent: string;
  projectWallets: string[];
  /** Token transfers into our wallets, as listed from the chain; a transfer listed twice is counted once. */
  incoming: TokenTransfer[];
  outgoing: TokenTransfer[];
  runs: RunRecord[];
  /** What is known of each payer, keyed by address in any case. A payer with no entry is not counted: nothing shows it independent. */
  facts: Record<string, WalletFacts>;
  /** ISO timestamp; the hackathon rule uses 2026-10-06T00:00:00Z. */
  hackathonStart: string;
}

const DIGITS = /^\d{1,78}$/;

/** Millionths of a dollar. Only the dollar assets with six decimals are money; every other token is worth nothing here. */
function microUsd(token: string, amountAtomic: string): bigint {
  const asset = assetByAddress(token);
  if (!asset || !asset.usdPegged || asset.decimals !== 6 || !DIGITS.test(amountAtomic)) return 0n;
  return BigInt(amountAtomic);
}

/** Whole numbers all the way until the last step, so a thousand dust payments add up to exactly what they are. */
const dollars = (micro: bigint): number => Number(micro) / 1_000_000;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What a service is called in the table: our own fixtures are `self`, a private kind is never named by its host. */
function serviceName(run: RunRecord): string {
  if (run.kind === 'fixture') return 'self: fixtures';
  if (run.kind === 'buy') {
    try {
      return new URL(run.endpoint.url).hostname;
    } catch {
      return 'unknown service';
    }
  }
  return `private: ${run.kind}`;
}

/**
 * The honest books. Money that moves between our own wallets is a self transfer and is neither earned nor spent; what others paid
 * us is earned, what we paid others is spent; a payer is a signer, and counts only if the hackathon's rule says it is independent
 * (not ours, not first funded by us, active before the start). Pure: the transfers, runs and wallet facts come from outside.
 */
export function buildLedger(a: LedgerInput): Ledger {
  if (Number.isNaN(Date.parse(a.hackathonStart))) throw new RangeError(`hackathonStart is not a date: ${JSON.stringify(a.hackathonStart)}`);
  const ours = new Set([a.agent, ...a.projectWallets].map((w) => w.toLowerCase()));
  const factsByAddress = new Map(Object.entries(a.facts).map(([address, f]) => [address.toLowerCase(), f]));

  let earned = 0n;
  let spent = 0n;
  let selfTransfers = 0;
  const payers = new Set<string>();
  const seen = new Set<string>();
  for (const t of [...a.incoming, ...a.outgoing]) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    const key = [t.txHash, from, to, t.token.toLowerCase(), t.amountAtomic].join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    if (ours.has(from) && ours.has(to)) {
      selfTransfers++;
    } else if (ours.has(to)) {
      const value = microUsd(t.token, t.amountAtomic);
      earned += value;
      if (value > 0n) payers.add(from);
    } else if (ours.has(from)) {
      spent += microUsd(t.token, t.amountAtomic);
    }
  }

  const signers: LedgerSigner[] = [...payers]
    .map((address) => {
      const wallet = { ...(factsByAddress.get(address) ?? { firstActivityAt: null, firstFunder: null }), address };
      const { counted, reason } = classifyIndependence({ wallet, projectWallets: [...ours], hackathonStart: a.hackathonStart });
      return { address, counted, reason };
    })
    .sort((x, y) => Number(y.counted) - Number(x.counted) || compare(x.address, y.address));

  const services = new Map<string, { calls: number; micro: bigint; proofs: string[] }>();
  const runIds = new Set<string>();
  for (const run of a.runs) {
    if (runIds.has(run.id)) continue;
    runIds.add(run.id);
    if (run.payments.length === 0) continue;
    const name = serviceName(run);
    const row = services.get(name) ?? { calls: 0, micro: 0n, proofs: [] };
    services.set(name, row);
    for (const p of run.payments) {
      row.calls++;
      row.micro += microUsd(p.asset, p.amountAtomic);
      if (p.txHash !== undefined && !row.proofs.includes(p.txHash)) row.proofs.push(p.txHash);
    }
  }
  const byService: LedgerService[] = [...services]
    .map(([name, row]) => ({ name, calls: row.calls, usd: dollars(row.micro), proofs: row.proofs }))
    .sort((x, y) => compare(x.name, y.name));

  return { spentUsd: dollars(spent), earnedUsd: dollars(earned), byService, signers, selfTransfers };
}

const count = z.number().int().nonnegative();
const LedgerServiceSchema = z.strictObject({ name: z.string().min(1).max(100), calls: count, usd: z.number().nonnegative(), proofs: z.array(TxHashSchema).max(1000) });
const LedgerSignerSchema = z.strictObject({ address: z.string().regex(/^0x[0-9a-f]{40}$/), counted: z.boolean(), reason: z.enum(INDEPENDENCE_REASONS) });

export const LedgerSchema = z.strictObject({
  spentUsd: z.number().nonnegative(),
  earnedUsd: z.number().nonnegative(),
  byService: z.array(LedgerServiceSchema).max(500),
  signers: z.array(LedgerSignerSchema).max(5000),
  selfTransfers: count,
});

/** What the runner publishes as `ledger.json` and the ledger page reads: the books, and what they were built for. */
export const LedgerFileSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  hackathonStart: z.iso.datetime(),
  /** The agent wallet: public, it is the address buyers pay. */
  agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ledger: LedgerSchema,
});
export type LedgerFile = z.infer<typeof LedgerFileSchema>;

// The schema stands in for the Ledger type. If either side changes without the other, this stops compiling.
type Fits<From, To> = [From] extends [To] ? true : false;
type Assert<_T extends true> = true;
type _LedgerMatchesItsSchema = [Assert<Fits<z.output<typeof LedgerSchema>, Ledger>>, Assert<Fits<Ledger, z.input<typeof LedgerSchema>>>];
