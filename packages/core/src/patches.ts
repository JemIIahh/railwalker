import { ASSETS } from './assets';
import type { Finding, FindingCode } from './findings';

export interface Patch {
  code: FindingCode;
  title: string;
  why: string;
  /** The corrected seller-config snippet, in the style of Celo's @x402/hono examples. */
  after: string;
}

const CORS_SNIPPET = `import { cors } from "hono/cors";

// Register BEFORE paymentMiddleware so the 402 response itself carries CORS headers.
app.use(cors({ origin: "*", exposeHeaders: ["payment-required", "payment-response"] }));`;

/** One templated fix per patchable finding. The fix is never invented: it is the documented configuration. */
export function patchFor(f: Finding): Patch | null {
  const asset = f.assetSymbol ? ASSETS[f.assetSymbol] : null;
  const code = f.code;

  switch (code) {
    case 'permit2_gas_sponsorship_missing':
    case 'permit2_allowance_required': // the same missing extension, seen by a first-time wallet at payment time
      return {
        code,
        title: 'Declare the gas-sponsorship extension on the route',
        why: 'Clients sign the sponsored EIP-2612 permit only when the 402 carries this key; the facilitator advertising it in /supported is not enough. Without it first-time wallets get 412 permit2_allowance_required.',
        after: `import { declareEip2612GasSponsoringExtension } from "@x402/extensions";

// In the route config. This adds the eip2612GasSponsoring key that the 402 must carry.
extensions: { ...declareEip2612GasSponsoringExtension() },`,
      };
    case 'permit2_method_missing':
      return {
        code,
        title: 'Mark the asset as a Permit2 asset',
        why: 'Peso stablecoins and cNGN settle through Permit2; without assetTransferMethod the client assumes EIP-3009.',
        after: `extra: { name: "${asset?.eip712Name ?? '<EIP-712 name>'}", version: "${asset?.eip712Version ?? '1'}", assetTransferMethod: "permit2" },`,
      };
    case 'eip712_domain_mismatch':
      return {
        code,
        title: 'Use the EIP-712 domain of the asset',
        why: 'extra.name is the EIP-712 domain name (for example "Tether USD"), not the ticker, and version is a string.',
        after: `extra: { name: "${asset?.eip712Name ?? '<EIP-712 name>'}", version: "${asset?.eip712Version ?? '1'}" },`,
      };
    case 'asset_is_fee_adapter':
      return {
        code,
        title: 'Advertise the token, not the fee adapter',
        why: 'The 18-decimal adapter exists only for gas (feeCurrency); paying it as an asset signs for the wrong contract.',
        after: `asset: getAddress("${asset?.address ?? '<token address>'}"), // the token, never the fee-currency adapter`,
      };
    case 'decimals_mismatch':
      return {
        code,
        title: 'Express the amount in the asset\'s base units',
        why: 'Amounts are strings of base units; the pesos use 18 decimals and USDC, USDT, USAT and cNGN use 6.',
        after: asset
          ? asset.decimals === 6
            ? `amount: "10000", // $0.01: ${asset.symbol} has 6 decimals`
            : `amount: "1000000000000000000", // 1 ${asset.symbol}: it has 18 decimals`
          : 'amount: "10000", // 6 decimals (USDC, USDT, USAT, cNGN); 18 decimals for the pesos: "1000000000000000000" is 1 token',
      };
    case 'payto_zero':
    case 'payto_invalid':
      return {
        code,
        title: 'Pay to a real address you control',
        why: 'payTo receives the money directly; the facilitator never holds funds. It must be a valid, checksummed address.',
        after: 'payTo: getAddress(process.env.SELLER_PAY_TO!),',
      };
    case 'no_mainnet_accept':
      return {
        code,
        title: 'Offer a Celo mainnet payment option',
        why: 'Only mainnet payments count; Permit2 assets exist only on mainnet.',
        after: 'network: "eip155:42220", // Celo mainnet',
      };
    case 'timeout_too_short':
      return {
        code,
        title: 'Allow enough time to settle',
        why: 'Settlement takes about 9 s at the median and 18 s at p95 on Celo.',
        after: 'maxTimeoutSeconds: 300,',
      };
    case 'zero_amount':
      return {
        code,
        title: 'Set a positive price in base units',
        why: 'An empty or zero amount cannot be paid.',
        after: 'price: { amount: "10000", asset: USDC, extra: { name: "USDC", version: "2" } }, // $0.01',
      };
    case 'cors_missing':
      return {
        code,
        title: 'Send CORS headers on the 402 response',
        why: 'Browser buyers cannot read a 402 that has no Access-Control-Allow-Origin header.',
        after: CORS_SNIPPET,
      };
    case 'cors_header_not_exposed':
      return {
        code,
        title: 'Expose the payment-required header',
        why: 'x402 v2 puts the payment requirements in the payment-required header, which browsers hide unless it is exposed.',
        after: CORS_SNIPPET,
      };
    default:
      return null;
  }
}
