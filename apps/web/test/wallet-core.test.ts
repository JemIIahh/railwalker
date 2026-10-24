import { describe, expect, test } from 'vitest';
import { CELO_ADD_CHAIN, CELO_CHAIN_ID, avatarGradient, bestBalance, dedupeWallets, isCelo, parseChainId, rankWallets, shortAddress, walletErrorText, type DiscoveredWallet } from '../lib/wallet-core';

const wallet = (name: string, rdns = `io.${name.toLowerCase()}`, uuid = `uuid-${name}`): DiscoveredWallet => ({ name, rdns, uuid, icon: 'data:image/svg+xml;base64,AAAA' });

describe('dedupeWallets', () => {
  test('a wallet that announces itself twice is listed once, the first announcement kept', () => {
    const first = wallet('MetaMask');
    const again = { ...wallet('MetaMask'), uuid: 'another' };
    expect(dedupeWallets([first, wallet('Rabby'), again])).toEqual([first, wallet('Rabby')]);
  });

  test('two wallets with different ids are two wallets, even if they share a name', () => {
    expect(dedupeWallets([wallet('Wallet', 'io.a'), wallet('Wallet', 'io.b')])).toHaveLength(2);
  });

  test('nothing in, nothing out', () => {
    expect(dedupeWallets([])).toEqual([]);
  });
});

describe('rankWallets', () => {
  test('the one used last time comes first, then the rest alphabetically without regard to case', () => {
    const list = [wallet('rabby'), wallet('Coinbase'), wallet('MetaMask'), wallet('Brave')];
    expect(rankWallets(list, 'io.metamask').map((w) => w.name)).toEqual(['MetaMask', 'Brave', 'Coinbase', 'rabby']);
  });

  test('alphabetical means by letter, not by code: a lower-case name is not put after every capital', () => {
    expect(rankWallets([wallet('Zed'), wallet('apple')], null).map((w) => w.name)).toEqual(['apple', 'Zed']);
  });

  test('with no favourite, or one that is not installed, it is just alphabetical', () => {
    const list = [wallet('Rabby'), wallet('Brave')];
    expect(rankWallets(list, null).map((w) => w.name)).toEqual(['Brave', 'Rabby']);
    expect(rankWallets(list, 'io.gone').map((w) => w.name)).toEqual(['Brave', 'Rabby']);
  });

  test('the list it was given is not changed', () => {
    const list = [wallet('B'), wallet('A')];
    rankWallets(list, null);
    expect(list.map((w) => w.name)).toEqual(['B', 'A']);
  });
});

describe('shortAddress', () => {
  test('four characters at each end, joined by an ellipsis', () => {
    expect(shortAddress('0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e')).toBe('0x5e5e…5e5e');
    expect(shortAddress('0xA9a9a9a9A9a9a9a9A9a9a9a9A9a9a9a9A9a9a9a9')).toBe('0xA9a9…a9a9');
  });

  test('something too short to shorten, or not an address, is left as it is', () => {
    expect(shortAddress('0x1234')).toBe('0x1234');
    expect(shortAddress('')).toBe('');
  });
});

describe('parseChainId and isCelo', () => {
  test('a wallet says its chain as hex, a number or a decimal string', () => {
    expect(parseChainId('0xa4ec')).toBe(42220);
    expect(parseChainId(42220)).toBe(42220);
    expect(parseChainId('42220')).toBe(42220);
    expect(parseChainId('0XA4EC')).toBe(42220);
  });

  test('anything else is no chain', () => {
    for (const bad of [undefined, null, '', 'celo', '0x', '-1', 1.5, Number.NaN, {}, '0xzz']) expect(parseChainId(bad), String(bad)).toBeNull();
  });

  test('zero is no chain, written any way', () => {
    for (const zero of [0, '0', '0x0', '0x00']) expect(parseChainId(zero), String(zero)).toBeNull();
  });

  test('spaces around it do not matter', () => {
    expect(parseChainId('  0xa4ec  ')).toBe(42220);
    expect(parseChainId(' 42220\n')).toBe(42220);
  });

  test('Celo is chain 42220, and nothing else is', () => {
    expect(CELO_CHAIN_ID).toBe(42220);
    expect(isCelo(42220)).toBe(true);
    expect(isCelo(1)).toBe(false);
    expect(isCelo(11142220)).toBe(false);
    expect(isCelo(null)).toBe(false);
  });
});

