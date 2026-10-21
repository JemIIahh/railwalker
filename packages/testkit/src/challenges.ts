import { ASSETS, type Accept, type AssetSymbol, type Challenge } from '@railwalker/core';
import buyV1 from '../fixtures/buy-v1-x-posts-search.json' with { type: 'json' };
import v2Multi from '../fixtures/v2-multi-asset.json' with { type: 'json' };

/** buy's real unpaid x402 v1 challenge (recorded 2026-10-21): three `celo` accepts plus one `celo-sepolia` sandbox accept. */
export const buyV1Challenge = buyV1;

/** A v2 challenge in the shape seen in the wild: USDC, USDT and USAT on eip155:42220. */
export const v2MultiAssetChallenge = v2Multi;

const DEFAULT_PAY_TO = '0x1111111111111111111111111111111111111111';

/** A mainnet accept for `symbol`, already normalised (as parseChallenge would produce it). */
export function makeAccept(symbol: AssetSymbol, over: Partial<Accept> = {}): Accept {
  const asset = ASSETS[symbol];
  const extra: Record<string, unknown> = { name: asset.eip712Name, version: asset.eip712Version };
  if (asset.method === 'permit2') extra.assetTransferMethod = 'permit2';
  return {
    scheme: 'exact',
    network: 'eip155:42220',
    chainId: 42220,
    asset: asset.address,
    assetInfo: asset,
    amountAtomic: asset.decimals === 6 ? '5000' : '1000000000000000000',
    payTo: DEFAULT_PAY_TO,
    maxTimeoutSeconds: 300,
    extra,
    ...over,
  };
}

/** A valid v2 mainnet USDC challenge (amount 5000), overridable. */
export function makeChallenge(over: Partial<Challenge> = {}): Challenge {
  return {
    version: 2,
    accepts: [makeAccept('USDC')],
    extensions: {},
    resource: { url: 'https://fixtures.example/ok', mimeType: 'application/json' },
    hasOutputSchema: false,
    ...over,
  };
}
