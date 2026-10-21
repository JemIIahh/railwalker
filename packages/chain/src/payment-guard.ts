import { DeadlineExceeded, readCapped, type Deadline } from '@railwalker/core';

export class SecondPaymentRefused extends Error {
  constructor() {
    super('refusing to send a second payment on one request');
    this.name = 'SecondPaymentRefused';
  }
}

export interface UnpaidAnswer {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  truncated: boolean;
}

export interface PaymentGuard {
  fetch: typeof fetch;
  /** A request carrying a payment header has been dispatched: from then on money may have moved. */
  paymentSent(): boolean;
  /** The network named in the payment header that was sent. */
  paymentNetwork(): string | null;
  /** The seller's unpaid 402 answer (capped), once there is one. */
  unpaid(): UnpaidAnswer | null;
  /** The response to the paid request, untouched. */
  paidResponse(): Response | null;
}

const PAYMENT_HEADERS = ['payment-signature', 'x-payment'];
/** Headers that describe the wire body, which the capped copy no longer is. */
const WIRE_HEADERS = ['content-length', 'content-encoding', 'transfer-encoding'];

function networkOf(header: string): string | null {
  try {
    const p = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { accepted?: { network?: unknown }; network?: unknown };
    const network = p.accepted?.network ?? p.network;
    return typeof network === 'string' ? network : null;
  } catch {
    return null;
  }
}

/**
 * Wraps the fetch that the x402 client pays through. It is the single place where three things are enforced, whatever the
 * client library does: at most one request ever carries a payment, nothing is sent once the deadline has passed, and a seller's
 * unpaid 402 is read through a size cap (the client library would otherwise buffer it whole).
 */
export function guardPayments(base: typeof fetch, deadline: Deadline, capBytes: number): PaymentGuard {
  let sent = false;
  let network: string | null = null;
  let unpaid: UnpaidAnswer | null = null;
  let paidResponse: Response | null = null;

  const guarded = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (deadline.hasExpired()) throw new DeadlineExceeded();
    const req = input instanceof Request && init === undefined ? input : new Request(input, init);
    const payment = PAYMENT_HEADERS.map((h) => req.headers.get(h)).find((v) => v);

    if (payment) {
      if (sent) throw new SecondPaymentRefused();
      sent = true; // before the request leaves: from here on money may move
      network = networkOf(payment);
    }

    const res = await deadline.race(base(req));
    if (payment) {
      paidResponse = res;
      return res;
    }
    if (res.status !== 402) return res;

    const body = await readCapped(res, capBytes, deadline, 'truncate');
    const text = body.ok ? body.text : '';
    unpaid = { status: res.status, headers: Object.fromEntries(res.headers), bodyText: text, truncated: body.ok && body.truncated };
    const headers = new Headers(res.headers);
    for (const h of WIRE_HEADERS) headers.delete(h);
    return new Response(text, { status: res.status, statusText: res.statusText, headers });
  }) as typeof fetch;

  return { fetch: guarded, paymentSent: () => sent, paymentNetwork: () => network, unpaid: () => unpaid, paidResponse: () => paidResponse };
}
