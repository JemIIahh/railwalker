import { createHash } from 'node:crypto';
import {
  CELO_MAINNET,
  DeadlineExceeded,
  UnsafeUrlError,
  createDeadline,
  discard,
  isPrivateAddress,
  makeFinding,
  parseChallenge,
  parseSafeUrl,
  patchFor,
  readCapped,
  runLints,
  verdictFromFindings,
  type AssetSymbol,
  type Challenge,
  type Deadline,
  type Finding,
  type Patch,
  type SkipReason,
  type Verdict,
} from '@railwalker/core';
import { DEFAULT_SLOW_MS, DEFAULT_TIMEOUT_MS, MAX_BODY_BYTES } from './net';
import type { CheckReport, ScanDeps, ScanRequest } from './types';

const MAX_REDIRECTS = 2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** A browser buyer's origin, so the 402 shows whether it would be readable cross-origin. `.invalid` can never resolve. */
const CORS_PROBE_ORIGIN = 'https://railwalker.invalid';
const MAX_URL_ECHO = 2048;

type Fetched =
  | { kind: 'response'; status: number; headers: Record<string, string>; bodyText: string }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'failed'; finding: Finding };

const skipped = (reason: SkipReason): Fetched => ({ kind: 'skipped', reason });

/** The URL as shown in reports: credentials stripped, length bounded, and an unparseable string never echoed back. */
function displayUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    return url.href.slice(0, MAX_URL_ECHO);
  } catch {
    return '[unparseable url]';
  }
}

/**
 * Follows at most MAX_REDIRECTS hops by hand, because every hop must pass the same checks as the first: a safe URL, no private
 * address behind the host, no opt-out. A violation at the first hop is `unsafe_url`; after a redirect it is `redirect_blocked`.
 */
