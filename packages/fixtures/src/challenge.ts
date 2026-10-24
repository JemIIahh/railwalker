import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { declareEip2612GasSponsoringExtension } from '@x402/extensions';
import { ASSETS, CELO_SEPOLIA_USDC, type FindingCode } from '@railwalker/core';
import type { Context } from 'hono';

export type FixtureNetwork = 'eip155:42220' | 'eip155:11142220';

export const MAINNET: FixtureNetwork = 'eip155:42220';
export const SEPOLIA: FixtureNetwork = 'eip155:11142220';
export const SEPOLIA_USDC = CELO_SEPOLIA_USDC;
/** $0.005 of a 6-decimal asset: the smallest price an unsolicited probe may pay. */
export const PRICE = '5000';

/** The extension a Permit2 route must carry so first-time wallets can pay, exactly as the x402 library declares it. */
export const SPONSORSHIP = declareEip2612GasSponsoringExtension();

/** The pesos that can be bought on Celo, and what a correct seller asks in each: about half a US cent, in 18-decimal units. */
export const PESOS = ['wARS', 'wBRL'] as const;
export const PESO_PRICES = { wARS: '8000000000000000000', wBRL: '25000000000000000' } as const;

export interface GoodAsset {
  address: string;
  name: string;
  version: string;
}

/** What a correct seller on `network` accepts. Mainnet: the three 6-decimal dollar assets. */
export function goodAssets(network: FixtureNetwork): GoodAsset[] {
  if (network === SEPOLIA) return [{ address: SEPOLIA_USDC, name: 'USDC', version: '2' }];
  return (['USDC', 'USDT', 'USAT'] as const).map((s) => ({ address: ASSETS[s].address, name: ASSETS[s].eip712Name, version: ASSETS[s].eip712Version }));
}

export interface WireAccept {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export function accept(a: { network: string; asset: string; payTo: string; amount?: string; extra: Record<string, unknown> }): WireAccept {
  return { scheme: 'exact', network: a.network, amount: a.amount ?? PRICE, asset: a.asset, payTo: a.payTo, maxTimeoutSeconds: 300, extra: a.extra };
}

/** The accepts of a correct peso seller: Permit2 assets that say so, on mainnet, where the pesos live. */
export function pesoAccepts(payTo: string): WireAccept[] {
  return PESOS.map((s) =>
    accept({ network: MAINNET, asset: ASSETS[s].address, payTo, amount: PESO_PRICES[s], extra: { name: ASSETS[s].eip712Name, version: ASSETS[s].eip712Version, assetTransferMethod: 'permit2' } }),
  );
}

/** The accepts of a correct seller, in wire form. */
export function goodAccepts(network: FixtureNetwork, payTo: string): WireAccept[] {
  return goodAssets(network).map((a) => accept({ network, asset: a.address, payTo, extra: { name: a.name, version: a.version } }));
}

/** A 402 that says which finding it is built to trigger. `error` is the seller's own reason, when it has one. */
export function challenge(c: Context, accepts: WireAccept[], opts: { expect?: FindingCode; extensions?: Record<string, unknown>; error?: string; headers?: Record<string, string> } = {}): Response {
  const required = {
    x402Version: 2,
    error: opts.error ?? 'PAYMENT-SIGNATURE header is required',
    resource: { url: c.req.url, description: 'Railwalker fixture seller', mimeType: 'application/json' },
    accepts,
    ...(opts.extensions ? { extensions: opts.extensions } : {}),
  } as unknown as PaymentRequired;
  return c.json({}, 402, {
    'payment-required': encodePaymentRequiredHeader(required),
    ...(opts.expect ? { 'x-fixture-expect': opts.expect } : {}),
    ...opts.headers,
  });
}
