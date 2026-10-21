import type { AssetSymbol } from './assets';
import { clipDeep, clipText } from './clip';

export type Severity = 'error' | 'warn' | 'info';
export type Basis = 'CONFIRMED' | 'PREDICTED';

/** Declaration order is priority: the first error in this order becomes the FAIL code of a verdict. */
export const FINDING_ORDER = [
  'not_x402',
  'challenge_timeout',
  'no_accepts',
  'no_mainnet_accept',
  'payto_zero',
  'payto_invalid',
  'asset_is_fee_adapter',
  'permit2_method_missing',
  'permit2_gas_sponsorship_missing',
  'eip712_domain_mismatch',
  'zero_amount',
  'no_matching_accept',
  'settle_failed',
  'permit2_allowance_required',
  'insufficient_credits',
  'facilitator_error',
  'transfer_mismatch',
  'tx_not_found',
  'paid_not_delivered',
  'delivered_empty',
  'delivered_invalid_json',
  'decimals_mismatch',
  'payto_agent_wallet_mismatch',
  'timeout_too_short',
  'cors_missing',
  'cors_header_not_exposed',
  'schema_mismatch',
  'too_slow',
  'nonce_race',
  'cngn_needs_one_time_approve',
  'testnet_entry_present',
  'wrong_network',
  'asset_unknown',
  'price_above_default_buyer_cap',
  'v1_challenge',
  'no_output_schema',
  'challenge_slow',
  'ambiguous_after_payment',
] as const;

export type FindingCode = (typeof FINDING_ORDER)[number];

export const FINDING_SEVERITY: Record<FindingCode, Severity> = {
  not_x402: 'error',
  challenge_timeout: 'error',
  no_accepts: 'error',
  no_mainnet_accept: 'error',
  payto_zero: 'error',
  payto_invalid: 'error',
  asset_is_fee_adapter: 'error',
  permit2_method_missing: 'error',
  permit2_gas_sponsorship_missing: 'error',
  eip712_domain_mismatch: 'error',
  zero_amount: 'error',
  no_matching_accept: 'error',
  settle_failed: 'error',
  permit2_allowance_required: 'error',
  insufficient_credits: 'error',
  facilitator_error: 'error',
  transfer_mismatch: 'error',
  tx_not_found: 'error',
  paid_not_delivered: 'error',
  delivered_empty: 'error',
  delivered_invalid_json: 'error',
  decimals_mismatch: 'warn',
  payto_agent_wallet_mismatch: 'warn',
  timeout_too_short: 'warn',
  cors_missing: 'warn',
  cors_header_not_exposed: 'warn',
  schema_mismatch: 'warn',
  too_slow: 'warn',
  nonce_race: 'warn',
  cngn_needs_one_time_approve: 'info',
  testnet_entry_present: 'info',
  wrong_network: 'info',
  asset_unknown: 'info',
  price_above_default_buyer_cap: 'info',
  v1_challenge: 'info',
  no_output_schema: 'info',
  challenge_slow: 'info',
  // An error that turns the verdict into AMBIGUOUS (money moved, delivery unknown).
  ambiguous_after_payment: 'error',
};

/** Reasons a payment was refused by policy. */
export type DenyReason =
  | 'not_read_style'
  | 'opted_out'
  | 'over_probe_cap'
  | 'over_endpoint_day_cap'
  | 'over_event_cap'
  | 'seller_settlement_limit'
  | 'price_below_unsolicited_minimum'
  | 'below_reserve'
  | 'customer_fee_fraction_exceeded'
  | 'unpriced_asset';

/** Reasons nothing was scanned or paid at all. */
export type SkipReason = DenyReason | 'unsafe_url' | 'redirect_blocked' | 'response_too_large';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  basis: Basis;
  message: string;
  evidence: Record<string, unknown>;
  assetSymbol?: AssetSymbol;
}

/**
 * The one way findings are built: severity always comes from the table, and the basis defaults to PREDICTED.
 * Evidence often quotes what a seller sent, so it is bounded here and nowhere else needs to remember to.
 */
export function makeFinding(
  code: FindingCode,
  message: string,
  evidence: Record<string, unknown> = {},
  opts: { assetSymbol?: AssetSymbol; basis?: Basis } = {},
): Finding {
  return {
    code,
    severity: FINDING_SEVERITY[code],
    basis: opts.basis ?? 'PREDICTED',
    message: clipText(message, 500),
    evidence: clipDeep(evidence) as Record<string, unknown>,
    ...(opts.assetSymbol ? { assetSymbol: opts.assetSymbol } : {}),
  };
}
