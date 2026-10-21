import { ExactEvmScheme } from '@x402/evm/exact/server';
import { paymentMiddlewareFromHTTPServer, x402HTTPResourceServer, x402ResourceServer } from '@x402/hono';
import type { FacilitatorClient } from '@x402/core/server';
import { ZERO_ADDRESS, type FindingCode } from '@railwalker/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isAddress } from 'viem';
import { BAD_ROUTES, NO_CORS_PATH, registerBadRoutes } from './bad';
import { goodAssets, PRICE, type FixtureNetwork } from './challenge';
import { DEFAULT_SLOW_MS, PAID_ROUTES, registerPaidRoutes } from './paid';

export interface FixtureDeps {
  facilitator: FacilitatorClient;
  payTo: `0x${string}`;
  network: FixtureNetwork;
  /** How long /paid/slow takes to answer after it has been paid. Default 20000. */
  slowMs?: number;
}

/** Each fixture route and the finding it is built to trigger; also sent as the `x-fixture-expect` header. */
export const FIXTURE_EXPECTATIONS: Record<string, FindingCode> = Object.fromEntries([
  ...Object.entries(BAD_ROUTES).map(([path, r]) => [path, r.expect]),
  ...Object.entries(PAID_ROUTES).map(([path, r]) => [path, r.expect]),
]);

/**
 * Deterministic x402 sellers for the demo and the tests: one correct (`/ok`), eight that are broken in a way a free scan can see
 * (`/bad/*`, no payment path), and four that take a real payment and then misbehave (`/paid/*`). Anyone can read what each is
 * meant to prove from FIXTURE_EXPECTATIONS, and a scan or a paid check of the same route must find exactly that.
 */
export function createFixtureApp(deps: FixtureDeps): Hono {
  if (!isAddress(deps.payTo, { strict: true }) || deps.payTo.toLowerCase() === ZERO_ADDRESS) {
    throw new Error('payTo must be a valid, non-zero address: the fixtures would otherwise burn the payments they take');
  }

  const app = new Hono();

  // Hono middleware only wraps the routes registered AFTER it. The one route that is deliberately unreadable from a browser is
  // therefore registered first, before the CORS middleware, and that holds wherever this app is mounted (a path comparison would not).
  registerBadRoutes(app, deps, (path) => path === NO_CORS_PATH);

  // Browsers must be able to read the 402 and the receipt of every other route.
  app.use('*', cors({ origin: '*', exposeHeaders: ['payment-required', 'payment-response', 'x-fixture-expect'] }));

  const server = new x402ResourceServer(deps.facilitator).register(deps.network, new ExactEvmScheme());
  const httpServer = new x402HTTPResourceServer(server, {
    'GET /ok': {
      accepts: goodAssets(deps.network).map((a) => ({
        scheme: 'exact',
        network: deps.network,
        payTo: deps.payTo,
        price: { asset: a.address, amount: PRICE, extra: { name: a.name, version: a.version } },
      })),
      description: 'Railwalker fixture: a correct seller',
      mimeType: 'application/json',
    },
  });

  // @x402/hono would start this at construction and process.exit(1) on a fatal configuration error. These fixtures live inside someone
  // else's process (a web app, a test run), so they initialise on the first /ok request instead, and answer 502 when they cannot.
  let ready: Promise<void> | null = null;
  const initialise = () =>
    (ready ??= httpServer.initialize().catch((err: unknown) => {
      ready = null; // try again next time rather than cache the failure
      throw err;
    }));
  app.use('/ok', async (c, next) => {
    try {
      await initialise();
    } catch {
      return c.json({ error: 'the fixture seller is not ready: its facilitator does not support this network' }, 502);
    }
    return next();
  });
  app.use(paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));
  app.get('/ok', (c) => c.json({ ok: true }));

  registerBadRoutes(app, deps, (path) => path !== NO_CORS_PATH);
  registerPaidRoutes(app, { ...deps, slowMs: deps.slowMs ?? DEFAULT_SLOW_MS });
  return app;
}
