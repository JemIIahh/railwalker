import { ASSETS, type FindingCode } from '@railwalker/core';
import type { Hono } from 'hono';
import { MAINNET, SEPOLIA, SEPOLIA_USDC, SPONSORSHIP, accept, challenge, goodAccepts, type FixtureNetwork, type WireAccept } from './challenge';

const ZERO = '0x0000000000000000000000000000000000000000';

interface BadRoute {
  expect: FindingCode;
  accepts: (payTo: string, network: FixtureNetwork) => WireAccept[];
  extensions?: Record<string, unknown>;
}

const usdc = (payTo: string, over: Partial<Parameters<typeof accept>[0]> = {}) =>
  accept({ network: MAINNET, asset: ASSETS.USDC.address, payTo, extra: { name: ASSETS.USDC.eip712Name, version: ASSETS.USDC.eip712Version }, ...over });

const wars = (payTo: string, extra: Record<string, unknown>) => accept({ network: MAINNET, asset: ASSETS.wARS.address, payTo, amount: '1000000000000000000', extra });
const warsExtra = { name: ASSETS.wARS.eip712Name, version: ASSETS.wARS.eip712Version };

/**
 * Each of these is a 402 that is broken in exactly one way and has no payment path: whatever headers arrive, the answer is the same
 * challenge, so a buyer can never pay one. The route says which finding it is built to trigger.
 */
export const BAD_ROUTES: Record<string, BadRoute> = {
  // A Permit2 asset that does not say it is a Permit2 asset: clients would build an EIP-3009 payment that cannot work.
  '/bad/permit2-method': { expect: 'permit2_method_missing', accepts: (payTo) => [wars(payTo, warsExtra)], extensions: SPONSORSHIP },
  // Everything right except the sponsorship extension: first-time wallets get 412 permit2_allowance_required.
  '/bad/permit2-sponsorship': { expect: 'permit2_gas_sponsorship_missing', accepts: (payTo) => [wars(payTo, { ...warsExtra, assetTransferMethod: 'permit2' })] },
  // The 18-decimal fee-currency ADAPTER as the asset: payers would sign for the wrong contract.
  '/bad/adapter-asset': { expect: 'asset_is_fee_adapter', accepts: (payTo) => [usdc(payTo, { asset: ASSETS.USDC.feeAdapter! })] },
  // An 18-decimal amount on a 6-decimal asset: the price is off by 10^12.
  '/bad/decimals': { expect: 'decimals_mismatch', accepts: (payTo) => [usdc(payTo, { amount: '5000000000000000' })] },
  // extra.name is a ticker-ish name, not the EIP-712 domain name: signatures built from it do not verify.
  '/bad/domain-name': { expect: 'eip712_domain_mismatch', accepts: (payTo) => [usdc(payTo, { extra: { name: 'USD Coin', version: ASSETS.USDC.eip712Version } })] },
  // Payments would be burned.
  '/bad/payto-zero': { expect: 'payto_zero', accepts: () => [usdc(ZERO)] },
  // Only a Celo Sepolia (sandbox) accept: nothing a mainnet buyer can pay.
  '/bad/testnet-only': { expect: 'no_mainnet_accept', accepts: (payTo) => [accept({ network: SEPOLIA, asset: SEPOLIA_USDC, payTo, extra: { name: 'USDC', version: '2' } })] },
  // A correct challenge that a browser cannot read: no CORS (the app leaves this route out of the CORS middleware).
  '/bad/no-cors': { expect: 'cors_missing', accepts: (payTo, network) => goodAccepts(network, payTo) },
};

/** The one route a browser cannot read. */
export const NO_CORS_PATH = '/bad/no-cors';

/** `only` picks which routes to register, so the app can put the unreadable one before its CORS middleware and the rest after. */
export function registerBadRoutes(app: Hono, deps: { payTo: string; network: FixtureNetwork }, only: (path: string) => boolean = () => true): void {
  for (const [path, route] of Object.entries(BAD_ROUTES)) {
    if (!only(path)) continue;
    app.get(path, (c) => challenge(c, route.accepts(deps.payTo, deps.network), { expect: route.expect, extensions: route.extensions }));
  }
}
