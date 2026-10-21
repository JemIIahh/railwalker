import { describe, expect, test } from 'vitest';
import { TransactionReceiptNotFoundError, encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem';
import { ASSETS } from '@railwalker/core';
import { verifySettlementOnChain } from '../src';

const TOKEN = ASSETS.USDC.address;
const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'ab'.repeat(32)}` as const;
const expected = { txHash: HASH, asset: TOKEN, from: FROM, to: TO, amountAtomic: '5000' };

function transfer(over: { address?: string; from?: string; to?: string; value?: bigint } = {}) {
  return {
    address: over.address ?? TOKEN,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: (over.from ?? FROM) as `0x${string}`, to: (over.to ?? TO) as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [over.value ?? 5000n]),
  };
}
const receipt = (logs: ReturnType<typeof transfer>[], status: 'success' | 'reverted' = 'success') => ({ status, logs });
const client = (get: () => unknown) => ({ getTransactionReceipt: async () => get() }) as never;
const notFound = () => {
  throw new TransactionReceiptNotFoundError({ hash: HASH });
};
const once = { attempts: 1 };

describe('verifySettlementOnChain', () => {
  test('ok: the receipt carries exactly the Transfer the seller claimed', async () => {
    expect(await verifySettlementOnChain(client(() => receipt([transfer()])), expected, once)).toEqual({ ok: true });
  });

  test('ok: found among unrelated logs, with addresses compared case-insensitively', async () => {
    const logs = [transfer({ address: ASSETS.USDT.address }), transfer({ value: 1n }), transfer()];
    const upper = { ...expected, asset: TOKEN.toUpperCase().replace('0X', '0x'), from: FROM.toUpperCase().replace('0X', '0x') };
    expect(await verifySettlementOnChain(client(() => receipt(logs)), upper, once)).toEqual({ ok: true });
  });

  test.each([
    ['reverted', () => receipt([transfer()], 'reverted'), 'reverted'],
    ['missing receipt', notFound, 'tx_not_found'],
    ['wrong amount', () => receipt([transfer({ value: 4999n })]), 'transfer_mismatch'],
    ['wrong recipient', () => receipt([transfer({ to: '0x3333333333333333333333333333333333333333' })]), 'transfer_mismatch'],
    ['wrong payer', () => receipt([transfer({ from: '0x4444444444444444444444444444444444444444' })]), 'transfer_mismatch'],
    ['wrong token', () => receipt([transfer({ address: ASSETS.USDT.address })]), 'transfer_mismatch'],
    ['no logs at all', () => receipt([]), 'transfer_mismatch'],
  ] as const)('%s', async (_name, get, reason) => {
    expect(await verifySettlementOnChain(client(get), expected, once)).toEqual({ ok: false, reason });
  });

  test('a receipt that is not visible yet is retried, then found', async () => {
    let calls = 0;
    const c = client(() => (++calls < 3 ? notFound() : receipt([transfer()])));
    expect(await verifySettlementOnChain(c, expected, { attempts: 3, delayMs: 1 })).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  test('and given up on after the attempts, as tx_not_found', async () => {
    let calls = 0;
    const c = client(() => {
      calls++;
      return notFound();
    });
    expect(await verifySettlementOnChain(c, expected, { attempts: 3, delayMs: 1 })).toEqual({ ok: false, reason: 'tx_not_found' });
    expect(calls).toBe(3);
  });

  test('an RPC failure is not a verdict about the seller: it propagates', async () => {
    const c = client(() => {
      throw new Error('rpc down');
    });
    await expect(verifySettlementOnChain(c, expected, once)).rejects.toThrow('rpc down');
  });

  test('an amount that is not an integer string is a programming error', async () => {
    await expect(verifySettlementOnChain(client(() => receipt([])), { ...expected, amountAtomic: '0.5' }, once)).rejects.toThrow(RangeError);
  });
});
