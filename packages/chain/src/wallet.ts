import { verifyTx, withAttribution } from '@celo/attribution-tags';
import { ASSETS, type AssetSymbol } from '@railwalker/core';
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, type PrivateKeyAccount, type PublicClient, type Transport, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import { ConfigError, type Config } from './config';

type CeloChain = typeof celo | typeof celoSepolia;
type Hash = `0x${string}`;

export interface Clients {
  account: PrivateKeyAccount;
  publicClient: PublicClient<Transport, CeloChain>;
  /** Extended with withAttribution, so everything it sends carries the ERC-8021 tag. */
  walletClient: WalletClient<Transport, CeloChain, PrivateKeyAccount>;
  /** '' only on Sepolia dev: sendTagged refuses to send then. */
  attributionCode: string;
}

export type FeeSymbol = 'USDC' | 'USDT' | 'USAT';

/** Gas is paid with the fee-currency ADAPTER (CIP-64). Passing the token address would not be a whitelisted fee currency. */
export function feeCurrencyFor(s: FeeSymbol): Hash {
  const adapter = ASSETS[s].feeAdapter;
  if (!adapter) throw new Error(`${s} has no fee adapter`); // never fall back to the token address
  return adapter;
}

/** `opts.transport` replaces the HTTP transport, so tests can run against a fake RPC. */
export function makeClients(cfg: Config, opts: { transport?: Transport } = {}): Clients {
  const chain = cfg.network === 'mainnet' ? celo : celoSepolia;
  const transport = opts.transport ?? http(cfg.rpcUrl);
  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const wallet = createWalletClient({ account, chain, transport });
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: cfg.attributionCode ? wallet.extend(withAttribution(cfg.attributionCode)) : wallet,
    attributionCode: cfg.attributionCode,
  };
}

/**
 * The only way this package sends a transaction. It never sends one that is not tagged: the ERC-8021 tag is what makes a
 * transaction count, and a tag cannot be added afterwards.
 */
export async function sendTagged(c: Clients, tx: { to: Hash; data?: Hash; value?: bigint; fee?: FeeSymbol }): Promise<Hash> {
  if (c.attributionCode === '') throw new ConfigError('no attribution code is configured: refusing to send an untagged transaction');
  return c.walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    ...(tx.fee ? { feeCurrency: feeCurrencyFor(tx.fee) } : {}),
  });
}

/** A plain ERC-20 transfer. Whether a transfer is allowed at all is the caller's policy, not this function's. */
export function transferToken(c: Clients, a: { token: AssetSymbol; to: Hash; amountAtomic: bigint; fee?: FeeSymbol }): Promise<Hash> {
  return sendTagged(c, {
    to: ASSETS[a.token].address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [a.to, a.amountAtomic] }),
    fee: a.fee,
  });
}

/** The ERC-8021 codes found in a transaction's calldata, or null when it is untagged, unknown or the RPC fails. */
export function verifyTagged(c: Pick<Clients, 'publicClient'>, hash: Hash): Promise<{ codes: string[]; schemaId: number } | null> {
  return verifyTx({ client: c.publicClient, hash });
}
