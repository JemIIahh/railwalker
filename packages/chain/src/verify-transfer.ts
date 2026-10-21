import { TransactionReceiptNotFoundError, erc20Abi, parseEventLogs, type Hash, type PublicClient } from 'viem';

export interface ExpectedTransfer {
  txHash: Hash;
  asset: string;
  from: string;
  to: string;
  amountAtomic: string;
}

export interface TransferCheck {
  ok: boolean;
  reason?: 'tx_not_found' | 'reverted' | 'transfer_mismatch';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isNotFound = (err: unknown) => err instanceof TransactionReceiptNotFoundError || (err as Error)?.name === 'TransactionReceiptNotFoundError';

/**
 * A seller's settlement hash is its own claim. This reads the chain: the transaction must have succeeded and its receipt must
 * carry an ERC-20 Transfer, emitted by `asset`, of exactly this amount between exactly these two addresses.
 * A receipt that is not visible yet is retried (RPC nodes lag); an RPC failure is not a verdict about the seller and propagates.
 */
export async function verifySettlementOnChain(
  publicClient: Pick<PublicClient, 'getTransactionReceipt'>,
  a: ExpectedTransfer,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<TransferCheck> {
  if (!/^\d+$/.test(a.amountAtomic)) throw new RangeError('amountAtomic must be an integer string of atomic units');
  const attempts = Math.max(1, opts.attempts ?? 3);

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  for (let attempt = 1; ; attempt++) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: a.txHash });
      break;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      if (attempt >= attempts) return { ok: false, reason: 'tx_not_found' };
      await sleep(opts.delayMs ?? 1000);
    }
  }

  if (receipt.status !== 'success') return { ok: false, reason: 'reverted' };
  const amount = BigInt(a.amountAtomic);
  const matched = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).some(
    (log) => same(log.address, a.asset) && same(log.args.from, a.from) && same(log.args.to, a.to) && log.args.value === amount,
  );
  return matched ? { ok: true } : { ok: false, reason: 'transfer_mismatch' };
}
