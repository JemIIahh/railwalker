import type { Config } from '@railwalker/chain';
import { parseSafeUrl } from '@railwalker/core';
import { endpointsFromBuyCatalog, fetchBuyCatalog } from './buy';
import { endpointsFromRegistration, listRegisteredAgents, type AgentLister } from './erc8004';
import { mergeEndpoints, type Endpoint } from './merge';

export interface DiscoverDeps {
  fetchImpl: typeof fetch;
  lister: AgentLister;
  cfg: Config;
  /** Reads the registration an agent points to. Null when it cannot be read. */
  loadRegistration: (uri: string) => Promise<unknown | null>;
  /** Milliseconds, from any starting point: only differences are used. */
  now: () => number;
}

export interface DiscoverOptions {
  /** Our own endpoints, when the site is deployed. They come first and win over everything else. */
  fixtures?: Endpoint[];
  /** Where the registry walk starts. */
  nextId: bigint;
  /** Ids asked about this run. */
  maxIds: number;
  /** Registrations read this run: each one is a stranger's document and a few network calls. */
  maxRegistrations: number;
  concurrency: number;
  /** For reading registrations. No new one is started once it is spent. */
  budgetMs: number;
}

export interface Discovery {
  endpoints: Endpoint[];
  /** Where the next run's registry walk should start. */
  nextId: bigint;
  /** What went wrong, in words that name no seller. Discovery never fails because one source did. */
  problems: string[];
}

const MAX_CONCURRENCY = 16;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * What to look at this run: our fixtures, then buy's catalog, then the endpoints of ERC-8004 agents that say they support x402.
 * One source being down is a problem to report, not a failure. The registry cursor only ever moves past agents that were
 * actually read, so an agent that was found but not read (the budget ran out) is read next time instead of being skipped.
 */
export async function discoverEndpoints(deps: DiscoverDeps, o: DiscoverOptions): Promise<Discovery> {
  const problems: string[] = [];

  let buy: Endpoint[] = [];
  try {
    buy = endpointsFromBuyCatalog(await fetchBuyCatalog(deps.fetchImpl));
  } catch (err) {
    problems.push(`buy's catalog could not be read (${message(err)})`);
  }

  let registered: Endpoint[] = [];
  let nextId = o.nextId;
  try {
    const walk = await listRegisteredAgents(deps.lister, deps.cfg, { nextId: o.nextId, maxIds: o.maxIds });
    const { agents } = walk;
    const limit = Math.min(agents.length, Math.max(0, Math.floor(o.maxRegistrations) || 0));
    const found: (Endpoint[] | undefined)[] = [];
    let started = 0;
    let unreadable = 0;
    const startedAt = deps.now();

    const work = async () => {
      for (;;) {
        if (started >= limit || deps.now() - startedAt >= o.budgetMs) return;
        const i = started++;
        const agent = agents[i]!;
        try {
          const registration = await deps.loadRegistration(agent.agentUri);
          if (registration === null) unreadable++;
          else found[i] = endpointsFromRegistration(String(agent.agentId), registration);
        } catch {
          unreadable++;
        }
      }
    };
    const workers = Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(o.concurrency) || 1));
    await Promise.all(Array.from({ length: workers }, work));

    registered = found.flatMap((list) => list ?? []);
    if (unreadable > 0) problems.push(`${unreadable} registration${unreadable === 1 ? '' : 's'} could not be read`);
    // Every agent before `started` was attempted, whichever finished first; the ones after it were never started.
    nextId = started === agents.length ? walk.nextId : started === 0 ? o.nextId : agents[started - 1]!.agentId + 1n;
  } catch (err) {
    problems.push(`the registry could not be read (${message(err)})`);
  }

  return { endpoints: mergeEndpoints(o.fixtures ?? [], buy, registered), nextId, problems };
}

const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Our own endpoints under the base URL of the deployed fixtures app. The base is vetted like any URL that will be scanned and
 * paid (https, a public host, no credentials), and each path must be a plain absolute path, so nothing can climb out of the base.
 */
export function fixtureEndpoints(baseUrl: string, paths: readonly string[]): Endpoint[] {
  const base = parseSafeUrl(baseUrl);
  if (base.search !== '' || base.hash !== '') throw new Error('the base URL must have no query or fragment: the paths would end up inside it');
  const root = `${base.origin}${base.pathname.replace(/\/+$/, '')}`;
  return paths.map((path) => {
    const segments = path.split('/');
    if (segments[0] !== '' || segments.length < 2 || !segments.slice(1).every((s) => PATH_SEGMENT.test(s) && s !== '.' && s !== '..')) {
      throw new Error(`a fixture path must be a plain absolute path like /paid/x, not ${JSON.stringify(path)}`);
    }
    return { url: `${root}${path}`, method: 'GET' as const, source: 'fixture' as const, capabilityId: `fixture${path}`, description: `Railwalker fixture ${path}` };
  });
}
