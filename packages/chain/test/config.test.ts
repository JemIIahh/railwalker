import { describe, expect, test } from 'vitest';
import { privateKeyToAddress } from 'viem/accounts';
import { AttributionMismatchError, ConfigError, assertAttributionMatchesRepo, loadConfig } from '../src';

const KEY = `0x${'11'.repeat(32)}` as const;
const AGENT = privateKeyToAddress(KEY);
const CODE = 'celo_29928c447ace';
const SALT = 'a-long-secret-salt-1234';

const dev = { AGENT_PRIVATE_KEY: KEY };
const prod = { AGENT_PRIVATE_KEY: KEY, RAILWALKER_NETWORK: 'mainnet', RAILWALKER_ATTRIBUTION_CODE: CODE, SELLER_SALT: SALT };

describe('loadConfig', () => {
  test('defaults to Sepolia, the project repo, the hosted facilitator and the agent as payee', () => {
    expect(loadConfig(dev)).toMatchObject({
      network: 'sepolia',
      chainId: 11142220,
      rpcUrl: 'https://forno.celo-sepolia.celo-testnet.org',
      agentPrivateKey: KEY,
      attributionCode: '',
      repoSlug: 'JemIIahh/railwalker',
      facilitatorUrl: 'https://api.x402.celo.org',
      payTo: AGENT,
    });
    expect(loadConfig(dev).x402ApiKey).toBeUndefined();
    expect(loadConfig(dev).agentId).toBeUndefined();
  });

  test('a complete mainnet environment resolves to chain 42220 and the tagged code', () => {
    expect(loadConfig(prod)).toMatchObject({ network: 'mainnet', chainId: 42220, rpcUrl: 'https://forno.celo.org', attributionCode: CODE, sellerSalt: SALT });
  });

  test('mainnet without an attribution code is refused', () => {
    expect(() => loadConfig({ ...prod, RAILWALKER_ATTRIBUTION_CODE: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...prod, RAILWALKER_ATTRIBUTION_CODE: undefined })).toThrow(/RAILWALKER_ATTRIBUTION_CODE/);
  });

  test('sepolia may run without a code (dev)', () => {
    expect(loadConfig(dev).attributionCode).toBe('');
  });

  test('a code that does not match the repo is refused on every network', () => {
    expect(() => loadConfig({ ...dev, RAILWALKER_ATTRIBUTION_CODE: 'celo_000000000000' })).toThrow(AttributionMismatchError);
    expect(() => loadConfig({ ...prod, RAILWALKER_ATTRIBUTION_CODE: 'celo_000000000000' })).toThrow(AttributionMismatchError);
  });

  test('RAILWALKER_REPO moves the code that is expected', () => {
    const env = { ...dev, RAILWALKER_REPO: 'gigahierz/trading-bot-updown', RAILWALKER_ATTRIBUTION_CODE: 'celo_7b3c251337be' };
    expect(loadConfig(env)).toMatchObject({ repoSlug: 'gigahierz/trading-bot-updown', attributionCode: 'celo_7b3c251337be' });
    expect(() => loadConfig({ ...env, RAILWALKER_REPO: 'JemIIahh/railwalker' })).toThrow(AttributionMismatchError);
  });

  test('mainnet needs a real SELLER_SALT: the privacy hash is only as good as the secret', () => {
    expect(() => loadConfig({ ...prod, SELLER_SALT: undefined })).toThrow(/SELLER_SALT/);
    expect(() => loadConfig({ ...prod, SELLER_SALT: 'short' })).toThrow(/SELLER_SALT/);
  });

  test('a malformed key is refused and never echoed', () => {
    const bad = '0xSECRETSECRETSECRET';
    expect(() => loadConfig({ AGENT_PRIVATE_KEY: bad })).toThrow(ConfigError);
    try {
      loadConfig({ AGENT_PRIVATE_KEY: bad });
    } catch (err) {
      expect((err as Error).message).toContain('AGENT_PRIVATE_KEY');
      expect((err as Error).message).not.toContain('SECRETSECRET');
    }
  });

  test('a missing key is refused by name', () => {
    expect(() => loadConfig({})).toThrow(/AGENT_PRIVATE_KEY/);
  });

  test('an unknown network is refused', () => {
    expect(() => loadConfig({ ...dev, RAILWALKER_NETWORK: 'alfajores' })).toThrow(/RAILWALKER_NETWORK/);
  });

  test('empty strings count as unset, the way a blank .env line should', () => {
    const cfg = loadConfig({ ...dev, RAILWALKER_ATTRIBUTION_CODE: '', X402_API_KEY: '', SELLER_PAY_TO: '', CELO_RPC_URL: '', RAILWALKER_AGENT_ID: '' });
    expect(cfg).toMatchObject({ attributionCode: '', payTo: AGENT });
    expect(cfg.x402ApiKey).toBeUndefined();
  });

  test('SELLER_PAY_TO is checksummed, and refused when malformed', () => {
    expect(loadConfig({ ...dev, SELLER_PAY_TO: '0x2222222222222222222222222222222222222222' }).payTo).toBe('0x2222222222222222222222222222222222222222');
    expect(loadConfig({ ...dev, SELLER_PAY_TO: AGENT.toLowerCase() }).payTo).toBe(AGENT);
    expect(() => loadConfig({ ...dev, SELLER_PAY_TO: '0x123' })).toThrow(/SELLER_PAY_TO/);
  });

  test('RAILWALKER_AGENT_ID parses to a bigint and refuses anything else', () => {
    expect(loadConfig({ ...dev, RAILWALKER_AGENT_ID: '12345' }).agentId).toBe(12345n);
    expect(() => loadConfig({ ...dev, RAILWALKER_AGENT_ID: 'abc' })).toThrow(/RAILWALKER_AGENT_ID/);
  });

  test('CELO_RPC_URL overrides the default and must be https', () => {
    expect(loadConfig({ ...dev, CELO_RPC_URL: 'https://rpc.example/celo' }).rpcUrl).toBe('https://rpc.example/celo');
    expect(() => loadConfig({ ...dev, CELO_RPC_URL: 'http://rpc.example/celo' })).toThrow(/CELO_RPC_URL/);
  });

  test('X402_API_KEY is passed through', () => {
    expect(loadConfig({ ...dev, X402_API_KEY: 'k_123' }).x402ApiKey).toBe('k_123');
  });

  test('every problem is reported at once, so one run fixes the whole .env', () => {
    expect(() => loadConfig({ RAILWALKER_NETWORK: 'nope', RAILWALKER_AGENT_ID: 'x' })).toThrow(/AGENT_PRIVATE_KEY.*RAILWALKER_NETWORK.*RAILWALKER_AGENT_ID|RAILWALKER_NETWORK.*AGENT_PRIVATE_KEY/s);
  });

  test('ConfigError is a named Error', () => {
    try {
      loadConfig({});
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('ConfigError');
    }
  });
});

describe('assertAttributionMatchesRepo', () => {
  test('code must match the repo', () => {
    expect(() => assertAttributionMatchesRepo('celo_29928c447ace', 'JemIIahh/railwalker')).not.toThrow();
    expect(() => assertAttributionMatchesRepo('celo_7b3c251337be', 'gigahierz/trading-bot-updown')).not.toThrow(); // Celo's documented example
    expect(() => assertAttributionMatchesRepo('celo_000000000000', 'JemIIahh/railwalker')).toThrow(AttributionMismatchError);
  });

  test('the error names both codes, so the fix is obvious', () => {
    expect(() => assertAttributionMatchesRepo('celo_000000000000', 'JemIIahh/railwalker')).toThrow(/celo_29928c447ace.*celo_000000000000|celo_000000000000.*celo_29928c447ace/s);
  });

  test('a repo that is not owner/repo cannot match anything', () => {
    expect(() => assertAttributionMatchesRepo(CODE, 'not-a-repo')).toThrow(AttributionMismatchError);
  });
});
