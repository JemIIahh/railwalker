import { AGENT_DESCRIPTION, AGENT_NAME, buildRegistration } from '@railwalker/chain';
import { config } from '../../../lib/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FALLBACK_WEB_URL = 'https://github.com/JemIIahh/railwalker';

/** The agent's registration document, served from its own domain so the identity and the site vouch for each other. */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  const webUrl = config.siteUrl ?? (origin.startsWith('https://') ? origin : FALLBACK_WEB_URL);
  return new Response(JSON.stringify(buildRegistration({ name: AGENT_NAME, description: AGENT_DESCRIPTION, webUrl }), null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
