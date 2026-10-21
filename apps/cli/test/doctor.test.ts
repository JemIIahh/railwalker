import { describe, expect, test } from 'vitest';
import { ADDRESS, API_KEY, CODE, FAUCET, KEY, MAINNET_ENV, SALT, SEPOLIA_ENV, harness } from './harness';

describe('doctor', () => {
  test('a healthy mainnet setup: every line ok, exit 0', async () => {
    const h = harness();
    expect(await h.run('doctor')).toBe(0);
    const out = h.out();
    expect(out).toMatch(/^ok\s+config/m);
    expect(out).toMatch(/^ok\s+attribution.*celo_29928c447ace.*JemIIahh\/railwalker/m);
    expect(out).toMatch(/^ok\s+wallet.*2\.0000/m);
    expect(out).toContain(ADDRESS);
    expect(out).not.toMatch(/^FAIL/m);
  });

  test('reports the network and chain', async () => {
    const m = harness();
    await m.run('doctor');
    expect(m.out()).toMatch(/mainnet.*42220/);
    const s = harness({ env: SEPOLIA_ENV });
    await s.run('doctor');
    expect(s.out()).toMatch(/sepolia.*11142220/);
  });

  test('never prints a secret: not the key, the API key, the salt or the RPC URL', async () => {
    const h = harness({ env: { ...MAINNET_ENV, CELO_RPC_URL: 'https://rpc.example/v1/SECRETRPCTOKEN' } });
    await h.run('doctor');
    for (const secret of [KEY, KEY.slice(2), API_KEY, SALT, 'SECRETRPCTOKEN', 'https://rpc.example']) expect(h.all()).not.toContain(secret);
  });

  test('says whether the API key is set without saying what it is', async () => {
    const withKey = harness();
    await withKey.run('doctor');
    expect(withKey.out()).toMatch(/x402 api key.*set/i);
    const { X402_API_KEY: _drop, ...noKey } = MAINNET_ENV;
    const without = harness({ env: noKey });
    await without.run('doctor');
    expect(without.out()).toMatch(/x402 api key.*not set/i);
  });

  test('a custom RPC is mentioned as custom, not printed', async () => {
    const h = harness({ env: { ...MAINNET_ENV, CELO_RPC_URL: 'https://rpc.example/x' } });
    await h.run('doctor');
    expect(h.out()).toMatch(/rpc.*custom/i);
  });

  describe('config problems', () => {
    test('no wallet: FAIL config with the validator’s message, exit 1, and the other checks are skipped', async () => {
      const h = harness({ env: {} });
      expect(await h.run('doctor')).toBe(1);
      expect(h.out()).toMatch(/^FAIL\s+config.*AGENT_PRIVATE_KEY/m);
      expect(h.calls.readBalances).toBe(0);
    });

    test('mainnet without an attribution code: FAIL, because every transaction must be tagged', async () => {
      const { RAILWALKER_ATTRIBUTION_CODE: _code, ...rest } = MAINNET_ENV;
      const h = harness({ env: rest });
      expect(await h.run('doctor')).toBe(1);
      expect(h.out()).toMatch(/^FAIL\s+config.*RAILWALKER_ATTRIBUTION_CODE/m);
    });

    test('an attribution code that does not match the repo: FAIL, naming both codes', async () => {
      const h = harness({ env: { ...MAINNET_ENV, RAILWALKER_ATTRIBUTION_CODE: 'celo_000000000000' } });
      expect(await h.run('doctor')).toBe(1);
      expect(h.out()).toMatch(/^FAIL/m);
      expect(h.out()).toContain('celo_000000000000');
      expect(h.out()).toContain(CODE);
    });

    test('Sepolia without a code is only a warning: development may run untagged, but cannot send', async () => {
      const { RAILWALKER_ATTRIBUTION_CODE: _code, ...rest } = SEPOLIA_ENV;
      const h = harness({ env: rest });
      expect(await h.run('doctor')).toBe(0);
      expect(h.out()).toMatch(/^warn\s+attribution/m);
    });
  });

  describe('the wallet', () => {
    test('no stablecoins: a warning, because nothing can be paid', async () => {
      const h = harness({ readBalances: async () => ({ celo: 0n, USDC: 0n, USDT: 0n, USAT: 0n }) });
      expect(await h.run('doctor')).toBe(0);
      expect(h.out()).toMatch(/^warn\s+wallet.*no stablecoins/m);
    });

    test('more than the $3 float: a warning, because the hot wallet is the hard cap', async () => {
      const h = harness({ readBalances: async () => ({ ...FAUCET, USAT: 7_000_000n }) });
      expect(await h.run('doctor')).toBe(0);
      expect(h.out()).toMatch(/^warn\s+wallet.*\$3/m);
    });

    test('stablecoins are summed across USDC, USDT and USAT', async () => {
      const h = harness({ readBalances: async () => ({ celo: 0n, USDC: 1_000_000n, USDT: 500_000n, USAT: 250_000n }) });
      await h.run('doctor');
      expect(h.out()).toMatch(/1\.7500/);
    });

    test('a balance that cannot be read is FAIL with the reason, exit 1', async () => {
      const h = harness({
        readBalances: async () => {
          throw new Error('rpc down');
        },
      });
      expect(await h.run('doctor')).toBe(1);
      expect(h.out()).toMatch(/^FAIL\s+wallet.*rpc down/m);
    });

    test('a failure from the chain library is reported by its headline, not its whole dump of the request: no URL, body or calldata', async () => {
      const dump = Object.assign(new Error('HTTP request failed.\n\nURL: https://rpc.example/v1/SECRETRPCTOKEN\nRequest body: {"data":"0x70a08231000000000000000000000000c969521f471a88afbdd90b9e1f9244c59fc2cae9"}\n\nDetails: fetch failed'), { shortMessage: 'HTTP request failed.' });
      const h = harness({ readBalances: async () => Promise.reject(dump) });
      expect(await h.run('doctor')).toBe(1);
      expect(h.out()).toMatch(/^FAIL\s+wallet.*could not read the balance \(HTTP request failed\.\)/m);
      expect(h.all()).not.toMatch(/SECRETRPCTOKEN|Request body|70a08231|[0-9a-f]{64}/);
    });

    test('something that is not an Error being thrown is reported as the text it is', async () => {
      const h = harness({ readBalances: async () => Promise.reject('plain text failure') });
      expect(await h.run('doctor')).toBe(1);
      expect(h.out()).toMatch(/could not read the balance \(plain text failure\)/);
    });

    test('an empty or non-text shortMessage falls back to the message', async () => {
      for (const shortMessage of ['', 7, null, undefined]) {
        const h = harness({ readBalances: async () => Promise.reject(Object.assign(new Error('the real reason'), { shortMessage })) });
        await h.run('doctor');
        expect(h.out(), String(shortMessage)).toMatch(/could not read the balance \(the real reason\)/);
      }
    });
  });

  describe('identity', () => {
    test('not registered yet is information, not a failure', async () => {
      const h = harness();
      expect(await h.run('doctor')).toBe(0);
      expect(h.out()).toMatch(/^info\s+identity.*not registered/m);
    });

    test('a registered agent shows its id', async () => {
      const h = harness({ env: { ...MAINNET_ENV, RAILWALKER_AGENT_ID: '42' } });
      await h.run('doctor');
      expect(h.out()).toMatch(/^ok\s+identity.*42/m);
    });
  });

  test('arguments are a usage error', async () => {
    expect(await harness().run('doctor', 'now')).toBe(2);
  });
});

describe('balance', () => {
  test('prints the address and each balance in human units, and the stablecoin total', async () => {
    const h = harness({ readBalances: async () => ({ celo: 1_500_000_000_000_000_000n, USDC: 1_000_000n, USDT: 0n, USAT: 2_500_000n }) });
    expect(await h.run('balance')).toBe(0);
    expect(h.out()).toContain(ADDRESS);
    expect(h.out()).toMatch(/USDC\s+1\.000000/);
    expect(h.out()).toMatch(/USAT\s+2\.500000/);
    expect(h.out()).toMatch(/CELO\s+1\.5/);
    expect(h.out()).toMatch(/\$3\.5000/);
  });

  test('never prints a secret', async () => {
    const h = harness();
    await h.run('balance');
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(API_KEY);
  });

  test('a config that is invalid is exit 3, and an RPC failure is exit 1', async () => {
    expect(await harness({ env: {} }).run('balance')).toBe(3);
    const h = harness({
      readBalances: async () => {
        throw new Error('rpc down');
      },
    });
    expect(await h.run('balance')).toBe(1);
    expect(h.err()).toContain('rpc down');
  });
});
