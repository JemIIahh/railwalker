import { lookup } from 'node:dns/promises';
import { RAILWALKER_USER_AGENT, createDeadline, discard, isPrivateAddress, parseSafeUrl, readCapped } from '@railwalker/core';
import { encodeFunctionData, getAddress, isAddress, parseEventLogs, type Hash } from 'viem';
import { ConfigError, type Config } from './config';
import { sendTagged, type Clients, type FeeSymbol } from './wallet';
import type { ChainReader } from './x402-buyer';

/** The ERC-8004 registries as deployed on Celo (checked against the contracts on Blockscout). */
export const REGISTRIES = {
  mainnet: { identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' },
  sepolia: { identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e', reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713' },
} as const;

/** Only what is used, as deployed. Note the feedback tags are strings: Celopedia's bytes32 table is wrong. */
export const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'getAgentWallet',
    inputs: [
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [
      { name: '', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'agentURI', type: 'string' },
    ],
    outputs: [
      { name: 'agentId', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [
      { name: '', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
] as const;

export const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'NewFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: false },
      { name: 'value', type: 'int128', indexed: false },
      { name: 'valueDecimals', type: 'uint8', indexed: false },
      { name: 'indexedTag1', type: 'string', indexed: true },
      { name: 'tag1', type: 'string', indexed: false },
      { name: 'tag2', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'feedbackURI', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

const REGISTRATION_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
const DATA_URI_PREFIX = 'data:application/json;base64,';
const MAX_AGENT_URI_CHARS = 16 * 1024;
const MAX_REGISTRATION_BYTES = 256 * 1024;
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const IPFS_PATH = /^[A-Za-z0-9]+(\/[A-Za-z0-9._~-]+)*$/;
const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

export interface RegistrationMeta {
  name: string;
  description: string;
  webUrl: string;
  mcpUrl?: string;
  image?: string;
}

const isHttps = (v: string) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/** The current registration-v1 shape. A registration is permanent, so a malformed one is refused before it can be written. */
export function buildRegistration(m: RegistrationMeta): Record<string, unknown> {
  if (m.name.trim() === '' || m.name.length > 100) throw new TypeError('name must be 1 to 100 characters');
  if (m.description.length > 1000) throw new TypeError('description must be at most 1000 characters');
  if (!isHttps(m.webUrl)) throw new TypeError('webUrl must be an https URL');
  if (m.mcpUrl !== undefined && !isHttps(m.mcpUrl)) throw new TypeError('mcpUrl must be an https URL');
  if (m.image !== undefined && !m.image.startsWith('ipfs://') && !isHttps(m.image)) throw new TypeError('image must be an ipfs:// or https URL');
  return {
    type: REGISTRATION_TYPE,
    name: m.name,
    description: m.description,
    ...(m.image ? { image: m.image } : {}),
    services: [{ name: 'web', endpoint: m.webUrl }, ...(m.mcpUrl ? [{ name: 'MCP', endpoint: m.mcpUrl }] : [])],
    x402Support: true,
    active: true,
    supportedTrust: ['reputation'],
  };
}

/** Fully on-chain and content-addressed: the URI is the metadata, so it cannot be silently changed. */
export function toAgentUri(reg: Record<string, unknown>): string {
  return `${DATA_URI_PREFIX}${Buffer.from(JSON.stringify(reg), 'utf8').toString('base64')}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const v: unknown = JSON.parse(text);
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** `data:application/json[;charset=…][;base64],…` and nothing else; null on any problem. */
function decodeDataUri(uri: string): Record<string, unknown> | null {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),(.*)$/s.exec(uri);
  if (!m || m[1]!.toLowerCase() !== 'application/json') return null;
  const payload = m[3]!;
  let text: string;
  if (m[2]!.split(';').some((p) => p.toLowerCase() === 'base64')) {
    if (payload.length > Math.ceil((MAX_REGISTRATION_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
    text = Buffer.from(payload, 'base64').toString('utf8');
  } else {
    if (payload.length > MAX_REGISTRATION_BYTES * 3) return null;
    text = decodeURIComponent(payload);
  }
  return Buffer.byteLength(text, 'utf8') > MAX_REGISTRATION_BYTES ? null : parseJsonObject(text);
}

function assertAgentUri(uri: string): void {
  if (uri.length === 0 || uri.length > MAX_AGENT_URI_CHARS) throw new TypeError(`the agent URI must be 1 to ${MAX_AGENT_URI_CHARS} characters`);
  if (uri.startsWith('ipfs://')) return;
  if (!uri.startsWith(DATA_URI_PREFIX)) throw new TypeError('the agent URI must be a base64 JSON data URI or an ipfs:// URI: an https URI can be changed after registration');
  let reg: Record<string, unknown> | null = null;
  try {
    reg = decodeDataUri(uri);
  } catch {
    /* falls through to the error below */
  }
  if (!reg || reg.type !== REGISTRATION_TYPE) throw new TypeError('the agent URI does not hold an ERC-8004 registration-v1 document');
}

/**
 * Mints the agent identity: register(string), tagged. The agentId is read from the Registered event of the registry that was called.
 * Registering twice would mint a second identity, so a wallet that already has an agentId is refused before anything is sent.
 */
export async function registerAgent(c: Clients, cfg: Config, agentUri: string, opts: { fee?: FeeSymbol } = {}): Promise<{ hash: Hash; agentId: bigint }> {
  if (cfg.agentId !== undefined) throw new ConfigError(`already registered as agent ${cfg.agentId}: refusing to mint a second identity`);
  assertAgentUri(agentUri);
  const { identity } = REGISTRIES[cfg.network];
  const hash = await sendTagged(c, { to: identity, data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: 'register', args: [agentUri] }), fee: opts.fee });

  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`the registration transaction ${hash} reverted`);
  const registered = parseEventLogs({ abi: IDENTITY_ABI, eventName: 'Registered', logs: receipt.logs }).find((l) => l.address.toLowerCase() === identity.toLowerCase());
  if (!registered) throw new Error(`the registration transaction ${hash} emitted no Registered event from ${identity}`);
  return { hash, agentId: registered.args.agentId };
}

/** Feedback about another agent's service. Tags are strings on the deployed registry; `value` is a whole number (valueDecimals 0). */
export async function giveFeedback(
  c: Clients,
  cfg: Config,
  a: { agentId: bigint; value: number; tag1: string; tag2: string; endpoint: string; feedbackUri: string; feedbackHash: `0x${string}` },
  opts: { fee?: FeeSymbol } = {},
): Promise<Hash> {
  if (a.agentId < 0n) throw new TypeError('agentId must not be negative');
  if (!Number.isSafeInteger(a.value)) throw new TypeError('value must be a safe integer');
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.feedbackHash)) throw new TypeError('feedbackHash must be 32 bytes');
  const data = encodeFunctionData({
    abi: REPUTATION_ABI,
    functionName: 'giveFeedback',
    args: [a.agentId, BigInt(a.value), 0, a.tag1, a.tag2, a.endpoint, a.feedbackUri, a.feedbackHash],
  });
  return sendTagged(c, { to: REGISTRIES[cfg.network].reputation, data, fee: opts.fee });
}

export async function readAgentWallet(reader: ChainReader, cfg: Config, agentId: bigint): Promise<`0x${string}`> {
  const wallet = await reader.readContract({ address: REGISTRIES[cfg.network].identity, abi: IDENTITY_ABI, functionName: 'getAgentWallet', args: [agentId] });
  if (typeof wallet !== 'string' || !isAddress(wallet)) throw new Error('getAgentWallet did not return an address');
  return getAddress(wallet);
}

export interface LoadRegistrationOptions {
  /** Every address the host resolves to; a host with any private address is refused. Default: the system resolver. */
  resolveHost?: (host: string) => Promise<string[]>;
  /** One deadline for the whole load. Default 10000. */
  timeoutMs?: number;
}

const systemResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

async function fetchJson(url: string, fetchImpl: typeof fetch, opts: LoadRegistrationOptions): Promise<Record<string, unknown> | null> {
  const deadline = createDeadline(opts.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS);
  try {
    const target = parseSafeUrl(url); // https, port 443, no credentials, no IP literal, no local name
    const addresses = await deadline.race((opts.resolveHost ?? systemResolve)(target.hostname));
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) return null;
    // Never followed: a redirect would skip the address check above.
    const res = await deadline.race(
      fetchImpl(target.href, { method: 'GET', redirect: 'manual', signal: deadline.signal, headers: { 'user-agent': RAILWALKER_USER_AGENT, accept: 'application/json' } }),
    );
    if (res.status !== 200) {
      discard(res);
      return null;
    }
    const body = await readCapped(res, MAX_REGISTRATION_BYTES, deadline, 'refuse');
    return body.ok ? parseJsonObject(body.text) : null;
  } finally {
    deadline.clear();
  }
}

/**
 * Reads a registration document from the URI an agent chose, which is a stranger's input: data: URIs are decoded in place, ipfs://
 * goes through one fixed gateway, https:// is vetted like any scanned URL. Null on any failure; never throws; 256 KB at most.
 */
export async function loadRegistration(uri: string, fetchImpl: typeof fetch, opts: LoadRegistrationOptions = {}): Promise<unknown | null> {
  try {
    if (uri.startsWith('data:')) return decodeDataUri(uri);
    if (uri.startsWith('ipfs://')) {
      const path = uri.slice('ipfs://'.length);
      if (!IPFS_PATH.test(path) || path.split('/').some((s) => s === '.' || s === '..')) return null;
      return await fetchJson(`${IPFS_GATEWAY}${path}`, fetchImpl, opts);
    }
    return await fetchJson(uri, fetchImpl, opts);
  } catch {
    return null;
  }
}
