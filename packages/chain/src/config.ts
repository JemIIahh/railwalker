import { codeFromRepo } from '@celo/attribution-tags';
import { CELO_MAINNET, CELO_SEPOLIA } from '@railwalker/core';
import { getAddress, isAddress } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AttributionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributionMismatchError';
  }
}

export interface Config {
  network: 'mainnet' | 'sepolia';
  chainId: 42220 | 11142220;
  rpcUrl: string;
  agentPrivateKey: `0x${string}`;
  /** The ERC-8021 code every transaction carries. Empty only on Sepolia dev: sendTagged refuses to send without one. */
  attributionCode: string;
  repoSlug: string;
  facilitatorUrl: string;
  x402ApiKey?: string;
  payTo: `0x${string}`;
  sellerSalt: string;
  /** The ERC-8004 agentId, once `register` has run. */
  agentId?: bigint;
}

const DEFAULT_REPO = 'JemIIahh/railwalker';
/** A public default would let anyone reverse the hash of an unsolicited seller, so mainnet refuses to use it. */
const DEV_SELLER_SALT = 'railwalker-dev-salt-not-for-mainnet';
const MIN_SELLER_SALT_LENGTH = 16;

/** Celo hosts a separate x402 facilitator for each network (docs.celo.org/build/agents/x402). */
export const FACILITATOR_URLS = { mainnet: 'https://api.x402.celo.org', sepolia: 'https://api.x402.sepolia.celo.org' } as const;

const NETWORKS = {
  mainnet: { chainId: CELO_MAINNET, rpcUrl: 'https://forno.celo.org', facilitatorUrl: FACILITATOR_URLS.mainnet },
  sepolia: { chainId: CELO_SEPOLIA, rpcUrl: 'https://forno.celo-sepolia.celo-testnet.org', facilitatorUrl: FACILITATOR_URLS.sepolia },
} as const;

const isHttps = (s: string) => {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
};

// Every message here is static text: a bad value is never echoed, because the value may be a secret.
const Env = z.object({
  AGENT_PRIVATE_KEY: z.string({ error: 'is required' }).regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x followed by 64 hex characters'),
  RAILWALKER_NETWORK: z.enum(['mainnet', 'sepolia'], { error: 'must be "mainnet" or "sepolia"' }).default('sepolia'),
  RAILWALKER_ATTRIBUTION_CODE: z.string().optional(),
  RAILWALKER_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must look like owner/repo').default(DEFAULT_REPO),
  CELO_RPC_URL: z.string().refine(isHttps, 'must be an https URL').optional(),
  X402_API_KEY: z.string().optional(),
  SELLER_PAY_TO: z.string().refine((a) => isAddress(a), 'must be a valid address').optional(),
  SELLER_SALT: z.string().optional(),
  RAILWALKER_AGENT_ID: z.string().regex(/^\d+$/, 'must be a whole number').optional(),
});

/** The code is derived from the repo exactly as the Celo Builders platform derives it, so a copy-paste slip cannot go on chain. */
export function assertAttributionMatchesRepo(code: string, repo: string): void {
  let expected: string;
  try {
    expected = codeFromRepo(repo);
  } catch {
    throw new AttributionMismatchError(`"${repo}" is not an owner/repo slug, so no attribution code can be derived from it`);
  }
  if (code !== expected) {
    throw new AttributionMismatchError(`attribution code ${code} does not belong to ${repo}: its code is ${expected}`);
  }
}

/** Blank values count as unset, the way a blank line in `.env` should. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = Env.safeParse(set);
  const problems = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`);

  if (parsed.success) {
    const v = parsed.data;
    if (v.RAILWALKER_NETWORK === 'mainnet') {
      if (!v.RAILWALKER_ATTRIBUTION_CODE) {
        problems.push('RAILWALKER_ATTRIBUTION_CODE: required on mainnet, where every transaction must carry the ERC-8021 tag');
      }
      if ((v.SELLER_SALT ?? '').length < MIN_SELLER_SALT_LENGTH) {
        problems.push(`SELLER_SALT: required on mainnet, at least ${MIN_SELLER_SALT_LENGTH} characters: an unsolicited seller's hash is only as private as this secret`);
      }
    }
  }
  if (!parsed.success || problems.length > 0) throw new ConfigError(`Invalid configuration. ${problems.join('; ')}`);

  const v = parsed.data;
  const attributionCode = v.RAILWALKER_ATTRIBUTION_CODE ?? '';
  if (attributionCode !== '') assertAttributionMatchesRepo(attributionCode, v.RAILWALKER_REPO);

  const network = NETWORKS[v.RAILWALKER_NETWORK];
  const agentPrivateKey = v.AGENT_PRIVATE_KEY as `0x${string}`;
  return {
    network: v.RAILWALKER_NETWORK,
    chainId: network.chainId,
    rpcUrl: v.CELO_RPC_URL ?? network.rpcUrl,
    agentPrivateKey,
    attributionCode,
    repoSlug: v.RAILWALKER_REPO,
    facilitatorUrl: network.facilitatorUrl,
    ...(v.X402_API_KEY ? { x402ApiKey: v.X402_API_KEY } : {}),
    payTo: v.SELLER_PAY_TO ? getAddress(v.SELLER_PAY_TO) : privateKeyToAddress(agentPrivateKey),
    sellerSalt: v.SELLER_SALT ?? DEV_SELLER_SALT,
    ...(v.RAILWALKER_AGENT_ID ? { agentId: BigInt(v.RAILWALKER_AGENT_ID) } : {}),
  };
}
