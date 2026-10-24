import type { FindingCode, IndependenceReason, SkipReason, Stage, VerdictKind } from '@railwalker/core';

/** What each finding means, in words a seller would use. A test checks that no code is left without one. */
export const FINDING_LABELS: Record<FindingCode, string> = {
  not_x402: 'Not an x402 endpoint',
  challenge_timeout: 'Took too long to answer',
  no_accepts: 'No payment options offered',
  no_mainnet_accept: 'Nothing payable on Celo mainnet',
  payto_zero: 'Payments would go to the zero address',
  payto_invalid: 'The payee address is not valid',
  asset_is_fee_adapter: 'A gas-fee adapter is listed as the payment token',
  permit2_method_missing: 'Peso token not marked as Permit2',
  permit2_gas_sponsorship_missing: 'First-time wallets cannot pay (no gas sponsorship)',
  eip712_domain_mismatch: 'Signing details do not match the token',
  zero_amount: 'The price is zero or unreadable',
  no_matching_accept: 'No payment option a buyer can use',
  settle_failed: 'The payment could not be settled',
  permit2_allowance_required: 'First-time wallet refused (allowance needed)',
  insufficient_credits: 'Seller says the account has no credits',
  facilitator_error: 'The seller refused the payment',
  transfer_mismatch: 'The settlement does not match what was asked',
  tx_not_found: 'The settlement is not on chain',
  paid_not_delivered: 'Paid, but nothing useful came back',
  delivered_empty: 'Paid, and the answer was empty',
  delivered_invalid_json: 'Paid, and the answer was not valid JSON',
  decimals_mismatch: 'The price is written in the wrong units',
  payto_agent_wallet_mismatch: 'Payee differs from the agent’s registered wallet',
  timeout_too_short: 'The payment window is very short',
  cors_missing: 'Browsers cannot read the 402 (no CORS)',
  cors_header_not_exposed: 'Browsers cannot read the price header',
  schema_mismatch: 'The answer’s shape changed',
  too_slow: 'Slow to deliver after payment',
  nonce_race: 'Collided with another payment',
  cngn_needs_one_time_approve: 'cNGN needs a one-time approval',
  testnet_entry_present: 'A testnet option is listed',
  wrong_network: 'Lists a network that is not Celo',
  asset_unknown: 'Lists a token we do not know',
  price_above_default_buyer_cap: 'Priced above most buyers’ default limit',
  v1_challenge: 'Uses the older x402 v1 format',
  no_output_schema: 'Does not describe its output',
  challenge_slow: 'Slow to give its price',
  ambiguous_after_payment: 'Paid, and what came back cannot be told',
};

/** Why a payment was not made, in plain words. */
export const SKIP_LABELS: Record<string, string> = {
  not_read_style: 'Not paid: the route looks like it does something in the world',
  opted_out: 'Not paid: the seller opted out',
  over_probe_cap: 'Not paid: the price is above the per-payment limit',
  over_endpoint_day_cap: 'Not paid: this seller reached today’s limit',
  over_event_cap: 'Not paid: the whole budget is spent',
  seller_settlement_limit: 'Not paid: this seller reached its limit of payments',
  price_below_unsolicited_minimum: 'Not paid: too cheap to be worth the fees',
  below_reserve: 'Not paid: the wallet would fall below its reserve',
  insufficient_asset_balance: 'Not paid: the wallet does not hold enough of this token',
  customer_fee_fraction_exceeded: 'Not paid: it would use more than the fee allows',
  unpriced_asset: 'Not paid: the token has no dollar price',
  unsafe_url: 'Not scanned: the address is not safe to visit',
  redirect_blocked: 'Not scanned: it redirected somewhere unchecked',
  response_too_large: 'Not scanned: the answer was too large',
};

export const VERDICT_LABELS: Record<VerdictKind, string> = {
  PASS: 'Works: nothing wrong found',
  PASS_WITH_WARNINGS: 'Works, with warnings',
  FAIL: 'Broken: a buyer would hit a problem',
  AMBIGUOUS: 'Ambiguous: money moved, delivery unknown',
  SKIPPED: 'Not checked',
};

export const REASON_LABELS: Record<IndependenceReason, string> = {
  counted: 'Counts: active before the start, and not funded by us',
  is_project_wallet: 'One of our own wallets',
  funded_by_project: 'First funded by one of our wallets',
  no_prior_activity: 'No earlier activity we can find',
  activity_after_start: 'First active after the hackathon began',
};

