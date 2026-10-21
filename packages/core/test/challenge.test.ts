import { describe, expect, test } from 'vitest';
import { buyV1Challenge, v2MultiAssetChallenge } from '@railwalker/testkit';
import { parseChallenge } from '../src/challenge';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

describe('parseChallenge', () => {
  test('parses the real buy v1 challenge', () => {
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify(buyV1Challenge) });
    if (!r.ok) throw new Error(r.detail);
    expect(r.challenge.version).toBe(1);
    expect(r.challenge.accepts).toHaveLength(4);
    expect(r.challenge.accepts[0]).toMatchObject({
      chainId: 42220,
      amountAtomic: '5000',
      payTo: '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B',
    });
    expect(r.challenge.accepts[0]!.assetInfo?.symbol).toBe('USDC');
    expect(r.challenge.accepts[3]!.chainId).toBe(11142220);
    expect(r.challenge.hasOutputSchema).toBe(false);
    expect(r.challenge.resource.url).toBe('https://gateway.usebuy.ai/v1/social/x/posts/search');
  });

  test('parses v2 from the body (amount, not maxAmountRequired)', () => {
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify(v2MultiAssetChallenge) });
    if (!r.ok) throw new Error(r.detail);
    expect(r.challenge.version).toBe(2);
    expect(r.challenge.accepts[0]!.amountAtomic).toBe('500');
    expect(r.challenge.accepts[0]!.extra).toEqual({ name: 'USDC', version: '2' });
    expect(r.challenge.extensions).toHaveProperty('builder-code');
    expect(r.challenge.resource).toMatchObject({ url: 'https://fixtures.example/ok', mimeType: 'application/json' });
  });

  test('prefers the payment-required header over an empty body', () => {
    const r = parseChallenge({
      status: 402,
      headers: { 'payment-required': b64(v2MultiAssetChallenge) },
      bodyText: '{}',
    });
    expect(r.ok && r.challenge.accepts).toHaveLength(3);
  });

  test('a v2 challenge that uses v1 field names has no amount (the seller is broken, not us)', () => {
    const broken = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:42220', maxAmountRequired: '500', asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', payTo: '0x1111111111111111111111111111111111111111' }] };
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify(broken) });
    if (!r.ok) throw new Error(r.detail);
    expect(r.challenge.accepts[0]!.amountAtomic).toBe('');
  });

  test('hasOutputSchema is true when an accept carries an outputSchema', () => {
    const withSchema = { x402Version: 1, accepts: [{ scheme: 'exact', network: 'celo', maxAmountRequired: '1', asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', payTo: '0x1111111111111111111111111111111111111111', outputSchema: { output: { type: 'object' } } }] };
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify(withSchema) });
    expect(r.ok && r.challenge.hasOutputSchema).toBe(true);
  });

  test.each([
    [200, '{}'],
    [402, '<html>blocked</html>'],
    [402, ''],
    [402, '{"foo":1}'],
  ])('not x402 (%s %s)', (status, bodyText) =>
    expect(parseChallenge({ status, headers: {}, bodyText })).toMatchObject({ ok: false, code: 'not_x402' }));

  test('invalid base64 header is not_x402', () =>
    expect(parseChallenge({ status: 402, headers: { 'payment-required': '%%%' }, bodyText: '' }).ok).toBe(false));

  test('an unknown x402Version is not_x402', () =>
    expect(parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify({ x402Version: 3, accepts: [] }) })).toMatchObject({ ok: false, code: 'not_x402' }));
});

describe('parseChallenge: hostile sizes', () => {
  const big = (n: number) => 'x'.repeat(n);
  const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
  const good = { scheme: 'exact', network: 'eip155:42220', amount: '5000', asset: USDC, payTo: '0x1111111111111111111111111111111111111111', maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } };

  test('a thousand accepts become fifty: a seller cannot make a report as long as it likes', () => {
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify({ x402Version: 2, accepts: Array.from({ length: 1000 }, () => good) }) });
    expect(r.ok && r.challenge.accepts).toHaveLength(50);
  });

  test('megabyte strings anywhere in the challenge come out as a few hundred characters', () => {
    const hostile = {
      x402Version: 2,
      resource: { url: big(1_000_000), description: big(1_000_000), mimeType: big(1_000_000) },
      accepts: [{ scheme: big(100_000), network: big(100_000), amount: big(100_000), asset: big(100_000), payTo: big(100_000), maxTimeoutSeconds: 300, extra: { name: big(100_000), nested: Array.from({ length: 200 }, () => big(1000)) } }],
      extensions: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`ext${i}`, big(1000)])),
    };
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify(hostile) });
    if (!r.ok) throw new Error(r.detail);
    expect(JSON.stringify(r.challenge).length).toBeLessThan(40_000);
    expect(r.challenge.accepts[0]!.payTo.length).toBeLessThanOrEqual(301);
    expect(r.challenge.resource.description!.length).toBeLessThanOrEqual(301);
  });

  test('a payee that is a megabyte of junk is still just an invalid payee', () => {
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify({ x402Version: 2, accepts: [{ ...good, payTo: big(1_000_000) }] }) });
    expect(r.ok && r.challenge.accepts[0]!.payTo.startsWith('xxxx')).toBe(true);
    expect(r.ok && r.challenge.accepts[0]!.chainId).toBe(42220);
  });

  test('values that are fine are not touched', () => {
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify({ x402Version: 2, resource: { url: 'https://s.example/a', description: 'ok' }, accepts: [good] }) });
    if (!r.ok) throw new Error(r.detail);
    expect(r.challenge.accepts[0]).toMatchObject({ amountAtomic: '5000', asset: USDC, payTo: good.payTo, extra: { name: 'USDC', version: '2' } });
    expect(r.challenge.resource).toMatchObject({ url: 'https://s.example/a', description: 'ok' });
  });

  test('the reason for refusing an odd version is bounded too', () => {
    const r = parseChallenge({ status: 402, headers: {}, bodyText: JSON.stringify({ x402Version: big(1_000_000), accepts: [] }) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail.length).toBeLessThan(200);
  });
});
