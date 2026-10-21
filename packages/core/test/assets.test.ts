import { describe, expect, test } from 'vitest';
import { ASSETS, CELO_MAINNET, CELO_SEPOLIA, ZERO_ADDRESS, assetByAddress, chainIdOf } from '../src/assets';

describe('assets', () => {
  test('table matches the spec', () => {
    expect(Object.keys(ASSETS)).toEqual(['USDC', 'USDT', 'USAT', 'wARS', 'wBRL', 'wMXN', 'wCOP', 'wPEN', 'wCLP', 'cNGN']);
    expect(ASSETS.wARS).toMatchObject({ decimals: 18, method: 'permit2', eip712Name: 'Peso Argentino', eip712Version: '1' });
    expect(ASSETS.USAT.feeAdapter).toBe('0x0357EE22278c922e1D36cFe6b899269b161880C4');
    expect(ASSETS.cNGN).toMatchObject({ decimals: 6, method: 'permit2' });
  });

  test('only USDC, USDT and USAT are USD pegged and carry fee adapters', () => {
    const pegged = Object.values(ASSETS).filter((a) => a.usdPegged).map((a) => a.symbol);
    expect(pegged).toEqual(['USDC', 'USDT', 'USAT']);
    expect(Object.values(ASSETS).filter((a) => a.feeAdapter).map((a) => a.symbol)).toEqual(['USDC', 'USDT', 'USAT']);
  });

  test('lookup is case-insensitive', () =>
    expect(assetByAddress('0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d')?.symbol).toBe('wARS'));

  test('lookup of an unknown address is null', () =>
    expect(assetByAddress('0x01C5C0122039549AD1493B8220cABEdD739BC44E')).toBeNull());

  test('chainIdOf', () => {
    expect(chainIdOf('celo')).toBe(42220);
    expect(chainIdOf('celo-sepolia')).toBe(11142220);
    expect(chainIdOf('eip155:42220')).toBe(42220);
    expect(chainIdOf('eip155:11142220')).toBe(11142220);
    expect(chainIdOf('base')).toBeNull();
  });

  test('the zero address is the 20-byte zero address', () => {
    expect(ZERO_ADDRESS).toBe(`0x${'0'.repeat(40)}`);
  });

  test('the chain-id constants are the ones chainIdOf resolves to', () => {
    expect(CELO_MAINNET).toBe(42220);
    expect(CELO_SEPOLIA).toBe(11142220);
    expect(chainIdOf('celo')).toBe(CELO_MAINNET);
    expect(chainIdOf('celo-sepolia')).toBe(CELO_SEPOLIA);
  });
});
