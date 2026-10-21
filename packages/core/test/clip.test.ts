import { describe, expect, test } from 'vitest';
import { clipDeep, clipText, DEFAULT_CLIP } from '../src/clip';

describe('clipText', () => {
  test('leaves text at or under the limit alone, and cuts longer text with an ellipsis', () => {
    expect(clipText('a'.repeat(300))).toBe('a'.repeat(300));
    expect(clipText('a'.repeat(301))).toBe(`${'a'.repeat(300)}…`);
    expect(clipText('short', 3)).toBe('sho…');
    expect(clipText('')).toBe('');
  });

  test('a megabyte of text becomes a few hundred characters', () => {
    expect(clipText('x'.repeat(1_000_000)).length).toBe(301);
  });
});

describe('clipDeep', () => {
  test('primitives pass through unchanged', () => {
    for (const v of [0, 1.5, -3, true, false, null, undefined]) expect(clipDeep(v)).toBe(v);
    expect(clipDeep('hello')).toBe('hello');
  });

  test('strings are clipped wherever they are', () => {
    const big = 'y'.repeat(1000);
    expect(clipDeep({ a: big, b: [big, { c: big }] })).toEqual({ a: clipText(big), b: [clipText(big), { c: clipText(big) }] });
  });

  test('arrays keep their first 50 items', () => {
    const out = clipDeep(Array.from({ length: 80 }, (_, i) => i)) as number[];
    expect(out).toHaveLength(50);
    expect(out[0]).toBe(0);
    expect(out[49]).toBe(49);
  });

  test('objects keep their first 50 keys, in order, and long key names are cut', () => {
    const input = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    const out = clipDeep(input) as Record<string, number>;
    expect(Object.keys(out)).toEqual(Array.from({ length: 50 }, (_, i) => `k${i}`));
    const longKey = clipDeep({ [`${'k'.repeat(500)}`]: 1 }) as Record<string, number>;
    expect(Object.keys(longKey)[0]!.length).toBe(100);
  });

  test('nesting deeper than six levels becomes a marker instead of recursing', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20; i++) deep = { next: deep };
    let node = clipDeep(deep) as Record<string, unknown>;
    let levels = 0;
    while (typeof node === 'object' && node !== null) {
      node = node.next as Record<string, unknown>;
      levels++;
    }
    expect(levels).toBe(DEFAULT_CLIP.maxDepth);
    expect(node).toBe('[too deep]');
  });

  test('a __proto__ key from untrusted JSON is dropped, never assigned', () => {
    const hostile = JSON.parse('{"__proto__":{"isAdmin":true},"ok":1}') as object;
    const out = clipDeep(hostile) as Record<string, unknown>;
    expect(out.ok).toBe(1);
    expect(out.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['ok']);
  });

  test('the input is never modified', () => {
    const input = { a: 'z'.repeat(1000), b: [1, 2, 3] };
    const copy = structuredClone(input);
    clipDeep(input);
    expect(input).toEqual(copy);
  });

  test('custom limits apply', () => {
    expect(clipDeep(['abcdef', 'x', 'y'], { maxString: 2, maxItems: 2, maxKeys: 1, maxDepth: 3 })).toEqual(['ab…', 'x']);
  });

  test('a hostile megabyte-wide, deeply nested value comes out small and serialisable', () => {
    const hostile = { s: 'x'.repeat(2_000_000), a: Array.from({ length: 100_000 }, () => 'y'.repeat(100)), o: Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, { n: { n: { n: { n: { n: { n: { n: 'deep' } } } } } } }])) };
    const out = JSON.stringify(clipDeep(hostile));
    expect(out.length).toBeLessThan(40_000);
  });

  test('functions and bigint are not JSON and are dropped to undefined rather than leaked through', () => {
    expect(clipDeep(() => 1)).toBeUndefined();
    expect(clipDeep(10n)).toBeUndefined();
  });
});