describe('avatarGradient', () => {
  const a = '0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e';
  const b = '0xa9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9';

  test('the same address always gets the same two colours, and two addresses usually get different ones', () => {
    expect(avatarGradient(a)).toEqual(avatarGradient(a));
    expect(avatarGradient(a)).not.toEqual(avatarGradient(b));
  });

  test('the case of the address does not matter', () => {
    expect(avatarGradient(a.toUpperCase().replace('0X', '0x'))).toEqual(avatarGradient(a));
  });

  test('the two colours are different hues, and the first one follows the address from its very first characters', () => {
    const hue = (c: string) => Number(/^hsl\((\d+)/.exec(c)![1]);
    const [x, y] = avatarGradient(a);
    expect(hue(x)).not.toBe(hue(y));
    const early = '0x1234560000000000000000000000000000000000';
    const late = '0x4321560000000000000000000000000000000000'; // the same next two characters, a different start
    expect(hue(avatarGradient(early)[0])).not.toBe(hue(avatarGradient(late)[0]));
  });

  test('only a whole address gets colours of its own: too short, too long, or with anything around it is grey', () => {
    const grey = ['hsl(0 0% 80%)', 'hsl(0 0% 62%)'];
    for (const bad of [`${a}0`, a.slice(0, -1), ` ${a}`, `${a} `, `x${a}`, `0x${'zz'.repeat(20)}`]) expect(avatarGradient(bad), bad).toEqual(grey);
  });

  test('two colours, written as hsl', () => {
    const [x, y] = avatarGradient(a);
    expect(x).toMatch(/^hsl\(\d{1,3} \d{1,3}% \d{1,3}%\)$/);
    expect(y).toMatch(/^hsl\(\d{1,3} \d{1,3}% \d{1,3}%\)$/);
    expect(x).not.toBe(y);
  });

  test('something that is not an address gets a quiet grey pair rather than an error', () => {
    expect(avatarGradient('nope')).toEqual(['hsl(0 0% 80%)', 'hsl(0 0% 62%)']);
    expect(avatarGradient('')).toEqual(['hsl(0 0% 80%)', 'hsl(0 0% 62%)']);
  });
});

describe('bestBalance', () => {
  test('the dollar token the wallet holds most of, as dollars', () => {
    expect(bestBalance([{ symbol: 'USDC', atomic: 1_420_000n }, { symbol: 'USDT', atomic: 5_000_000n }, { symbol: 'USAT', atomic: 0n }])).toEqual({ symbol: 'USDT', text: '$5.00' });
  });

  test('cents and fractions of a cent are shown to the digit, never rounded away', () => {
    expect(bestBalance([{ symbol: 'USDC', atomic: 5_000n }])).toEqual({ symbol: 'USDC', text: '$0.005' });
    expect(bestBalance([{ symbol: 'USAT', atomic: 1_234_567n }])).toEqual({ symbol: 'USAT', text: '$1.234567' });
  });

  test('a wallet with none of them has no balance to show', () => {
    expect(bestBalance([{ symbol: 'USDC', atomic: 0n }, { symbol: 'USDT', atomic: 0n }])).toBeNull();
    expect(bestBalance([])).toBeNull();
  });

  test('a tie goes to the one listed first, so the answer never flips', () => {
    expect(bestBalance([{ symbol: 'USDC', atomic: 2_000_000n }, { symbol: 'USDT', atomic: 2_000_000n }])?.symbol).toBe('USDC');
  });
});

describe('walletErrorText: what to say when a wallet says no', () => {
  test('closing the request is not an error: nothing happened, and it is said so kindly', () => {
    expect(walletErrorText({ code: 4001, message: 'User rejected the request.' })).toBe('You closed the wallet request. Nothing happened.');
  });

  test('a request already open in the wallet is said as it is', () => {
    expect(walletErrorText({ code: -32002 })).toBe('A request is already open in your wallet. Open it to carry on.');
  });

  test('a wallet that does not know the network is said plainly', () => {
    expect(walletErrorText({ code: 4902 })).toBe('Your wallet does not have the Celo network yet.');
  });

  test('anything else is a general line, never the wallet’s own technical message', () => {
    expect(walletErrorText(new Error('execution reverted: 0xdeadbeef'))).toBe('We could not connect. Try again.');
    expect(walletErrorText({ code: 5000, message: 'weird' })).toBe('We could not connect. Try again.');
    for (const odd of [null, undefined, 'text', 42]) expect(walletErrorText(odd), String(odd)).toBe('We could not connect. Try again.');
  });
});

describe('CELO_ADD_CHAIN: how to teach a wallet the Celo network', () => {
  test('names the chain by its hex id, with the coin, a public RPC and an explorer', () => {
    expect(CELO_ADD_CHAIN.chainId).toBe('0xa4ec');
    expect(parseChainId(CELO_ADD_CHAIN.chainId)).toBe(CELO_CHAIN_ID);
    expect(CELO_ADD_CHAIN.chainName).toBe('Celo');
    expect(CELO_ADD_CHAIN.nativeCurrency).toEqual({ name: 'CELO', symbol: 'CELO', decimals: 18 });
    expect(CELO_ADD_CHAIN.rpcUrls).toEqual(['https://forno.celo.org']);
    expect(CELO_ADD_CHAIN.blockExplorerUrls).toEqual(['https://celo.blockscout.com']);
  });
});
