import { describe, expect, test } from 'vitest';
import { concatHex, decodeFunctionData, erc20Abi, keccak256, sliceHex, type Hex } from 'viem';
import { parseTransaction } from 'viem/celo';
import { privateKeyToAddress } from 'viem/accounts';
import { fromDataSuffix, toDataSuffix } from '@celo/attribution-tags';
import { ASSETS } from '@railwalker/core';
import { ConfigError, feeCurrencyFor, loadConfig, makeClients, sendTagged, transferToken, verifyTagged } from '../src';
import { fakeCeloRpc } from './fake-rpc';

const KEY = `0x${'11'.repeat(32)}` as const;
const CODE = 'celo_29928c447ace';
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;
const SEPOLIA = 11142220;

const config = (extra: Record<string, string> = {}) => loadConfig({ AGENT_PRIVATE_KEY: KEY, RAILWALKER_ATTRIBUTION_CODE: CODE, ...extra });

interface ParsedTx {
  type: string;
  chainId: number;
  to: string;
  data: Hex;
  value?: bigint;
  feeCurrency?: string;
}
const parse = (raw: Hex) => parseTransaction(raw as never) as unknown as ParsedTx;

describe('feeCurrencyFor', () => {
  test('returns the fee ADAPTER, never the token', () => {
    expect(feeCurrencyFor('USDC')).toBe('0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B');
    expect(feeCurrencyFor('USDT').toLowerCase()).toBe('0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72');
    expect(feeCurrencyFor('USAT')).toBe('0x0357EE22278c922e1D36cFe6b899269b161880C4');
    for (const s of ['USDC', 'USDT', 'USAT'] as const) expect(feeCurrencyFor(s).toLowerCase()).not.toBe(ASSETS[s].address.toLowerCase());
  });
});

describe('makeClients', () => {
  test('builds the account and the clients for the configured network', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const c = makeClients(config(), { transport: rpc.transport });
    expect(c.account.address).toBe(privateKeyToAddress(KEY));
    expect(c.publicClient.chain.id).toBe(SEPOLIA);
    expect(c.walletClient.chain.id).toBe(SEPOLIA);
    expect(c.attributionCode).toBe(CODE);
  });

  test('mainnet config builds mainnet clients', () => {
    const cfg = loadConfig({ AGENT_PRIVATE_KEY: KEY, RAILWALKER_NETWORK: 'mainnet', RAILWALKER_ATTRIBUTION_CODE: CODE, SELLER_SALT: 'a-long-secret-salt-1234' });
    expect(makeClients(cfg).publicClient.chain.id).toBe(42220);
  });
});

describe('sendTagged', () => {
  test('signs a CIP-64 tx that pays gas in the fee adapter and whose calldata ends with the tag', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const c = makeClients(config(), { transport: rpc.transport });
    const hash = await sendTagged(c, { to: RECIPIENT, data: '0xdeadbeef', fee: 'USDC' });

    const [raw] = rpc.rawTxs();
    expect(rpc.rawTxs()).toHaveLength(1);
    expect(hash).toBe(keccak256(raw!));
    const tx = parse(raw!);
    expect(tx).toMatchObject({ type: 'cip64', chainId: SEPOLIA });
    expect(tx.to.toLowerCase()).toBe(RECIPIENT);
    expect(tx.feeCurrency!.toLowerCase()).toBe(feeCurrencyFor('USDC').toLowerCase());
    expect(tx.data.startsWith('0xdeadbeef')).toBe(true);
    expect(tx.data.endsWith(toDataSuffix(CODE).slice(2))).toBe(true);
    expect(fromDataSuffix(tx.data)).toMatchObject({ codes: [CODE], schemaId: 0 });
  });

  test('gas is estimated in the fee currency too, or the estimate would miss its overhead', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    await sendTagged(makeClients(config(), { transport: rpc.transport }), { to: RECIPIENT, fee: 'USAT' });
    const estimate = rpc.seen.find((c) => c.method === 'eth_estimateGas')!;
    expect(((estimate.params as { feeCurrency?: string }[])[0]!.feeCurrency ?? '').toLowerCase()).toBe(feeCurrencyFor('USAT').toLowerCase());
  });

  test('without a fee symbol gas is paid in CELO, and a plain transfer still carries the tag', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    await sendTagged(makeClients(config(), { transport: rpc.transport }), { to: RECIPIENT, value: 1n });
    const tx = parse(rpc.rawTxs()[0]!);
    expect(tx.type).toBe('eip1559');
    expect(tx.feeCurrency).toBeUndefined();
    expect(tx.value).toBe(1n);
    expect(tx.data).toBe(toDataSuffix(CODE));
  });

  test('refuses to send when no attribution code is configured, and nothing reaches the network', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const untagged = makeClients(loadConfig({ AGENT_PRIVATE_KEY: KEY }), { transport: rpc.transport });
    await expect(sendTagged(untagged, { to: RECIPIENT })).rejects.toThrow(ConfigError);
    expect(rpc.seen).toEqual([]);
  });
});

describe('transferToken', () => {
  test('sends an ERC-20 transfer to the token contract, tagged, with gas in the adapter', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const c = makeClients(config(), { transport: rpc.transport });
    await transferToken(c, { token: 'USDC', to: RECIPIENT, amountAtomic: 5000n, fee: 'USDC' });

    const tx = parse(rpc.rawTxs()[0]!);
    expect(tx.to.toLowerCase()).toBe(ASSETS.USDC.address.toLowerCase());
    expect(tx.feeCurrency!.toLowerCase()).toBe(feeCurrencyFor('USDC').toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: sliceHex(tx.data, 0, 68) })).toMatchObject({ functionName: 'transfer', args: [expect.stringMatching(new RegExp(RECIPIENT, 'i')), 5000n] });
    expect(fromDataSuffix(tx.data)).toMatchObject({ codes: [CODE] });
  });
});

describe('verifyTagged', () => {
  const HASH = `0x${'ab'.repeat(32)}` as const;
  const clientReturning = (input: string | null) => ({ publicClient: { getTransaction: async () => (input === null ? null : { input }) } }) as never;

  test('reads the codes back from the transaction', async () => {
    const input = concatHex(['0xa9059cbb', toDataSuffix(CODE)]);
    expect(await verifyTagged(clientReturning(input), HASH)).toMatchObject({ codes: [CODE], schemaId: 0 });
  });

  test('an untagged or unknown transaction is null', async () => {
    expect(await verifyTagged(clientReturning('0xa9059cbb'), HASH)).toBeNull();
    expect(await verifyTagged(clientReturning(null), HASH)).toBeNull();
  });

  test('an RPC failure is null, never a throw', async () => {
    const failing = { publicClient: { getTransaction: async () => { throw new Error('rpc down'); } } } as never;
    expect(await verifyTagged(failing, HASH)).toBeNull();
  });
});
