import type { CheckReport, ScanRequest } from '@railwalker/scanner';
import type { RateLimiter } from './rate-limit';

export const MAX_URL_LENGTH = 2048;
export const MAX_BODY_LENGTH = 4096;
/** Per-field clipping bounds each value, not the sum: past this the report is sent without the seller's free-form data. */
export const MAX_RESPONSE_CHARS = 100_000;
const MAX_FINDINGS_WHEN_TRIMMED = 100;
const MAX_KEY_LENGTH = 64;

/** The caller: the first hop of x-forwarded-for (what the platform sets), then x-real-ip, then one shared key. Bounded in length. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const raw = forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
  return raw.slice(0, MAX_KEY_LENGTH);
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });

const bad = (error: string) => json({ error }, 400);

/** Verdicts, codes and messages survive; what the seller chose to say (the challenge, the evidence) does not. */
const trimmed = (r: CheckReport) => ({
  ...r,
  challenge: null,
  findings: r.findings.slice(0, MAX_FINDINGS_WHEN_TRIMMED).map((f) => ({ ...f, evidence: {} })),
  verdicts: r.verdicts.map((v) => ({ ...v, findings: [] })),
  patches: r.patches.slice(0, 20),
  truncated: true,
});

/** `GET /api/scan?url=&method=&body=`. Hostile input is a result (a verdict), never a crash; nothing of the target but the report is returned. */
export function createScanHandler(deps: { scan: (req: ScanRequest) => Promise<CheckReport>; limiter: RateLimiter }): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, { allow: 'GET' });

    // Before anything else is looked at: a request that only probes the parser still costs a token.
    const limit = deps.limiter.take(clientKey(req));
    if (!limit.ok) return json({ error: 'rate limited', retryAfterSec: limit.retryAfterSec }, 429, { 'retry-after': String(limit.retryAfterSec) });

    const params = new URL(req.url).searchParams;
    const once = (name: string): string | null | 'many' => (params.getAll(name).length > 1 ? 'many' : params.get(name));

    const url = once('url');
    if (url === 'many') return bad('url must be given once');
    if (!url) return bad('url is required');
    if (url.length > MAX_URL_LENGTH) return bad('url is too long');

    const rawMethod = once('method');
    if (rawMethod === 'many') return bad('method must be given once');
    const method = (rawMethod ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') return bad('method must be GET or POST');

    const rawBody = once('body');
    if (rawBody === 'many') return bad('body must be given once');
    let body: unknown;
    if (rawBody !== null && rawBody !== '') {
      if (method !== 'POST') return bad('body needs method POST');
      if (rawBody.length > MAX_BODY_LENGTH) return bad('body is too long');
      try {
        body = JSON.parse(rawBody);
      } catch {
        return bad('body must be valid JSON');
      }
    }

    let report: CheckReport;
    try {
      report = await deps.scan({ url, method, ...(body === undefined ? {} : { body }) });
    } catch {
      return json({ error: 'scan failed' }, 500); // never the reason: it may name paths or hosts of ours
    }
    return json(JSON.stringify(report).length > MAX_RESPONSE_CHARS ? trimmed(report) : report, 200);
  };
}
