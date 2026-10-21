import { custom, keccak256, numberToHex, type Hex } from 'viem';

export interface RpcCall {
  method: string;
  params: unknown;
}

/** A Celo JSON-RPC that answers just enough for viem to estimate, sign and "send"; every call is recorded. */
export function fakeCeloRpc(chainId: number) {
  const seen: RpcCall[] = [];
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
        case 'eth_sendRawTransaction':
          return keccak256((params as Hex[])[0]!);
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
