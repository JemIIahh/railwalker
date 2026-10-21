export type AssetSymbol = 'USDC' | 'USDT' | 'USAT' | 'wARS' | 'wBRL' | 'wMXN' | 'wCOP' | 'wPEN' | 'wCLP' | 'cNGN';

export interface AssetInfo {
  symbol: AssetSymbol;
  address: `0x${string}`;
  decimals: 6 | 18;
  method: 'eip3009' | 'permit2';
  eip712Name: string;
  eip712Version: string;
  usdPegged: boolean;
  /** Fee-currency ADAPTER (CIP-64). The token address must never be used as `feeCurrency`. */
  feeAdapter?: `0x${string}`;
}

/** Celo's hosted x402 facilitator table (GET /supported, 2026-10-21). Key order is part of the contract. */
export const ASSETS: Record<AssetSymbol, AssetInfo> = {
  USDC: {
    symbol: 'USDC',
    address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    decimals: 6,
    method: 'eip3009',
    eip712Name: 'USDC',
    eip712Version: '2',
    usdPegged: true,
    feeAdapter: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    decimals: 6,
    method: 'eip3009',
    eip712Name: 'Tether USD',
    eip712Version: '1',
    usdPegged: true,
    feeAdapter: '0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72',
  },
  USAT: {
    symbol: 'USAT',
    address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
    decimals: 6,
    method: 'eip3009',
    eip712Name: 'Tether America USD',
    eip712Version: '1',
    usdPegged: true,
    feeAdapter: '0x0357EE22278c922e1D36cFe6b899269b161880C4',
  },
  wARS: {
    symbol: 'wARS',
    address: '0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D',
    decimals: 18,
    method: 'permit2',
    eip712Name: 'Peso Argentino',
    eip712Version: '1',
    usdPegged: false,
  },
  wBRL: {
    symbol: 'wBRL',
    address: '0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0',
    decimals: 18,
    method: 'permit2',
    eip712Name: 'Real Brasileño',
    eip712Version: '1',
    usdPegged: false,
  },
  wMXN: {
    symbol: 'wMXN',
    address: '0x337E7456B420bD3481e7FA61fA9850343d610d34',
    decimals: 18,
    method: 'permit2',
    eip712Name: 'Peso Mexicano',
    eip712Version: '1',
    usdPegged: false,
  },
  wCOP: {
    symbol: 'wCOP',
    address: '0x8a1D45e102e886510e891d2Ec656a708991e2D76',
    decimals: 18,
    method: 'permit2',
    eip712Name: 'Peso Colombiano',
    eip712Version: '1',
    usdPegged: false,
  },
  wPEN: {
    symbol: 'wPEN',
    address: '0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE',
    decimals: 18,
    method: 'permit2',
    eip712Name: 'Sol Peruano',
    eip712Version: '1',
    usdPegged: false,
  },
  wCLP: {
    symbol: 'wCLP',
    address: '0x61D450a098b6a7f69fC4b98CE68198fe59768651',
    decimals: 18,
    method: 'permit2',
    eip712Name: 'Peso Chileno',
    eip712Version: '1',
    usdPegged: false,
  },
  cNGN: {
    symbol: 'cNGN',
    address: '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f',
    decimals: 6,
    method: 'permit2',
    eip712Name: 'cNGN',
    eip712Version: '1',
    usdPegged: false,
  },
};

const BY_ADDRESS = new Map<string, AssetInfo>(Object.values(ASSETS).map((a) => [a.address.toLowerCase(), a]));

export function assetByAddress(address: string): AssetInfo | null {
  return BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

export const CELO_MAINNET = 42220;
export const CELO_SEPOLIA = 11142220;

const CHAIN_IDS = new Map<string, number>([
  ['celo', CELO_MAINNET],
  ['eip155:42220', CELO_MAINNET],
  ['celo-sepolia', CELO_SEPOLIA],
  ['eip155:11142220', CELO_SEPOLIA],
]);

/** Celo mainnet or Celo Sepolia only; every other network (including other EVM chains) is null. */
export function chainIdOf(network: string): number | null {
  return CHAIN_IDS.get(network) ?? null;
}
