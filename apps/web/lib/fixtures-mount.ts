import { createFixtureApp, type FixtureDeps } from '@railwalker/fixtures';
import { Hono } from 'hono';

export const FIXTURES_BASE = '/api/fixtures';

/** The fixture sellers, served under /api/fixtures. */
export function mountFixtures(deps: FixtureDeps): Hono {
  return new Hono().basePath(FIXTURES_BASE).route('/', createFixtureApp(deps));
}
