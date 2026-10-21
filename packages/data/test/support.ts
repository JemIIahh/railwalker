import { fakeFetch, v2MultiAssetChallenge } from '@railwalker/testkit';
import { RunRecorder, scanEndpoint, type CheckReport, type RunRecord } from '@railwalker/scanner';
import type { Stage, Verdict } from '@railwalker/core';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required' };
const NOW = () => new Date('2026-10-22T12:00:00Z');

export const payToFor = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as `0x${string}`;

/** A real scan report: the real scanner against a fake seller on `host`. */
export async function reportFor(host: string, over: { i?: number; amount?: string; path?: string; challenge?: unknown; cors?: boolean } = {}): Promise<CheckReport> {
  const url = `https://${host}${over.path ?? '/api/data'}`;
  const challenge =
    over.challenge ??
    ({ ...v2MultiAssetChallenge, accepts: v2MultiAssetChallenge.accepts.map((a) => ({ ...a, amount: over.amount ?? '5000', payTo: payToFor(over.i ?? 1) })) });
  const f = fakeFetch({ [url]: () => new Response('{}', { status: 402, headers: { 'payment-required': b64(challenge), ...(over.cors === false ? {} : CORS) } }) });
  return scanEndpoint({ fetchImpl: f, resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: NOW, userAgent: 't' }, { url, method: 'GET' });
}

/** A real run record, as the recorder produces it. */
export function runOf(kind: Stage, verdicts: Verdict[] = []): RunRecord {
  const rec = new RunRecorder(NOW, kind, { url: 'https://fixtures.example/api/fixtures/ok', method: 'GET' });
  rec.step('challenge', true, '402 challenge parsed (v2, 3 accepts)', { status: 402 });
  rec.step('wallet', true, 'USAT: reserved $0.0050');
  rec.step('settle', true, 'USAT: settled', { txHash: `0x${'ab'.repeat(32)}` });
  rec.step('verdict', true, 'USAT: PASS (confirmed)');
  rec.payment({ asset: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', symbol: 'USAT', amountAtomic: '5000', payTo: payToFor(1), txHash: `0x${'ab'.repeat(32)}` });
  return rec.finish(verdicts);
}
