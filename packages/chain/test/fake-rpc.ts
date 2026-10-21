import { custom, keccak256, numberToHex, type Hex } from 'viem';
import { parseTransaction } from 'viem/celo';

export interface RpcCall {
  method: string;
  params: unknown;
}

export interface ReceiptPlan {
  status?: 'success' | 'reverted';
  /** JSON-RPC log objects the receipt carries. */
  logs?: unknown[];
}

/**
 * A Celo JSON-RPC that answers just enough for viem to estimate, sign, "send" and wait; every call is recorded.
 * `receipt` decides what a mined transaction's receipt looks like, given what was sent.
 */
export function fakeCeloRpc(chainId: number, opts: { receipt?: (sent: { hash: Hex; to: string | null; data: Hex }) => ReceiptPlan } = {}) {
  const seen: RpcCall[] = [];
  const sent = new Map<string, Hex>();
  const zero32 = `0x${'00'.repeat(32)}`;
  const transport = custom({
    async request({ method, params }: RpcCall) {
      seen.push({ method, params });
      switch (method) {
        case 'eth_chainId':
          return numberToHex(chainId);
        case 'eth_getTransactionCount':
          return '0x7';
        case 'eth_getBlockByNumber':
          return { number: '0x10', hash: `0x${'11'.repeat(32)}`, parentHash: zero32, timestamp: '0x65000000', baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [] };
        case 'eth_gasPrice':
          return '0x77359400'; // 2 gwei (in the fee currency when one is passed)
        case 'eth_maxPriorityFeePerGas':
          return '0x3b9aca00'; // 1 gwei
        case 'eth_estimateGas':
          return '0x30d40';
        case 'eth_sendRawTransaction': {
          const raw = (params as Hex[])[0]!;
          const hash = keccak256(raw);
          sent.set(hash, raw);
          return hash;
        }
        case 'eth_blockNumber':
          return '0x11';
        case 'eth_getTransactionByHash':
          return null;
        case 'eth_getTransactionReceipt': {
          const hash = (params as Hex[])[0]!;
          const raw = sent.get(hash);
          if (!raw) return null;
          const tx = parseTransaction(raw as never) as unknown as { to?: string; data?: Hex };
          const plan = opts.receipt?.({ hash, to: tx.to ?? null, data: tx.data ?? '0x' }) ?? {};
          return {
            transactionHash: hash,
            transactionIndex: '0x0',
            blockHash: `0x${'22'.repeat(32)}`,
            blockNumber: '0x10',
            from: `0x${'11'.repeat(20)}`,
            to: tx.to ?? null,
            cumulativeGasUsed: '0x5208',
            gasUsed: '0x5208',
            effectiveGasPrice: '0x3b9aca00',
            contractAddress: null,
            logs: plan.logs ?? [],
            logsBloom: `0x${'00'.repeat(256)}`,
            status: plan.status === 'reverted' ? '0x0' : '0x1',
            type: '0x2',
          };
        }
        default:
          throw new Error(`fakeCeloRpc: unexpected ${method}`);
      }
    },
  });
  return {
    transport,
    seen,
    /** The signed transactions that were broadcast. */
    rawTxs: () => seen.filter((c) => c.method === 'eth_sendRawTransaction').map((c) => (c.params as Hex[])[0]!),
  };
}
