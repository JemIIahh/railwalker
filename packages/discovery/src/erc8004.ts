import { clipText, parseSafeUrl } from '@railwalker/core';
import { IDENTITY_ABI, REGISTRIES, type Config } from '@railwalker/chain';
import { getAddress, isAddress } from 'viem';
import type { Endpoint } from './merge';

const CHUNK = 100;
/** loadRegistration reads at most 256 KB; a data: URI of that size is about this many characters. Longer is not an agent worth reading. */
const MAX_URI_CHARS = 350_000;
const MAX_ENDPOINTS_PER_AGENT = 5;

interface TokenUriCall {
  address: `0x${string}`;
  abi: typeof IDENTITY_ABI;
  functionName: 'tokenURI';
  args: readonly [bigint];
}
type TokenUriResult = { status: 'success'; result: unknown } | { status: 'failure'; error: unknown };

/** What listRegisteredAgents needs from a viem public client. */
export interface AgentLister {
  multicall(args: { contracts: readonly TokenUriCall[]; allowFailure: true }): Promise<readonly TokenUriResult[]>;
}

/**
 * Walks the identity registry upwards from `nextId`, asking tokenURI for a hundred ids at a time (one RPC call each; the registry
 * is read by id, not by event, which would hit the 50,000-block eth_getLogs limit). An id nobody owns makes its call fail, so a
 * chunk in which every call fails is the end of the registry and the walk stops there; so does the budget `maxIds`.
 *
 * `nextId` is where the next walk should start: one past the highest id that exists. Not one past the last id tried: at the end
 * of the registry that would jump over ids nobody has registered yet, and they would never be looked at. (The cost: a gap of
 * unowned ids as long as a chunk would stop the walk behind it. Registry ids are sequential, so none is expected.)
 */
export async function listRegisteredAgents(
  client: AgentLister,
  cfg: Config,
  from: { nextId: bigint; maxIds: number },
): Promise<{ agents: { agentId: bigint; agentUri: string }[]; nextId: bigint }> {
  if (from.nextId < 0n) throw new RangeError('nextId must not be negative');
  if (!Number.isFinite(from.maxIds)) throw new RangeError('maxIds must be a finite number');
  const budget = Math.max(0, Math.floor(from.maxIds));
  const address = REGISTRIES[cfg.network].identity;

  const agents: { agentId: bigint; agentUri: string }[] = [];
  let cursor = from.nextId;
  let nextId = from.nextId;
  for (let tried = 0; tried < budget; ) {
    const size = Math.min(CHUNK, budget - tried);
    const ids = Array.from({ length: size }, (_, i) => cursor + BigInt(i));
    const results = await client.multicall({
      contracts: ids.map((id) => ({ address, abi: IDENTITY_ABI, functionName: 'tokenURI' as const, args: [id] as const })),
      allowFailure: true,
    });

    let existing = 0;
    ids.forEach((id, i) => {
      const result = results[i];
      if (result?.status !== 'success') return;
      existing++;
      nextId = id + 1n; // ids ascend, so the last one that exists is the highest
      const uri = result.result;
      if (typeof uri === 'string' && uri !== '' && uri.length <= MAX_URI_CHARS) agents.push({ agentId: id, agentUri: uri });
    });

    cursor += BigInt(size);
    tried += size;
    if (existing === 0) break;
  }
  return { agents, nextId };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An https URL the scanner would accept, in the form URL writes it; undefined for anything else. */
function httpsUrl(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string' || candidate.length > 2048) return undefined;
  try {
    return parseSafeUrl(candidate).href;
  } catch {
    return undefined;
  }
}

/** Entries of a services list (current format: `endpoint`) or an endpoints list (older format: `url`). */
function* listedUrls(list: unknown): Generator<string | undefined> {
  if (!Array.isArray(list)) return;
  for (const entry of list.slice(0, 200)) {
    if (isRecord(entry)) yield httpsUrl(entry.endpoint ?? entry.url);
  }
}

/**
 * The https endpoints an agent lists, when its registration says it supports x402 (only a true counts). The registration is a
 * stranger's document: at most five endpoints are taken, each one a scan, and the ones the scanner would refuse are dropped here.
 * The method is GET: a registration does not say, and a POST-only route simply reports that it is not an x402 GET endpoint.
 */
export function endpointsFromRegistration(agentId: string, reg: unknown): Endpoint[] {
  if (!/^\d{1,78}$/.test(agentId) || !isRecord(reg) || reg.x402Support !== true) return [];
  const description = typeof reg.description === 'string' ? clipText(reg.description) : undefined;
  const agentWallet = typeof reg.agentWallet === 'string' && isAddress(reg.agentWallet) ? getAddress(reg.agentWallet) : undefined;

  const endpoints: Endpoint[] = [];
  const seen = new Set<string>();
  for (const url of [...listedUrls(reg.services), ...listedUrls(reg.endpoints)]) {
    if (endpoints.length >= MAX_ENDPOINTS_PER_AGENT) break;
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    endpoints.push({
      url,
      method: 'GET',
      source: 'erc8004',
      agentId,
      ...(description === undefined ? {} : { description }),
      ...(agentWallet === undefined ? {} : { agentWallet }),
    });
  }
  return endpoints;
}
