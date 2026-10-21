import { handle } from 'hono/vercel';
import { config, getFixtureApp } from '../../../../lib/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** /paid/slow answers after 20 seconds, by design. */
export const maxDuration = 60;

function serve(req: Request): Response | Promise<Response> {
  const app = getFixtureApp();
  if (!app) {
    return Response.json({ error: 'the fixture sellers are not configured', reason: 'disabledReason' in config.fixtures ? config.fixtures.disabledReason : undefined }, { status: 503 });
  }
  return handle(app)(req);
}

export const GET = serve;
export const POST = serve;
