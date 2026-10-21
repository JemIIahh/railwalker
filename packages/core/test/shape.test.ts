import { describe, expect, test } from 'vitest';
import { shapeMatches, shapeOf } from '../src/shape';

describe('shapeOf', () => {
  test('describes nested objects and arrays', () => {
    expect(shapeOf({ a: 1, b: [{ c: 'x' }] })).toEqual({
      type: 'object',
      keys: {
        a: { type: 'number' },
        b: { type: 'array', item: { type: 'object', keys: { c: { type: 'string' } } } },
      },
    });
  });

  test('primitives, null and empty arrays', () => {
    expect(shapeOf('x')).toEqual({ type: 'string' });
    expect(shapeOf(true)).toEqual({ type: 'boolean' });
    expect(shapeOf(null)).toEqual({ type: 'null' });
    expect(shapeOf([])).toEqual({ type: 'array', item: null });
  });
});

describe('shapeMatches', () => {
  const expected = shapeOf({ a: 1, b: [{ c: 'x' }], d: { e: true } });

  test('extra keys are allowed', () => {
    expect(shapeMatches(expected, shapeOf({ a: 2, b: [{ c: 'y', z: 1 }], d: { e: false, f: 1 }, extra: 'ok' }))).toEqual({ ok: true, missingKeys: [] });
  });

  test('a missing key fails and is named', () => {
    expect(shapeMatches(expected, shapeOf({ a: 1, d: { e: true } }))).toEqual({ ok: false, missingKeys: ['b'] });
  });

  test('a key whose type changes fails and is named', () => {
    expect(shapeMatches(expected, shapeOf({ a: '1', b: [{ c: 'x' }], d: { e: true } }))).toEqual({ ok: false, missingKeys: ['a'] });
  });

  test('nested problems carry their path', () => {
    const r = shapeMatches(expected, shapeOf({ a: 1, b: [{ q: 1 }], d: {} }));
    expect(r.ok).toBe(false);
    expect(r.missingKeys).toEqual(['b[].c', 'd.e']);
  });

  test('empty arrays match any array on either side', () => {
    expect(shapeMatches(shapeOf({ b: [] }), shapeOf({ b: [{ c: 1 }] })).ok).toBe(true);
    expect(shapeMatches(shapeOf({ b: [{ c: 1 }] }), shapeOf({ b: [] })).ok).toBe(true);
  });

  test('a top-level type change is reported', () => {
    expect(shapeMatches(shapeOf({ a: 1 }), shapeOf([1]))).toEqual({ ok: false, missingKeys: ['$'] });
  });
});
