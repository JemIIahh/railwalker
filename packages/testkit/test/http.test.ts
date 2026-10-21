import { describe, expect, test } from 'vitest';
import { appFetch, fakeFetch } from '../src';

describe('fakeFetch', () => {
  test('answers by full URL and records method, url, headers and body', async () => {
    const f = fakeFetch({ 'https://a.example/x?y=1': () => new Response('hi', { status: 201 }) });
    const res = await f('https://a.example/x?y=1', { method: 'POST', headers: { 'X-Test': 'yes' }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(f.calls).toEqual([{ method: 'POST', url: 'https://a.example/x?y=1', headers: expect.objectContaining({ 'x-test': 'yes' }), body: '{"a":1}' }]);
  });

  test('a request with no route throws, and is still recorded', async () => {
    const f = fakeFetch({});
    await expect(f('https://nowhere.example/')).rejects.toThrow('no route for GET https://nowhere.example/');
    expect(f.calls.map((c) => c.url)).toEqual(['https://nowhere.example/']);
  });

  test('a GET records a null body', async () => {
    const f = fakeFetch({ 'https://a.example/': () => new Response('') });
    await f('https://a.example/');
    expect(f.calls[0]!.body).toBeNull();
  });
});

describe('appFetch', () => {
  test('serves requests from any object with fetch(Request) and records them', async () => {
    const app = { fetch: (req: Request) => new Response(`you asked ${new URL(req.url).pathname}`) };
    const f = appFetch(app);
    const res = await f('https://seller.example/api/data');
    expect(await res.text()).toBe('you asked /api/data');
    expect(f.calls).toHaveLength(1);
  });
});
