import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { FindingCode } from '@railwalker/core';
import type { Hono } from 'hono';
import { challenge, goodAccepts, type FixtureNetwork } from './challenge';

export const DEFAULT_SLOW_MS = 20_000;

const JSON_HEADERS = { 'content-type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PaidRoute {
  expect: FindingCode;
  respond: (slowMs: number) => Response | Promise<Response>;
}

/** What each route does AFTER it has taken the money. */
export const PAID_ROUTES: Record<string, PaidRoute> = {
  '/paid/500': { expect: 'paid_not_delivered', respond: () => new Response('{"error":"internal error"}', { status: 500, headers: JSON_HEADERS }) },
  '/paid/empty': { expect: 'delivered_empty', respond: () => new Response('', { status: 200, headers: JSON_HEADERS }) },
  '/paid/bad-json': { expect: 'delivered_invalid_json', respond: () => new Response('{"ok":', { status: 200, headers: JSON_HEADERS }) },
  '/paid/slow': {
    expect: 'too_slow',
    respond: async (slowMs) => {
      await sleep(slowMs);
      return new Response('{"ok":true}', { status: 200, headers: JSON_HEADERS });
    },
  },
};

/**
 * Their challenge is a correct one, so a scan is clean and a real buyer pays. Then they verify, settle and answer badly. The standard
 * middleware only settles after a successful handler, so this order (verify, settle, respond) is written out by hand, and the
 * settlement receipt is returned whatever the response is: the buyer must see that the money moved.
 */
export function registerPaidRoutes(app: Hono, deps: { facilitator: FacilitatorClient; payTo: string; network: FixtureNetwork; slowMs: number }): void {
  const accepts = goodAccepts(deps.network, deps.payTo);

  for (const [path, route] of Object.entries(PAID_ROUTES)) {
    app.get(path, async (c) => {
      const refuse = (error: string) => challenge(c, accepts, { expect: route.expect, error });

      const header = c.req.header('payment-signature');
      if (!header) return challenge(c, accepts, { expect: route.expect });

      let payment: PaymentPayload;
      try {
        payment = decodePaymentSignatureHeader(header);
      } catch {
        return refuse('payment header is not a payment');
      }
      const chosen = accepts.find((a) => a.asset.toLowerCase() === String(payment?.accepted?.asset).toLowerCase() && a.network === payment?.accepted?.network);
      if (!chosen) return refuse('payment does not match an accepted option');
      const requirements = chosen as unknown as PaymentRequirements;

      try {
        const verified = await deps.facilitator.verify(payment, requirements);
        if (!verified.isValid) return refuse(verified.invalidReason ?? 'payment is not valid');
        const settled = await deps.facilitator.settle(payment, requirements);
        const receipt = { 'payment-response': encodePaymentResponseHeader(settled), 'x-fixture-expect': route.expect };
        if (!settled.success) return c.json({}, 402, receipt);

        const res = await route.respond(deps.slowMs);
        for (const [k, v] of Object.entries(receipt)) res.headers.set(k, v);
        return res;
      } catch {
        return refuse('the facilitator is unavailable');
      }
    });
  }
}