/** Whose endpoint a run was about. Only the first two are ever shown by name; the others are private and never reach a page. */
export const STAGE_LABELS: Record<Stage, string> = {
  fixture: 'Our own test seller',
  buy: 'A real service we pay',
  unsolicited: 'A registered seller (private)',
  customer: 'A customer’s endpoint (private)',
};

/** The plain-words title for a verdict code, whichever kind of code it is. */
export function codeLabel(code: string): string {
  return (FINDING_LABELS as Record<string, string>)[code] ?? SKIP_LABELS[code] ?? code.replace(/_/g, ' ');
}

/** What went wrong, in words a person would use. The sentence above is what a detail view says. */
export const FINDING_PLAIN: Record<FindingCode, string> = {
  not_x402: 'Not a paid API',
  challenge_timeout: 'Took too long to answer',
  no_accepts: 'No way to pay',
  no_mainnet_accept: 'Not payable on Celo',
  payto_zero: 'Payments go nowhere',
  payto_invalid: 'Payee address is wrong',
  asset_is_fee_adapter: 'Wrong token address',
  permit2_method_missing: 'Peso token set up wrong',
  permit2_gas_sponsorship_missing: 'New wallets cannot pay',
  eip712_domain_mismatch: 'Signing setup is off',
  zero_amount: 'Price is zero',
  no_matching_accept: 'No option buyers can use',
  settle_failed: 'Payment did not settle',
  permit2_allowance_required: 'Needs an approval first',
  insufficient_credits: 'Account has no credits',
  facilitator_error: 'Payment was refused',
  transfer_mismatch: 'Wrong amount moved',
  tx_not_found: 'Payment not on chain',
  paid_not_delivered: 'Paid, but no answer',
  delivered_empty: 'Empty answer',
  delivered_invalid_json: 'Answer is broken',
  decimals_mismatch: 'Price in wrong units',
  payto_agent_wallet_mismatch: 'Payee differs from agent',
  timeout_too_short: 'Payment window too short',
  cors_missing: 'Hidden from web apps',
  cors_header_not_exposed: 'Price hidden from web apps',
  schema_mismatch: 'Answer changed shape',
  too_slow: 'Slow to answer',
  nonce_race: 'Clashed with another payment',
  cngn_needs_one_time_approve: 'Needs a one-time approval',
  testnet_entry_present: 'Lists a test network',
  wrong_network: 'Lists another network',
  asset_unknown: 'Unknown token listed',
  price_above_default_buyer_cap: 'Priced above most limits',
  v1_challenge: 'Older payment format',
  no_output_schema: 'Answer not described',
  challenge_slow: 'Slow to show its price',
  ambiguous_after_payment: 'Unclear what came back',
};

export const SKIP_SHORT: Record<SkipReason, string> = {
  not_read_style: 'Not a read',
  opted_out: 'Opted out',
  over_probe_cap: 'Over limit',
  over_endpoint_day_cap: 'Day limit',
  over_event_cap: 'Budget spent',
  seller_settlement_limit: 'Seller limit',
  price_below_unsolicited_minimum: 'Too cheap',
  below_reserve: 'Low wallet',
  insufficient_asset_balance: 'Short of token',
  customer_fee_fraction_exceeded: 'Over fee share',
  unpriced_asset: 'No dollar price',
  unsafe_url: 'Unsafe URL',
  redirect_blocked: 'Redirect blocked',
  response_too_large: 'Too large',
};

export const REASON_SHORT: Record<IndependenceReason, string> = {
  counted: 'Counts',
  is_project_wallet: 'Ours',
  funded_by_project: 'Funded by us',
  no_prior_activity: 'No history',
  activity_after_start: 'Too new',
};

export const VERDICT_SHORT: Record<VerdictKind, string> = { PASS: 'Pass', PASS_WITH_WARNINGS: 'Warn', FAIL: 'Fail', AMBIGUOUS: 'Unsure', SKIPPED: 'Skip' };

/** A few words for a verdict code, whichever kind of code it is. */
export function shortLabel(code: string): string {
  return (FINDING_PLAIN as Record<string, string>)[code] ?? (SKIP_SHORT as Record<string, string>)[code] ?? code.replace(/_/g, ' ');
}
