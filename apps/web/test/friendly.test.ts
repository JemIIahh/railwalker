import { describe, expect, test } from 'vitest';
import { friendlyName } from '../lib/friendly';

describe('friendlyName: what an endpoint is called to a person', () => {
  test.each([
    ['fixture', 'ok', 'Healthy demo seller'],
    ['fixture', 'paid/empty', 'Demo: empty answer'],
    ['fixture', 'paid/500', 'Demo: crashes after paying'],
    ['fixture', 'paid/bad-json', 'Demo: broken answer'],
    ['fixture', 'paid/slow', 'Demo: slow answer'],
    ['fixture', 'bad/decimals', 'Demo: price in wrong units'],
    ['fixture', 'bad/domain-name', 'Demo: wrong signing name'],
    ['fixture', 'bad/adapter-asset', 'Demo: wrong token address'],
    ['fixture', 'bad/payto-zero', 'Demo: pays to nowhere'],
    ['fixture', 'bad/permit2-method', 'Demo: peso token set up wrong'],
    ['fixture', 'bad/no-cors', 'Demo: hidden from web apps'],
    ['fixture', 'bad/testnet-only', 'Demo: test network only'],
  ] as const)('our %s “%s” is “%s”', (group, row, title) => {
    expect(friendlyName(group, row)).toEqual({ title, where: 'Our demo seller' });
  });

  test.each([
    ['social/x/posts/search', 'X posts search'],
    ['browser/sessions', 'Browser sessions'],
    ['social/instagram/tools/apify-apify-instagram-hashtag-scraper', 'Instagram hashtag scraper'],
    ['social/x/tools/apify-apidojo-tweet-scraper', 'X tweet scraper'],
  ])('a real service’s “%s” is “%s”', (row, title) => {
    expect(friendlyName('buy', row)).toEqual({ title, where: 'Real service' });
  });

  test('a fixture we have no name for is named from its whole path, with the demo marked', () => {
    expect(friendlyName('fixture', 'bad/something-new')).toEqual({ title: 'Demo: bad something new', where: 'Our demo seller' });
    expect(friendlyName('fixture', 'paid/extra/thing')).toEqual({ title: 'Demo: paid extra thing', where: 'Our demo seller' });
  });

  test('case never matters for what is dropped, said once or lowered', () => {
    expect(friendlyName('buy', 'Social/X/Posts').title).toBe('X Posts');
    expect(friendlyName('buy', 'Tiktok/tiktok/User').title).toBe('Tiktok User');
    expect(friendlyName('fixture', 'Bad/Some-Thing').title).toBe('Demo: bad some thing');
  });

  test('an unknown demo keeps every word of its path, plumbing words included, and is cut when it is long', () => {
    expect(friendlyName('fixture', 'bad/api-thing').title).toBe('Demo: bad api thing');
    const long = friendlyName('fixture', `bad/${Array.from({ length: 40 }, (_, i) => `part${i}`).join('-')}`).title;
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith('…')).toBe(true);
  });

  test('the same word twice in a row is said once, short words are capitals, and vendor words are dropped', () => {
    expect(friendlyName('buy', 'social/tiktok/tools/tikhub-tiktok-user-search').title).toBe('Tiktok user search');
    expect(friendlyName('buy', 'ai/v1/chat').title).toBe('AI chat');
    expect(friendlyName('buy', 'a/b').title).toBe('A B');
  });

  test('nothing to name is named plainly, and a very long path is cut', () => {
    expect(friendlyName('buy', '/')).toEqual({ title: 'Home', where: 'Real service' });
    expect(friendlyName('buy', '').title).toBe('Home');
    const long = friendlyName('buy', `x/${Array.from({ length: 40 }, (_, i) => `word${i}`).join('-')}`).title;
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith('…')).toBe(true);
  });
});
