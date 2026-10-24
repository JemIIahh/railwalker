import { CELO_MAINNET, DEFAULT_POLICY, classifyReadStyle, emptySpendState, type SpendLedger, type SpendState, type Stage } from '@railwalker/core';
import {
  DiscoveryStateSchema,
  RotationStateSchema,
  RunRecordSchema,
  ScanSummarySchema,
  SpendStateSchema,
  publicRun,
  sellerKeyFor,
  summarize,
  type DataStore,
  type DiscoveryState,
  type RotationState,
} from '@railwalker/data';
import { mergeEndpoints, type Endpoint } from '@railwalker/discovery';
import type { CheckReport, RunRecord } from '@railwalker/scanner';
import { Refusal } from './errors';

export const SPEND_PATH = 'state/spend.json';
export const DISCOVERY_PATH = 'state/discovery.json';
export const ROTATION_PATH = 'state/rotation.json';
export const SUMMARY_PATH = 'summary.json';

export interface BatchDeps {
  store: DataStore;
  /** Free. The endpoints to look at this run, and where the ERC-8004 registry walk got to. */
  discover: (cursor: DiscoveryState) => Promise<{ endpoints: Endpoint[]; cursor: DiscoveryState }>;
  /** Free: never pays. */
  scan: (e: Endpoint) => Promise<CheckReport>;
  /** Pays through `ledger`, which decides. A refusal comes back as a SKIPPED verdict carrying its reason. */
  confirm: (e: Endpoint, r: CheckReport, stage: Stage) => Promise<{ report: CheckReport; run: RunRecord }>;
  /** One ledger for everything that pays in this process, built from the saved spend state. */
  ledger: SpendLedger;
  /** Keeps every seller nobody asked us to look at unrecognisable in the files. */
  salt: string;
  now: () => Date;
  maxPaidPerRun: number;
  scanConcurrency: number;
  budgetMs: number;
  /** An extra rule about who may be paid, on top of the built-in ones (for example: the wallet holds an asset they accept). */
  payable?: (e: Endpoint, r: CheckReport) => boolean;
  /** Choose what would be paid and say so, but pay nothing and write nothing. */
  dryRun?: boolean;
}

export interface BatchResult {
  /** Endpoints whose scan came back. */
  scanned: number;
  /** Confirmations in which money moved. */
  paid: number;
  /** Scans, payments or records that went wrong: counted and skipped, never fatal. */
  failed: number;
  wrote: string[];
  /** Only for a dry run. A seller nobody asked us to look at is named by its key, never by its host. */
  plan?: { stage: Stage; label: string }[];
}

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

async function loadState<T>(store: DataStore, path: string, schema: Parser<T>, fresh: T, what: string, because: string): Promise<T> {
  const text = await store.read(path);
  if (text === null) return fresh;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Refusal(`the ${what} at ${path} is unreadable or invalid: refusing to run, because ${because}`);
  return parsed.data;
}

/** Missing is a fresh start. Anything else that is not valid stops the run: resetting would reset the caps. */
export const loadSpendState = (store: DataStore): Promise<SpendState> =>
  loadState(store, SPEND_PATH, SpendStateSchema, emptySpendState(), 'spend state', 'the spend caps cannot be enforced without it');

export const loadDiscoveryState = (store: DataStore): Promise<DiscoveryState> =>
  loadState(store, DISCOVERY_PATH, DiscoveryStateSchema, { nextId: '0' }, 'discovery cursor', 'the registry walk would start over');

export const loadRotationState = (store: DataStore): Promise<RotationState> =>
  loadState(store, ROTATION_PATH, RotationStateSchema, { lastTried: {} }, 'rotation state', 'the same endpoints would be tried every run');

const STAGE_OF: Partial<Record<Endpoint['source'], Stage>> = { fixture: 'fixture', buy: 'buy', erc8004: 'unsolicited' }; // a visitor is never paid by the batch
const ROUND: readonly Stage[] = ['fixture', 'buy', 'unsolicited'];
const OUR_ASSETS = new Set<string>(['USAT', 'USDC', 'wARS', 'wBRL']);
/** Refusals about the whole event or the wallet rather than one seller: nothing more can be paid this run. */
const RUN_ENDING_REFUSALS = new Set<string>(['over_event_cap', 'below_reserve']);
const MAX_SCAN_CONCURRENCY = 32;
const MAX_ROTATION_KEY = 2000;

