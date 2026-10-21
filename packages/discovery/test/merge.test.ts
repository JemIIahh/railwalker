import { describe, expect, test } from 'vitest';
import { mergeEndpoints, type Endpoint } from '../src';

const ep = (url: string, over: Partial<Endpoint> = {}): Endpoint => ({ url, method: 'GET', source: 'erc8004', ...over });

describe('mergeEndpoints', () => {
  test('dedupes on method and URL, and the first list wins', () => {
    const fromBuy = ep('https://gateway.usebuy.ai/v1/x', { source: 'buy', method: 'POST', capabilityId: 'x' });
    const fromRegistry = ep('https://gateway.usebuy.ai/v1/x', { source: 'erc8004', method: 'POST', agentId: '7' });
    expect(mergeEndpoints([fromBuy], [fromRegistry])).toEqual([fromBuy]);
    expect(mergeEndpoints([fromRegistry], [fromBuy])).toEqual([fromRegistry]);
  });

  test('keeps the order of the first list, then what is new from each later list in turn', () => {
    const merged = mergeEndpoints([ep('https://a.example/1'), ep('https://a.example/2')], [ep('https://a.example/2'), ep('https://b.example/1')], [ep('https://a.example/1'), ep('https://c.example/1')]);
    expect(merged.map((e) => e.url)).toEqual(['https://a.example/1', 'https://a.example/2', 'https://b.example/1', 'https://c.example/1']);
  });

  test('the same URL with another method is another endpoint', () => {
    expect(mergeEndpoints([ep('https://a.example/x', { method: 'GET' })], [ep('https://a.example/x', { method: 'POST' })])).toHaveLength(2);
  });

  test('hosts are not case sensitive and a bare origin is the same as its slash; paths are exact', () => {
    expect(mergeEndpoints([ep('https://A.Example')], [ep('https://a.example/')])).toHaveLength(1);
    expect(mergeEndpoints([ep('https://a.example/Path')], [ep('https://a.example/path')])).toHaveLength(2);
    expect(mergeEndpoints([ep('https://a.example/x?a=1')], [ep('https://a.example/x?a=2')])).toHaveLength(2);
  });

  test('a URL that cannot be parsed is kept as written and compared exactly', () => {
    expect(mergeEndpoints([ep('not a url')], [ep('not a url'), ep('NOT a url')])).toHaveLength(2);
  });

  test('no lists, or empty lists, merge to nothing', () => {
    expect(mergeEndpoints()).toEqual([]);
    expect(mergeEndpoints([], [], [])).toEqual([]);
  });

  test('the inputs are not changed, and the result is a new array', () => {
    const a = [ep('https://a.example/1')];
    const b = [ep('https://a.example/1'), ep('https://b.example/1')];
    const snapshot = structuredClone([a, b]);
    const merged = mergeEndpoints(a, b);
    expect([a, b]).toEqual(snapshot);
    expect(merged).not.toBe(a);
    merged.push(ep('https://z.example/1'));
    expect(a).toHaveLength(1);
  });
});
