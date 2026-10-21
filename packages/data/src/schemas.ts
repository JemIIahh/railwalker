import { z } from 'zod';
import { ASSETS, FINDING_ORDER, SKIP_REASONS, STAGES, type AssetSymbol, type SpendState } from '@railwalker/core';
import type { CheckReport, RunRecord } from '@railwalker/scanner';

/**
 * What is stored, and what is read back from storage, is checked against these. Every object is strict: a field nobody
 * declared (a stray `privateKey`, say) makes the record invalid instead of travelling into a public file.
 */

const AssetSymbolSchema = z.enum(Object.keys(ASSETS) as [AssetSymbol, ...AssetSymbol[]]);
const FindingCodeSchema = z.enum(FINDING_ORDER);
const VerdictCodeSchema = z.enum([...FINDING_ORDER, ...SKIP_REASONS]);
const StageSchema = z.enum(STAGES);
const BasisSchema = z.enum(['CONFIRMED', 'PREDICTED']);
const MethodSchema = z.enum(['GET', 'POST']);

const iso = z.iso.datetime();
const id16 = z.string().regex(/^[0-9a-f]{16}$/);
const count = z.number().int().nonnegative();
const hexAddress = z.custom<`0x${string}`>((v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v), 'not a 0x address');
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** What a seller chose to say. It was bounded where it came in (clipDeep), so any JSON value may sit inside. */
const sellerJson = z.record(z.string(), z.unknown());

const EndpointSchema = z.strictObject({ url: z.string(), method: MethodSchema });

const FindingSchema = z.strictObject({
  code: FindingCodeSchema,
  severity: z.enum(['error', 'warn', 'info']),
  basis: BasisSchema,
  message: z.string(),
  evidence: sellerJson,
  assetSymbol: AssetSymbolSchema.optional(),
});

const VerdictSchema = z.strictObject({
  kind: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL', 'AMBIGUOUS', 'SKIPPED']),
  code: VerdictCodeSchema.optional(),
  basis: BasisSchema,
  assetSymbol: AssetSymbolSchema.optional(),
  findings: z.array(FindingSchema),
});

const PatchSchema = z.strictObject({ code: FindingCodeSchema, title: z.string(), why: z.string(), after: z.string() });

const AssetInfoSchema = z.strictObject({
  symbol: AssetSymbolSchema,
  address: hexAddress,
  decimals: z.union([z.literal(6), z.literal(18)]),
  method: z.enum(['eip3009', 'permit2']),
  eip712Name: z.string(),
  eip712Version: z.string(),
  usdPegged: z.boolean(),
  feeAdapter: hexAddress.optional(),
});

const AcceptSchema = z.strictObject({
  scheme: z.string(),
  network: z.string(),
  chainId: z.number().int().nullable(),
  asset: z.string(),
  assetInfo: AssetInfoSchema.nullable(),
  amountAtomic: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().nullable(),
  extra: sellerJson,
});

const ChallengeSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  accepts: z.array(AcceptSchema),
  extensions: sellerJson,
  resource: z.strictObject({ url: z.string().optional(), description: z.string().optional(), mimeType: z.string().optional() }),
  hasOutputSchema: z.boolean(),
});

export const CheckReportSchema = z.strictObject({
  id: id16,
  endpoint: EndpointSchema,
  scannedAt: iso,
  status: z.number().int().nullable(),
  latencyMs: count,
  challenge: ChallengeSchema.nullable(),
  findings: z.array(FindingSchema),
  verdicts: z.array(VerdictSchema),
  patches: z.array(PatchSchema),
  /** Set by the public scan API when it had to drop the seller's own words to keep the answer small. */
  truncated: z.boolean().optional(),
});

export const RunRecordSchema = z.strictObject({
  id: id16,
  kind: StageSchema,
  startedAt: iso,
  endpoint: EndpointSchema,
  steps: z.array(
    z.strictObject({
      t: count,
      stage: z.enum(['challenge', 'lints', 'wallet', 'sign', 'settle', 'deliver', 'verdict']),
      ok: z.boolean().nullable(),
      label: z.string(),
      detail: sellerJson.optional(),
    }),
  ),
  verdicts: z.array(VerdictSchema),
  payments: z.array(
    z.strictObject({
      asset: z.string(),
      symbol: z.string().nullable(),
      amountAtomic: z.string().regex(/^\d+$/),
      payTo: z.string(),
      /** Absent when the payment was sent and nobody can say whether it settled. */
      txHash: txHash.optional(),
    }),
  ),
});

export const SpendStateSchema = z.strictObject({
  totalUsd: z.number().nonnegative(),
  byEndpointDay: z.record(z.string(), z.number().nonnegative()),
  settlementsBySeller: z.record(z.string(), count),
});

/** Counts and shares only: nothing in it can name a seller. */
export const ScanSummarySchema = z.strictObject({
  generatedAt: iso,
  endpointsScanned: count,
  byFinding: z.partialRecord(FindingCodeSchema, count),
  assetAcceptance: z.partialRecord(AssetSymbolSchema, count),
  payablePct: z.number().min(0).max(100),
  confirmedProbes: count,
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;

/**
 * A uint256 written in decimal, one spelling per number. All in one test, because a failed check does not stop the next one
 * from running: `BigInt('abc')` would throw out of the validator. At most 78 digits keeps it cheap on any input.
 */
const isUint256 = (s: string): boolean => s.length <= 78 && /^(0|[1-9]\d*)$/.test(s) && BigInt(s) < 2n ** 256n;

/** Where discovery stops: the next ERC-8004 agent id to look at. It is a uint256, so it travels as a decimal string. */
export const DiscoveryStateSchema = z.strictObject({ nextId: z.string().refine(isUint256, 'not a uint256 written in decimal') });
export type DiscoveryState = z.infer<typeof DiscoveryStateSchema>;

// The schemas stand in for types defined in other packages. If either side changes without the other, these stop compiling.
type Assert<_T extends true> = true;
type Fits<From, To> = [From] extends [To] ? true : false;
type _SchemasMatchTheirTypes = [
  Assert<Fits<z.output<typeof CheckReportSchema>, CheckReport>>,
  Assert<Fits<CheckReport, z.input<typeof CheckReportSchema>>>,
  Assert<Fits<z.output<typeof RunRecordSchema>, RunRecord>>,
  Assert<Fits<RunRecord, z.input<typeof RunRecordSchema>>>,
  Assert<Fits<z.output<typeof SpendStateSchema>, SpendState>>,
  Assert<Fits<SpendState, z.input<typeof SpendStateSchema>>>,
];
