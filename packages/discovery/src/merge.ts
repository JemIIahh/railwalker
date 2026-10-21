import type { EndpointFacts } from '@railwalker/core';

/** Something to scan and perhaps pay: where it was found, and what is known about who runs it. */
export interface Endpoint extends EndpointFacts {
  /** A minimal valid request body built from the capability's input schema (POST endpoints). */
  bodyTemplate?: unknown;
  /** The ERC-8004 agent id, in decimal, when the endpoint belongs to a registered agent. */
  agentId?: string;
  /** The wallet the agent says it is paid at; null when it was looked up and there is none. */
  agentWallet?: string | null;
}

/** Hosts are not case sensitive and a bare origin is the same as its slash, so both are written the way URL writes them. */
function keyOf(e: Endpoint): string {
  try {
    return `${e.method} ${new URL(e.url).href}`;
  } catch {
    return `${e.method} ${e.url}`;
  }
}

/** Every endpoint once, deduped on method and URL. The first list that has an endpoint decides how it is described. */
export function mergeEndpoints(...lists: Endpoint[][]): Endpoint[] {
  const seen = new Set<string>();
  const merged: Endpoint[] = [];
  for (const list of lists) {
    for (const endpoint of list) {
      const key = keyOf(endpoint);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(endpoint);
    }
  }
  return merged;
}
