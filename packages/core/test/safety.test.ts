import { describe, expect, test } from 'vitest';
import { classifyReadStyle, type EndpointFacts } from '../src/safety';

const facts = (over: Partial<EndpointFacts>): EndpointFacts => ({
  url: 'https://gateway.usebuy.ai/v1/social/x/posts/search',
  method: 'POST',
  source: 'buy',
  ...over,
});

describe('classifyReadStyle', () => {
  test.each<[Partial<EndpointFacts>, boolean]>([
    [{ capabilityId: 'x.posts.search', source: 'buy' }, true],
    [{ capabilityId: 'flights.search', source: 'buy' }, true],
    [{ capabilityId: 'browser.sessions.create', description: 'Rent an isolated agent browser', source: 'buy' }, false],
    [{ url: 'https://x.test/api/pay-bill', source: 'erc8004' }, false],
    [{ url: 'https://x.test/v1/vm/provision', source: 'erc8004' }, false],
    [{ url: 'https://x.test/premium', method: 'GET', source: 'erc8004' }, true],
    [{ url: 'https://x.test/api/send', method: 'POST', source: 'visitor' }, false],
  ])('classifyReadStyle %o -> %s', (over, expected) => {
    const r = classifyReadStyle(facts(over));
    expect(r.readStyle).toBe(expected);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  test('matches whole words, not substrings', () => {
    expect(classifyReadStyle(facts({ url: 'https://x.test/api/payload' })).readStyle).toBe(true);
    expect(classifyReadStyle(facts({ url: 'https://x.test/v1/ordering-guide' })).readStyle).toBe(true);
    expect(classifyReadStyle(facts({ url: 'https://x.test/api/billing-report' })).readStyle).toBe(true);
  });

  test('is case-insensitive and reads the description', () => {
    expect(classifyReadStyle(facts({ capabilityId: 'Wallet.CREATE' })).readStyle).toBe(false);
    expect(classifyReadStyle(facts({ description: 'Withdraw funds to a bank account' })).readStyle).toBe(false);
    expect(classifyReadStyle(facts({ description: 'Latest Celo block number via eth_blockNumber.' })).readStyle).toBe(true);
  });

  test('the host never counts, only the path, capability and description', () => {
    expect(classifyReadStyle(facts({ url: 'https://pay.example.com/premium', capabilityId: undefined })).readStyle).toBe(true);
  });

  test('the reason names the word that blocked it', () => {
    expect(classifyReadStyle(facts({ url: 'https://x.test/api/pay-bill' })).reason).toContain('pay');
  });
});
