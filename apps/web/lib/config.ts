import { ZERO_ADDRESS } from '@railwalker/core';
import { isAddress } from 'viem';
import { FACILITATOR_URLS } from '@railwalker/chain';

export interface WebConfig {
  network: 'mainnet' | 'sepolia';
  fixtureNetwork: 'eip155:42220' | 'eip155:11142220';
  facilitatorUrl: string;
  x402ApiKey: string | undefined;
  /** The fixtures are served only with a payee that is a real address; otherwise they are off, and say why. */
  fixtures: { payTo: `0x${string}` } | { disabledReason: string };
  siteUrl: string | undefined;
}

const clean = (v: string | undefined) => (v === undefined || v === '' ? undefined : v);

/**
 * The site's configuration, read from the environment. It deliberately has no private key: the site scans and serves fixtures,
 * and pays nothing. Anything that is not exactly "mainnet" is Sepolia, so a typo can never point development at real money.
 */
export function webConfig(env: Record<string, string | undefined>): WebConfig {
  const network = env.RAILWALKER_NETWORK === 'mainnet' ? 'mainnet' : 'sepolia';
  const payTo = clean(env.SELLER_PAY_TO);
  const siteUrl = clean(env.RAILWALKER_SITE_URL);

  let site: string | undefined;
  try {
    const u = siteUrl ? new URL(siteUrl) : undefined;
    site = u?.protocol === 'https:' ? u.origin : undefined;
  } catch {
    site = undefined;
  }

  return {
    network,
    fixtureNetwork: network === 'mainnet' ? 'eip155:42220' : 'eip155:11142220',
    facilitatorUrl: FACILITATOR_URLS[network],
    x402ApiKey: clean(env.X402_API_KEY),
    fixtures:
      payTo && isAddress(payTo, { strict: true }) && payTo.toLowerCase() !== ZERO_ADDRESS
        ? { payTo }
        : { disabledReason: 'SELLER_PAY_TO must be set to a valid, non-zero, correctly checksummed address' },
    siteUrl: site,
  };
}

/** Only /settle is key-gated on Celo's facilitator, but the client wants headers keyed by path, so the key goes on all three. */
export function authHeaders(key: string | undefined) {
  if (!key) return undefined;
  const h = { 'X-API-Key': key };
  return { verify: h, settle: h, supported: h };
}
