import { realScan, scanLimiter } from '../../../lib/deps';
import { createScanHandler } from '../../../lib/scan-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const handler = createScanHandler({ scan: realScan, limiter: scanLimiter() });

export const GET = (req: Request) => handler(req);
/** Anything but GET gets the handler's JSON 405 rather than a bare one. */
export const POST = GET;
