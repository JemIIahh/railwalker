import { defaultScanDeps, scanEndpoint, type CheckReport, type ScanRequest } from '@railwalker/scanner';
import { HTTPFacilitatorClient } from '@x402/core/server';
import type { Hono } from 'hono';
import { authHeaders, webConfig } from './config';
import { mountFixtures } from './fixtures-mount';
import { tokenBucket, type RateLimiter } from './rate-limit';

/** The server's wiring, built once per process from the environment. Nothing here can pay: the site holds no key. */
export const config = webConfig(process.env);

export const realScan = (req: ScanRequest): Promise<CheckReport> => scanEndpoint(defaultScanDeps(), req);

let limiter: RateLimiter | undefined;
/** Ten scans, refilling ten a minute, per caller: enough to try the product, too little to use it as a request cannon. */
export const scanLimiter = (): RateLimiter => (limiter ??= tokenBucket({ capacity: 10, refillPerSec: 10 / 60, now: Date.now }));

let fixtureApp: Hono | undefined;
/** The fixture sellers, or null when no valid payee is configured. */
export function getFixtureApp(): Hono | null {
  if (!('payTo' in config.fixtures)) return null;
  fixtureApp ??= mountFixtures({
    facilitator: new HTTPFacilitatorClient({ url: config.facilitatorUrl, createAuthHeaders: authHeaders(config.x402ApiKey) && (async () => authHeaders(config.x402ApiKey)!) }),
    payTo: config.fixtures.payTo,
    network: config.fixtureNetwork,
  });
  return fixtureApp;
}