interface Candidate {
  endpoint: Endpoint;
  report: CheckReport;
  stage: Stage;
  /** Where in the discovered list it was, to put its confirmed report back. */
  index: number;
  sellerKey: string;
  /** Only public endpoints are tracked for rotation; sellers nobody asked us to look at never are. */
  rotationKey: string | null;
}

/** What the scan shows we could pay: an x402 challenge with a dollar asset we hold on Celo mainnet, at a route that only reads. */
function isPayable(e: Endpoint, report: CheckReport): boolean {
  const challenge = report.challenge;
  if (!challenge) return false; // not x402, or the scan was refused (an opt-out, an unsafe URL)
  if (!challenge.accepts.some((a) => a.chainId === CELO_MAINNET && a.assetInfo !== null && OUR_ASSETS.has(a.assetInfo.symbol))) return false;
  return classifyReadStyle({ url: e.url, method: e.method, description: challenge.resource.description ?? e.description, capabilityId: e.capabilityId, source: e.source }).readStyle;
}

async function scanAll(deps: BatchDeps, endpoints: Endpoint[], outOfTime: () => boolean): Promise<{ reports: (CheckReport | null)[]; failed: number }> {
  const reports: (CheckReport | null)[] = endpoints.map(() => null);
  const workers = Math.min(MAX_SCAN_CONCURRENCY, Math.max(1, Math.floor(deps.scanConcurrency) || 1), Math.max(1, endpoints.length));
  let next = 0;
  let failed = 0;
  const work = async () => {
    for (;;) {
      if (outOfTime()) return;
      const i = next++;
      if (i >= endpoints.length) return;
      try {
        reports[i] = await deps.scan(endpoints[i]!);
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, work));
  return { reports, failed };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One queue per stage. Fixtures and buy routes go in rotation, the one tried longest ago first. Registered sellers go
 * fewest-settlements first, once per seller per run, and never past the per-seller limit.
 */
function queuesFor(deps: BatchDeps, endpoints: Endpoint[], reports: (CheckReport | null)[], rotation: RotationState): Record<Stage, Candidate[]> {
  const queues: Record<Stage, Candidate[]> = { fixture: [], buy: [], unsolicited: [], customer: [] };
  endpoints.forEach((endpoint, index) => {
    const report = reports[index];
    const stage = STAGE_OF[endpoint.source];
    if (!report || !stage || !isPayable(endpoint, report) || deps.payable?.(endpoint, report) === false) return;
    const key = `${endpoint.method} ${new URL(endpoint.url).href}`;
    queues[stage].push({
      endpoint,
      report,
      stage,
      index,
      sellerKey: sellerKeyFor(stage, new URL(endpoint.url).hostname, deps.salt),
      rotationKey: stage !== 'unsolicited' && key.length <= MAX_ROTATION_KEY ? key : null,
    });
  });

  for (const stage of ['fixture', 'buy'] as const) {
    const tried = (c: Candidate) => (c.rotationKey === null ? '' : (rotation.lastTried[c.rotationKey] ?? ''));
    queues[stage].sort((x, y) => compare(tried(x), tried(y)) || compare(x.rotationKey ?? x.endpoint.url, y.rotationKey ?? y.endpoint.url));
  }

  const settlements = deps.ledger.snapshot().settlementsBySeller;
  const limit = DEFAULT_POLICY.unsolicitedMaxSettlementsPerSeller;
  const seen = new Set<string>();
  const sellers: Candidate[] = [];
  for (const c of queues.unsolicited) {
    if ((settlements[c.sellerKey] ?? 0) >= limit || seen.has(c.sellerKey)) continue;
    seen.add(c.sellerKey);
    sellers.push(c);
  }
  sellers.sort((x, y) => (settlements[x.sellerKey] ?? 0) - (settlements[y.sellerKey] ?? 0) || compare(x.sellerKey, y.sellerKey));
  queues.unsolicited = sellers;
  return queues;
}

const labelOf = (c: Candidate): string => (c.stage === 'unsolicited' ? `seller ${c.sellerKey}` : `${c.endpoint.method} ${c.endpoint.url}`);

/**
 * One scheduled run: look at everything for free, then pay a few targets, a fixture then a buy route then a registered seller
 * in turn, until `maxPaidPerRun`, the time budget, or a refusal about the whole event. Everything it writes is either about our
 * own endpoints or aggregate; nothing names a seller nobody asked us to look at. What was spent is saved after every payment.
 */
export async function runBatch(deps: BatchDeps): Promise<BatchResult> {
  if (!deps.salt) throw new RangeError('a salt is required: without it the files could not keep sellers unrecognisable');
  const startedAt = deps.now().getTime();
  const outOfTime = () => deps.now().getTime() - startedAt >= deps.budgetMs;
  const maxPaid = Number.isFinite(deps.maxPaidPerRun) ? Math.max(0, Math.floor(deps.maxPaidPerRun)) : 0;

  const wrote = new Set<string>();
  const write = async (path: string, value: unknown) => {
    await deps.store.write(path, `${JSON.stringify(value, null, 2)}\n`);
    wrote.add(path);
  };
  const saveSpend = () => write(SPEND_PATH, SpendStateSchema.parse(deps.ledger.snapshot()));

  // Nothing is looked at until the saved state is known to be good.
  const cursor = await loadDiscoveryState(deps.store);
  const rotation = await loadRotationState(deps.store);

  const discovered = await deps.discover(cursor);
  const endpoints = mergeEndpoints(discovered.endpoints);
  const { reports, failed: scanFailures } = await scanAll(deps, endpoints, outOfTime);
  let failed = scanFailures;

  const queues = queuesFor(deps, endpoints, reports, rotation);
  const plan: { stage: Stage; label: string }[] = [];
  let paid = 0;

  rounds: for (;;) {
    let progressed = false;
    for (const stage of ROUND) {
      if ((deps.dryRun ? plan.length : paid) >= maxPaid || outOfTime()) break rounds;
      const candidate = queues[stage].shift();
      if (!candidate) continue;
      progressed = true;

      if (deps.dryRun) {
        plan.push({ stage, label: labelOf(candidate) });
        continue;
      }

      let result: { report: CheckReport; run: RunRecord };
      try {
        result = await deps.confirm(candidate.endpoint, candidate.report, stage);
      } catch {
        failed++;
        if (candidate.rotationKey) rotation.lastTried[candidate.rotationKey] = deps.now().toISOString();
        await saveSpend();
        continue;
      }

      reports[candidate.index] = result.report;
      if (result.run.payments.length > 0) paid++;
      const endsTheRun = result.report.verdicts.some((v) => v.kind === 'SKIPPED' && v.code !== undefined && RUN_ENDING_REFUSALS.has(v.code));
      if (!endsTheRun && candidate.rotationKey) rotation.lastTried[candidate.rotationKey] = deps.now().toISOString();

      await saveSpend(); // first: what was spent must be remembered even if writing anything after it fails
      const publishable = publicRun(result.run);
      if (publishable) {
        const valid = RunRecordSchema.safeParse(publishable);
        if (valid.success) await write(`runs/${valid.data.id}.json`, valid.data);
        else failed++;
      }
      if (endsTheRun) break rounds;
    }
    if (!progressed) break;
  }

  if (deps.dryRun) return { scanned: reports.filter((r) => r !== null).length, paid: 0, failed, wrote: [], plan };

  // The ecosystem's numbers are about other people's endpoints: our own fixtures, deliberately broken, are left out.
  const ecosystem = reports.filter((r, i): r is CheckReport => r !== null && endpoints[i]!.source !== 'fixture');
  await saveSpend();
  await write(ROTATION_PATH, RotationStateSchema.parse(rotation));
  await write(DISCOVERY_PATH, DiscoveryStateSchema.parse(discovered.cursor));
  await write(SUMMARY_PATH, ScanSummarySchema.parse(summarize(ecosystem, deps.now())));

  return { scanned: reports.filter((r) => r !== null).length, paid, failed, wrote: [...wrote].sort() };
}
