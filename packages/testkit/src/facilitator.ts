import { ASSETS, CELO_SEPOLIA_USDC } from '@railwalker/core';
import type { FacilitatorClient } from '@x402/core/server';

export const MOCK_TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;

export interface MockFacilitatorOptions {
  failSettle?: boolean;
  settleDelayMs?: number;
  txHash?: `0x${string}`;
  failVerify?: boolean;
}

export type MockFacilitator = FacilitatorClient & { verifyCalls: number; settleCalls: number };

type Payload = { payload: Record<string, unknown> };

function payerOf(p: Payload): string | undefined {
  const inner = p.payload as { authorization?: { from?: string }; permit2Authorization?: { from?: string } };
  return inner.authorization?.from ?? inner.permit2Authorization?.from;
}

/** An in-memory stand-in for Celo's hosted facilitator: no chain, no network, deterministic results. */
export function mockFacilitator(opts: MockFacilitatorOptions = {}): MockFacilitator {
  const state = { verifyCalls: 0, settleCalls: 0 };
  const client: FacilitatorClient = {
    async verify(paymentPayload) {
      state.verifyCalls++;
      const payer = payerOf(paymentPayload);
      return opts.failVerify
        ? { isValid: false, invalidReason: 'mock_verify_failure', ...(payer ? { payer } : {}) }
        : { isValid: true, ...(payer ? { payer } : {}) };
    },
    async settle(paymentPayload, paymentRequirements) {
      state.settleCalls++;
      if (opts.settleDelayMs) await new Promise((r) => setTimeout(r, opts.settleDelayMs));
      const payer = payerOf(paymentPayload);
      return {
        success: !opts.failSettle,
        ...(opts.failSettle ? { errorReason: 'mock_settle_failure' } : {}),
        ...(payer ? { payer } : {}),
        transaction: opts.txHash ?? MOCK_TX_HASH,
        network: paymentRequirements.network,
      };
    },
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:42220',
            extra: {
              extensions: ['eip2612GasSponsoring'],
              supportedAssets: Object.values(ASSETS).map((a) => ({
                asset: a.address,
                symbol: a.symbol,
                decimals: a.decimals,
                name: a.eip712Name,
                version: a.eip712Version,
                assetTransferMethod: a.method,
              })),
            },
          },
          // The sandbox network, so fixtures configured for Sepolia initialise in tests. The real facilitator's coverage is not assumed.
          {
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:11142220',
            extra: {
              extensions: ['eip2612GasSponsoring'],
              supportedAssets: [{ asset: CELO_SEPOLIA_USDC, symbol: 'USDC', decimals: 6, name: 'USDC', version: '2', assetTransferMethod: 'eip3009' }],
            },
          },
        ],
        extensions: ['eip2612GasSponsoring'],
        signers: {},
      };
    },
  };
  return Object.defineProperties(client, {
    verifyCalls: { get: () => state.verifyCalls },
    settleCalls: { get: () => state.settleCalls },
  }) as MockFacilitator;
}
