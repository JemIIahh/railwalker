import { describe, expect, test } from 'vitest';
import { authHeaders, webConfig } from '../lib/config';

const PAY_TO = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B';

describe('webConfig', () => {
  test('mainnet: the mainnet network, the hosted facilitator, and the payee for the fixtures', () => {
    expect(webConfig({ RAILWALKER_NETWORK: 'mainnet', SELLER_PAY_TO: PAY_TO, X402_API_KEY: 'k_secret_value' })).toEqual({
      network: 'mainnet',
      fixtureNetwork: 'eip155:42220',
      facilitatorUrl: 'https://api.x402.celo.org',
      x402ApiKey: 'k_secret_value',
      fixtures: { payTo: PAY_TO },
      siteUrl: undefined,
    });
  });

  test('anything but mainnet is Sepolia, with its own facilitator: development never touches mainnet by accident', () => {
    for (const env of [{}, { RAILWALKER_NETWORK: 'sepolia' }, { RAILWALKER_NETWORK: 'mainet' }]) {
      expect(webConfig({ ...env, SELLER_PAY_TO: PAY_TO })).toMatchObject({ network: 'sepolia', fixtureNetwork: 'eip155:11142220', facilitatorUrl: 'https://api.x402.sepolia.celo.org' });
    }
  });

  test.each([
    ['no payee', {}],
    ['a payee that is not an address', { SELLER_PAY_TO: '0x123' }],
    ['the zero address', { SELLER_PAY_TO: '0x0000000000000000000000000000000000000000' }],
    ['a payee with a bad checksum', { SELLER_PAY_TO: '0x20faAca5F980E29639A0FCC6dcA6988E18ed333b' }],
  ])('%s turns the fixtures off, with the reason, instead of serving a seller that would burn payments', (_name, env) => {
    const c = webConfig({ RAILWALKER_NETWORK: 'mainnet', ...env });
    expect(c.fixtures).toEqual({ disabledReason: expect.stringMatching(/SELLER_PAY_TO/) });
  });

  test('blank values count as unset, like a blank .env line', () => {
    expect(webConfig({ SELLER_PAY_TO: '', X402_API_KEY: '', RAILWALKER_SITE_URL: '' })).toMatchObject({ x402ApiKey: undefined, siteUrl: undefined, fixtures: { disabledReason: expect.any(String) } });
  });

  test('the site URL must be https, or it is ignored', () => {
    expect(webConfig({ RAILWALKER_SITE_URL: 'https://railwalker.example' }).siteUrl).toBe('https://railwalker.example');
    expect(webConfig({ RAILWALKER_SITE_URL: 'http://railwalker.example' }).siteUrl).toBeUndefined();
    expect(webConfig({ RAILWALKER_SITE_URL: 'not a url' }).siteUrl).toBeUndefined();
  });

  test('the private key is never part of the web configuration: the site pays nothing', () => {
    const c = webConfig({ AGENT_PRIVATE_KEY: `0x${'ab'.repeat(32)}`, SELLER_PAY_TO: PAY_TO });
    expect(JSON.stringify(c)).not.toContain('abab');
  });
});

describe('authHeaders', () => {
  test('the key is sent as X-API-Key, keyed by path as the facilitator client requires', () => {
    expect(authHeaders('k_123')).toEqual({ verify: { 'X-API-Key': 'k_123' }, settle: { 'X-API-Key': 'k_123' }, supported: { 'X-API-Key': 'k_123' } });
  });

  test('with no key there are no auth headers at all', () => {
    expect(authHeaders(undefined)).toBeUndefined();
  });
});
