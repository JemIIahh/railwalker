import { ASSETS, type AssetSymbol } from '@railwalker/core';
import { formatPaid } from './view-models';

/** A wallet that announced itself to the page (EIP-6963): what to call it, what it looks like, and the id that stays the same between visits. */
export interface DiscoveredWallet {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export const CELO_CHAIN_ID = 42220;
export const isCelo = (chainId: number | null): boolean => chainId === CELO_CHAIN_ID;

/** A wallet that announces itself more than once is listed once, the first announcement kept. */
export function dedupeWallets(list: DiscoveredWallet[]): DiscoveredWallet[] {
  const seen = new Set<string>();
  return list.filter((w) => {
    if (seen.has(w.rdns)) return false;
    seen.add(w.rdns);
    return true;
  });
}

/** The wallet used last time comes first, then the rest alphabetically, whatever the case. The list given is not changed. */
export function rankWallets(list: DiscoveredWallet[], favourite: string | null): DiscoveredWallet[] {
  const alphabetical = (a: DiscoveredWallet, b: DiscoveredWallet) => a.name.localeCompare(b.name, 'en');
  return [...list].sort((a, b) => Number(b.rdns === favourite) - Number(a.rdns === favourite) || alphabetical(a, b));
}

/** Four characters at each end of an address, joined by an ellipsis. Anything too short to shorten is left as it is. */
export function shortAddress(address: string): string {
  return address.length < 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** A chain id as a wallet says it: hex, a number or a decimal string. Anything else is no chain. */
export function parseChainId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const parsed = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text, 16) : /^\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Two colours for a round avatar, the same every time for the same address, so a wallet is recognisable without a picture. */
export function avatarGradient(address: string): [string, string] {
  if (!ADDRESS.test(address)) return ['hsl(0 0% 80%)', 'hsl(0 0% 62%)'];
  const hex = address.slice(2);
  const first = Number.parseInt(hex.slice(0, 4), 16) % 360;
  const second = (first + 50 + (Number.parseInt(hex.slice(4, 6), 16) % 110)) % 360;
  return [`hsl(${first} 88% 62%)`, `hsl(${second} 82% 54%)`];
}

/** The dollar token a wallet holds most of, written as dollars to the digit; none if it holds none. A tie goes to the one listed first. */
export function bestBalance(balances: { symbol: AssetSymbol; atomic: bigint }[]): { symbol: AssetSymbol; text: string } | null {
  let best: { symbol: AssetSymbol; atomic: bigint } | null = null;
  for (const b of balances) if (b.atomic > 0n && (best === null || b.atomic > best.atomic)) best = b;
  return best === null ? null : { symbol: best.symbol, text: formatPaid(ASSETS[best.symbol].address, best.atomic.toString()) };
}

/** What a wallet needs to add the Celo network (EIP-3085). */
export const CELO_ADD_CHAIN = {
  chainId: '0xa4ec',
  chainName: 'Celo',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: ['https://forno.celo.org'],
  blockExplorerUrls: ['https://celo.blockscout.com'],
} as const;

/** What to tell a person when a wallet refuses or fails. Never the wallet's own technical message: nobody can act on it. */
export function walletErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code; // a number, a string or nothing at all has no code: that is fine
  if (code === 4001) return 'You closed the wallet request. Nothing happened.';
  if (code === -32002) return 'A request is already open in your wallet. Open it to carry on.';
  if (code === 4902) return 'Your wallet does not have the Celo network yet.';
  return 'We could not connect. Try again.';
}