async function followRedirects(deps: ScanDeps, req: ScanRequest & { method: 'GET' | 'POST' }, deadline: Deadline): Promise<Fetched> {
  let url = req.url;
  let method = req.method;
  let body = method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined;

  for (let hop = 0; ; hop++) {
    const blocked = skipped(hop === 0 ? 'unsafe_url' : 'redirect_blocked');
    let target: URL;
    try {
      target = parseSafeUrl(url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) return blocked;
      throw err;
    }

    const addresses = await deadline.race(deps.resolveHost(target.hostname));
    if (addresses.length === 0) throw new Error('host did not resolve');
    if (addresses.some(isPrivateAddress)) return blocked;
    if (await deadline.race(deps.isOptedOut(target.hostname))) return skipped('opted_out');

    const res = await deadline.race(
      deps.fetchImpl(target.href, {
        method,
        body,
        redirect: 'manual',
        signal: deadline.signal,
        headers: {
          'user-agent': deps.userAgent,
          accept: 'application/json',
          origin: CORS_PROBE_ORIGIN,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      }),
    );

    const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get('location') : null;
    if (location === null) {
      const read = await readCapped(res, MAX_BODY_BYTES, deadline, 'refuse');
      if (!read.ok) return skipped('response_too_large');
      return { kind: 'response', status: res.status, headers: Object.fromEntries(res.headers), bodyText: read.text };
    }

    discard(res);
    if (hop >= MAX_REDIRECTS) return skipped('redirect_blocked');
    try {
      url = new URL(location, target).href;
    } catch {
      return skipped('redirect_blocked');
    }
    // What fetch itself does: 303, and 301/302 after a POST, continue as a body-less GET.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
  }
}

function failureFinding(err: unknown, deadline: Deadline): Finding {
  if (err instanceof DeadlineExceeded || deadline.hasExpired()) {
    return makeFinding('challenge_timeout', 'No complete answer arrived before the scan deadline.');
  }
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  const cause = err instanceof Error && typeof err.cause === 'object' && err.cause !== null && 'code' in err.cause ? String(err.cause.code) : undefined;
  return makeFinding('not_x402', `The endpoint could not be read: ${message}.`, { error: message, ...(cause ? { code: cause } : {}) });
}

async function fetchChallenge(deps: ScanDeps, req: ScanRequest & { method: 'GET' | 'POST' }, deadline: Deadline): Promise<Fetched> {
  try {
    return await followRedirects(deps, req, deadline);
  } catch (err) {
    return { kind: 'failed', finding: failureFinding(err, deadline) };
  } finally {
    deadline.clear();
  }
}

/** Browsers can read the 402 only if the seller allows the origin, and, for the v2 `payment-required` header, exposes it. */
function corsFindings(headers: Record<string, string>): Finding[] {
  if (headers['access-control-allow-origin'] === undefined) {
    return [makeFinding('cors_missing', 'The 402 has no Access-Control-Allow-Origin header, so browser-based buyers cannot read it.')];
  }
  if (headers['payment-required'] !== undefined) {
    const exposed = (headers['access-control-expose-headers'] ?? '').split(',').map((h) => h.trim().toLowerCase());
    if (!exposed.includes('payment-required') && !exposed.includes('*')) {
      return [makeFinding('cors_header_not_exposed', 'The challenge travels in the payment-required header, but Access-Control-Expose-Headers does not list it.')];
    }
  }
  return [];
}

/** One verdict per asset the endpoint offers on Celo mainnet. Endpoint-level findings count against every asset. */
function verdictsFor(challenge: Challenge, findings: Finding[]): Verdict[] {
  const symbols = new Set<AssetSymbol>();
  for (const a of challenge.accepts) if (a.chainId === CELO_MAINNET && a.assetInfo) symbols.add(a.assetInfo.symbol);
  for (const f of findings) if (f.assetSymbol) symbols.add(f.assetSymbol);
  if (symbols.size === 0) return [verdictFromFindings({ basis: 'PREDICTED', findings })];
  return [...symbols].map((assetSymbol) =>
    verdictFromFindings({ basis: 'PREDICTED', assetSymbol, findings: findings.filter((f) => !f.assetSymbol || f.assetSymbol === assetSymbol) }),
  );
}

export function patchesFor(findings: Finding[]): Patch[] {
  const seen = new Set<string>();
  const out: Patch[] = [];
  for (const f of findings) {
    const patch = patchFor(f);
    const key = `${f.code}:${f.assetSymbol ?? ''}`;
    if (patch && !seen.has(key)) {
      seen.add(key);
      out.push(patch);
    }
  }
  return out;
}

/** Free: one unpaid request per hop, never a payment. Hostile input (bad URLs, huge or endless bodies, redirects) never throws. */
export async function scanEndpoint(deps: ScanDeps, request: ScanRequest): Promise<CheckReport> {
  // Anything that is not a POST is a GET, so a scan can never send a side-effect verb.
  const req = { ...request, method: request.method === 'POST' ? ('POST' as const) : ('GET' as const) };
  const started = deps.now();
  const scannedAt = started.toISOString();
  const url = displayUrl(req.url);
  const id = createHash('sha256').update(`${req.method} ${url} ${scannedAt}`).digest('hex').slice(0, 16);

  const fetched = await fetchChallenge(deps, req, createDeadline(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  const latencyMs = Math.max(0, deps.now().getTime() - started.getTime());
  const finish = (r: { status?: number; challenge?: Challenge; findings: Finding[]; verdicts: Verdict[] }): CheckReport => ({
    id,
    endpoint: { url, method: req.method },
    scannedAt,
    status: r.status ?? null,
    latencyMs,
    challenge: r.challenge ?? null,
    findings: r.findings,
    verdicts: r.verdicts,
    patches: patchesFor(r.findings),
  });
  const failed = (findings: Finding[], status?: number) => finish({ status, findings, verdicts: [verdictFromFindings({ basis: 'PREDICTED', findings })] });

  if (fetched.kind === 'skipped') {
    return finish({ findings: [], verdicts: [{ kind: 'SKIPPED', code: fetched.reason, basis: 'PREDICTED', findings: [] }] });
  }
  if (fetched.kind === 'failed') return failed([fetched.finding]);

  const parsed = parseChallenge({ status: fetched.status, headers: fetched.headers, bodyText: fetched.bodyText });
  if (!parsed.ok) {
    const detail = parsed.detail;
    return failed([makeFinding('not_x402', `The endpoint did not return an x402 challenge: ${detail}.`, { status: fetched.status, detail })], fetched.status);
  }

  const { challenge } = parsed;
  const slowMs = deps.slowMs ?? DEFAULT_SLOW_MS;
  const findings = [
    ...runLints(challenge, { agentWallet: req.agentWallet }),
    ...corsFindings(fetched.headers),
    ...(latencyMs > slowMs ? [makeFinding('challenge_slow', `The challenge took ${latencyMs} ms to arrive (threshold ${slowMs} ms).`, { latencyMs, slowMs })] : []),
  ];
  return finish({ status: fetched.status, challenge, findings, verdicts: verdictsFor(challenge, findings) });
}
