import { isAddress } from 'viem';
import { ASSETS, CELO_MAINNET, CELO_SEPOLIA, type AssetSymbol } from './assets';
import type { Accept, Challenge } from './challenge';
import { makeFinding, type Finding, type FindingCode } from './findings';

export interface LintContext {
  /** The agentWallet from the seller's ERC-8004 registration, when known. */
  agentWallet?: string | null;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const POSITIVE_INTEGER = /^[1-9]\d*$/;
/** Celo's buyer default: payments above $1 of a default asset are refused unless the buyer raises the cap. */
const DEFAULT_BUYER_CAP_ATOMIC = 1_000_000n;
const MIN_SAFE_TIMEOUT_SECONDS = 30;

const ADAPTERS = new Map<string, AssetSymbol>(
  Object.values(ASSETS).flatMap((a) => (a.feeAdapter ? [[a.feeAdapter.toLowerCase(), a.symbol] as const] : [])),
);

function finding(code: FindingCode, message: string, evidence: Record<string, unknown> = {}, assetSymbol?: AssetSymbol): Finding {
  return makeFinding(code, message, evidence, { assetSymbol });
}

function lintAccept(a: Accept, challenge: Challenge, ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  const adapterOf = ADAPTERS.get(a.asset.toLowerCase());
  const symbol = a.assetInfo?.symbol ?? adapterOf;
  const at = symbol;

  if (adapterOf) {
    out.push(
      finding(
        'asset_is_fee_adapter',
        `The asset ${a.asset} is the 18-decimal fee-currency adapter for ${adapterOf}, not the token. Payers will sign for the wrong contract and prices are off by 10^12.`,
        { asset: a.asset, adapterFor: adapterOf },
        at,
      ),
    );
  } else if (!a.assetInfo) {
    out.push(finding('asset_unknown', `The asset ${a.asset} is not in Celo's facilitator table, so this tool cannot judge it.`, { asset: a.asset }));
  }

  const info = a.assetInfo;
  if (info) {
    if (info.method === 'permit2') {
      if (a.extra.assetTransferMethod !== 'permit2') {
        out.push(
          finding(
            'permit2_method_missing',
            `${info.symbol} settles through Permit2 but extra.assetTransferMethod is not "permit2", so clients will try an EIP-3009 payment that cannot work.`,
            { assetTransferMethod: a.extra.assetTransferMethod ?? null },
            info.symbol,
          ),
        );
      }
      if (info.symbol === 'cNGN') {
        out.push(
          finding('cngn_needs_one_time_approve', 'cNGN has no EIP-2612 permit: each payer must send a one-time approve to Permit2 and pay that gas themselves.', {}, info.symbol),
        );
      } else if (!('eip2612GasSponsoring' in challenge.extensions)) {
        out.push(
          finding(
            'permit2_gas_sponsorship_missing',
            `The route lacks extensions.eip2612GasSponsoring, so first-time wallets paying ${info.symbol} get 412 permit2_allowance_required.`,
            { extensions: Object.keys(challenge.extensions) },
            info.symbol,
          ),
        );
      }
    }

    if (a.extra.name !== info.eip712Name || a.extra.version !== info.eip712Version) {
      out.push(
        finding(
          'eip712_domain_mismatch',
          `extra.name/version must be the EIP-712 domain of ${info.symbol} ("${info.eip712Name}", "${info.eip712Version}"); signatures built from this will not verify.`,
          { name: a.extra.name ?? null, version: a.extra.version ?? null, expectedName: info.eip712Name, expectedVersion: info.eip712Version },
          info.symbol,
        ),
      );
    }
  }

  if (!POSITIVE_INTEGER.test(a.amountAtomic)) {
    out.push(finding('zero_amount', 'The amount is missing or is not a positive integer string in base units.', { amountAtomic: a.amountAtomic }, at));
  } else if (info) {
    const amount = BigInt(a.amountAtomic);
    if (info.decimals === 6 && amount >= 10n ** 12n) {
      out.push(finding('decimals_mismatch', `${info.symbol} has 6 decimals but the amount looks like an 18-decimal value.`, { amountAtomic: a.amountAtomic }, info.symbol));
    } else if (info.decimals === 18 && amount < 10n ** 9n) {
      out.push(finding('decimals_mismatch', `${info.symbol} has 18 decimals but the amount looks like a 6-decimal value.`, { amountAtomic: a.amountAtomic }, info.symbol));
    }
    if (info.usdPegged && amount > DEFAULT_BUYER_CAP_ATOMIC) {
      out.push(finding('price_above_default_buyer_cap', 'The price is above $1, the default per-payment cap of Celo x402 buyers.', { amountAtomic: a.amountAtomic }, info.symbol));
    }
  }

  const payTo = a.payTo;
  if (payTo.toLowerCase() === ZERO_ADDRESS) {
    out.push(finding('payto_zero', 'payTo is the zero address: payments would be burned.', { payTo }, at));
  } else if (!isAddress(payTo, { strict: true })) {
    out.push(finding('payto_invalid', 'payTo is not a valid address (or its checksum is wrong), so buyers cannot build the payment.', { payTo }, at));
  } else if (ctx.agentWallet && payTo.toLowerCase() !== ctx.agentWallet.toLowerCase()) {
    out.push(finding('payto_agent_wallet_mismatch', 'payTo differs from the agentWallet in the seller\'s ERC-8004 registration.', { payTo, agentWallet: ctx.agentWallet }, at));
  }

  if (a.maxTimeoutSeconds !== null && a.maxTimeoutSeconds < MIN_SAFE_TIMEOUT_SECONDS) {
    out.push(
      finding('timeout_too_short', `maxTimeoutSeconds is ${a.maxTimeoutSeconds}; Celo settlement takes about 9 s at the median and 18 s at p95.`, { maxTimeoutSeconds: a.maxTimeoutSeconds }, at),
    );
  }
  return out;
}

/** Static lints of a parsed challenge. Everything here is PREDICTED: nothing was paid. */
export function runLints(challenge: Challenge, ctx: LintContext = {}): Finding[] {
  const out: Finding[] = [];
  const { accepts } = challenge;

  if (accepts.length === 0) {
    out.push(finding('no_accepts', 'The challenge lists no payment options.'));
  } else {
    const networks = accepts.map((a) => a.network);
    if (!accepts.some((a) => a.chainId === CELO_MAINNET)) {
      out.push(finding('no_mainnet_accept', 'No accept is on Celo mainnet (eip155:42220).', { networks }));
    }
    if (accepts.some((a) => a.chainId === CELO_SEPOLIA)) {
      out.push(finding('testnet_entry_present', 'A Celo Sepolia (sandbox) accept is mixed into the production challenge. It is never paid.', { networks }));
    }
    if (accepts.some((a) => a.chainId === null)) {
      out.push(finding('wrong_network', 'Some accepts are on networks other than Celo; only Celo mainnet accepts are considered.', { networks }));
    }
    for (const a of accepts) {
      if (a.chainId === CELO_MAINNET) out.push(...lintAccept(a, challenge, ctx));
    }
  }

  if (challenge.version === 1) out.push(finding('v1_challenge', 'Legacy x402 v1 challenge; v2-only clients may not pay it.'));
  if (!challenge.hasOutputSchema) out.push(finding('no_output_schema', 'No outputSchema is advertised, so delivery can only be checked against previously seen responses.'));
  return out;
}
