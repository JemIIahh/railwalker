import { makeFinding, shapeMatches, shapeOf, type Finding, type FindingCode, type Shape } from '@railwalker/core';

export interface DeliveryInput {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  /** The mimeType the challenge advertised. */
  mimeType?: string;
  learnedShape?: Shape | null;
  latencyMs: number;
  tooSlowMs: number;
  /** The body was cut at the size cap, so it cannot be judged as JSON. */
  truncated?: boolean;
}

const confirmed = (code: FindingCode, message: string, evidence: Record<string, unknown> = {}) => makeFinding(code, message, evidence, { basis: 'CONFIRMED' });

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** What came back for money that settled. Every finding is CONFIRMED: a real payment backs it. */
export function verifyDelivery(a: DeliveryInput): Finding[] {
  if (a.status < 200 || a.status >= 300) {
    return [confirmed('paid_not_delivered', `The payment settled but the seller answered HTTP ${a.status}.`, { status: a.status })];
  }

  const out: Finding[] = [];
  if (a.bodyText.trim() === '') {
    out.push(confirmed('delivered_empty', 'The payment settled and the response body is empty.', { status: a.status }));
  } else if (!a.truncated) {
    const expectsJson = /json/i.test(a.mimeType ?? '') || /json/i.test(a.headers['content-type'] ?? '');
    const body = parse(a.bodyText);
    if (expectsJson && !body.ok) {
      out.push(confirmed('delivered_invalid_json', 'The seller promised JSON and the body is not valid JSON.', { bytes: a.bodyText.length }));
    } else if (a.learnedShape) {
      // A body that was JSON before and no longer parses is drift at the top level.
      const missingKeys = body.ok ? shapeMatches(a.learnedShape, shapeOf(body.value)).missingKeys : ['$'];
      if (missingKeys.length > 0) {
        out.push(confirmed('schema_mismatch', 'The response no longer has the shape this endpoint returned before.', { missingKeys }));
      }
    }
  }

  if (a.latencyMs > a.tooSlowMs) {
    out.push(confirmed('too_slow', `The paid response took ${a.latencyMs} ms (limit ${a.tooSlowMs} ms).`, { latencyMs: a.latencyMs, tooSlowMs: a.tooSlowMs }));
  }
  return out;
}
