import { ExactEvmScheme as ExactEvmServerScheme } from '@x402/evm/exact/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { ASSETS, type AssetSymbol } from '@railwalker/core';
import { MOCK_TX_HASH, appFetch, mockFacilitator, type MockFacilitator, type RecordedCall, type RecordingFetch } from '@railwalker/testkit';
import { Hono } from 'hono';

export const SELLER_PAY_TO = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B' as const;
export const SELLER_URL = 'https://seller.example/api/data';

const isPayment = (c: RecordedCall) => 'payment-signature' in c.headers || 'x-payment' in c.headers;

export interface Seller {
  fetch: RecordingFetch;
  facilitator: MockFacilitator;
  /** Requests that carried a payment header. */
  paidCalls: () => RecordedCall[];
}

const withPaidCalls = (fetch: RecordingFetch, facilitator: MockFacilitator): Seller => ({ fetch, facilitator, paidCalls: () => fetch.calls.filter(isPayment) });

/** The decoded payment header a seller received, for either protocol version. */
export const paymentOf = (c: RecordedCall) => decodePaymentSignatureHeader((c.headers['payment-signature'] ?? c.headers['x-payment'])!) as Record<string, any>;

export interface RealSellerOpts {
  /** Asset symbol -> price in atomic units. */
  prices: Partial<Record<AssetSymbol, string>>;
  facilitator?: MockFacilitator;
  /** Route-level extensions, e.g. eip2612GasSponsoring. */
  extensions?: Record<string, unknown>;
  body?: string;
}

/** The real @x402/hono middleware in front of a trivial handler, with the mock facilitator behind it. */
export function realSeller(opts: RealSellerOpts): Seller {
  const facilitator = opts.facilitator ?? mockFacilitator();
  const accepts = Object.entries(opts.prices).map(([symbol, amount]) => {
    const a = ASSETS[symbol as AssetSymbol];
    return {
      scheme: 'exact',
      network: 'eip155:42220' as const,
      payTo: SELLER_PAY_TO,
      price: { asset: a.address, amount, extra: { name: a.eip712Name, version: a.eip712Version, ...(a.method === 'permit2' ? { assetTransferMethod: 'permit2' } : {}) } },
    };
  });
  const route = { accepts, description: 'test data', mimeType: 'application/json', ...(opts.extensions ? { extensions: opts.extensions } : {}) };
  const server = new x402ResourceServer(facilitator).register('eip155:42220', new ExactEvmServerScheme());
  const app = new Hono();
  app.use(paymentMiddleware({ 'GET /api/data': route, 'POST /api/data': route }, server));
  app.get('/api/data', (c) => c.text(opts.body ?? '{"ok":true}'));
  app.post('/api/data', (c) => c.text(opts.body ?? '{"ok":true}'));
  return withPaidCalls(appFetch(app), facilitator);
}

export interface ManualPaid {
  req: Request;
  payment: Record<string, any>;
  /** What the facilitator said when asked to settle the payment the way a compliant seller would. */
  settle: () => Promise<Record<string, unknown>>;
}

export interface ManualSellerOpts {
  version: 1 | 2;
  /** Accepts exactly as they go on the wire for that version. */
  accepts: Record<string, unknown>[];
  facilitator?: MockFacilitator;
  /** Replaces the default paid behaviour (settle, then 200 with the receipt header). */
  onPaid?: (p: ManualPaid) => Response | Promise<Response>;
  /** Replaces the whole unpaid answer. */
  unpaid?: () => Response | Promise<Response>;
}

export function settlementHeaderFor(version: 1 | 2, settle: Record<string, unknown>): Record<string, string> {
  const name = version === 2 ? 'payment-response' : 'x-payment-response';
  return { [name]: encodePaymentResponseHeader(settle as never) };
}

/** A hand-built seller: any protocol version, any response shape, so edge cases the real middleware refuses to produce can be tested. */
export function manualSeller(opts: ManualSellerOpts): Seller {
  const facilitator = opts.facilitator ?? mockFacilitator();
  const app = new Hono();
  app.all('/api/data', async (c) => {
    const req = c.req.raw;
    const header = req.headers.get('payment-signature') ?? req.headers.get('x-payment');
    if (!header) {
      if (opts.unpaid) return opts.unpaid();
      if (opts.version === 1) return c.json({ x402Version: 1, error: 'X-PAYMENT header is required', accepts: opts.accepts }, 402);
      const required = { x402Version: 2, error: 'Payment required', resource: { url: SELLER_URL }, accepts: opts.accepts };
      return c.json({}, 402, { 'payment-required': encodePaymentRequiredHeader(required as never) });
    }
    const payment = decodePaymentSignatureHeader(header) as Record<string, any>;
    const network = opts.version === 2 ? payment.accepted?.network : payment.network;
    const requirements = (opts.accepts.find((a) => a.network === network) ?? opts.accepts[0]) as never;
    const settle = () => facilitator.settle(payment as never, requirements) as unknown as Promise<Record<string, unknown>>;
    if (opts.onPaid) return opts.onPaid({ req, payment, settle });
    return new Response('{"ok":true}', { status: 200, headers: settlementHeaderFor(opts.version, await settle()) });
  });
  return withPaidCalls(appFetch(app), facilitator);
}

export { MOCK_TX_HASH };
