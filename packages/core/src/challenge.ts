import { assetByAddress, chainIdOf, type AssetInfo } from './assets';

export interface Accept {
  scheme: string;
  /** As advertised: 'celo' (v1) or 'eip155:42220' (v2). */
  network: string;
  chainId: number | null;
  asset: string;
  assetInfo: AssetInfo | null;
  /** v1 reads `maxAmountRequired`, v2 reads `amount`; empty string when the seller omitted it. */
  amountAtomic: string;
  payTo: string;
  maxTimeoutSeconds: number | null;
  extra: Record<string, unknown>;
}

export interface Challenge {
  version: 1 | 2;
  accepts: Accept[];
  extensions: Record<string, unknown>;
  resource: { url?: string; description?: string; mimeType?: string };
  hasOutputSchema: boolean;
}

export type ParseResult = { ok: true; challenge: Challenge } | { ok: false; code: 'not_x402'; detail: string };

const fail = (detail: string): ParseResult => ({ ok: false, code: 'not_x402', detail });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function toAccept(a: Record<string, unknown>, version: 1 | 2): Accept {
  const network = String(a.network ?? '');
  const asset = String(a.asset ?? '');
  const amountRaw = version === 1 ? a.maxAmountRequired : a.amount;
  const amountAtomic =
    typeof amountRaw === 'string' ? amountRaw : typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? String(amountRaw) : '';
  return {
    scheme: String(a.scheme ?? ''),
    network,
    chainId: chainIdOf(network),
    asset,
    assetInfo: assetByAddress(asset),
    amountAtomic,
    payTo: String(a.payTo ?? ''),
    maxTimeoutSeconds: typeof a.maxTimeoutSeconds === 'number' ? a.maxTimeoutSeconds : null,
    extra: isObject(a.extra) ? a.extra : {},
  };
}

/** Parse an HTTP 402 response into a normalised challenge. The `payment-required` header (base64 JSON) wins over the body. */
export function parseChallenge(input: { status: number; headers: Record<string, string>; bodyText: string }): ParseResult {
  if (input.status !== 402) return fail(`expected HTTP 402, got ${input.status}`);

  let raw: unknown;
  const header = input.headers['payment-required'];
  if (header) {
    try {
      raw = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    } catch {
      return fail('payment-required header is not base64-encoded JSON');
    }
  } else {
    try {
      raw = JSON.parse(input.bodyText);
    } catch {
      return fail('402 body is not JSON');
    }
  }

  if (!isObject(raw)) return fail('402 payload is not a JSON object');
  const version = raw.x402Version;
  if (version !== 1 && version !== 2) return fail(`unsupported x402Version ${JSON.stringify(version)}`);
  if (!Array.isArray(raw.accepts)) return fail('payload has no accepts array');

  const rawAccepts = raw.accepts.filter(isObject);
  const accepts = rawAccepts.map((a) => toAccept(a, version));

  let resource: Challenge['resource'] = {};
  if (version === 2 && isObject(raw.resource)) {
    resource = { url: str(raw.resource.url), description: str(raw.resource.description), mimeType: str(raw.resource.mimeType) };
  } else if (version === 1 && rawAccepts[0]) {
    resource = { url: str(rawAccepts[0].resource), description: str(rawAccepts[0].description), mimeType: str(rawAccepts[0].mimeType) };
  }

  const hasOutputSchema =
    rawAccepts.some((a) => a.outputSchema != null) || (isObject(raw.resource) && raw.resource.outputSchema != null);

  return {
    ok: true,
    challenge: {
      version,
      accepts,
      extensions: isObject(raw.extensions) ? raw.extensions : {},
      resource,
      hasOutputSchema,
    },
  };
}
