import { describe, expect, test } from 'vitest';
import { shapeOf } from '@railwalker/core';
import { verifyDelivery } from '../src';

const OK = { status: 200, headers: { 'content-type': 'application/json' }, bodyText: '{"posts":[{"id":1,"text":"hi"}]}', mimeType: 'application/json', latencyMs: 800, tooSlowMs: 15_000 };
const learned = shapeOf({ posts: [{ id: 1, text: 'x' }] });
const codes = (over: Partial<Parameters<typeof verifyDelivery>[0]> = {}) => verifyDelivery({ ...OK, ...over }).map((f) => f.code);

describe('verifyDelivery', () => {
  test('a healthy delivery has no findings', () => {
    expect(codes()).toEqual([]);
    expect(codes({ learnedShape: learned })).toEqual([]);
  });

  test.each([
    ['500', { status: 500, bodyText: '{"error":"boom"}' }, ['paid_not_delivered']],
    ['404', { status: 404, bodyText: 'not found' }, ['paid_not_delivered']],
    ['a redirect', { status: 302, bodyText: '' }, ['paid_not_delivered']],
    ['a failed delivery is not also judged on speed', { status: 503, bodyText: '', latencyMs: 60_000 }, ['paid_not_delivered']],
    ['200 with an empty body', { bodyText: '' }, ['delivered_empty']],
    ['200 with only whitespace', { bodyText: ' \n\t ' }, ['delivered_empty']],
    ['204 no content', { status: 204, bodyText: '' }, ['delivered_empty']],
    ['invalid JSON when the challenge promised application/json', { bodyText: '<html>oops</html>', headers: { 'content-type': 'text/html' } }, ['delivered_invalid_json']],
    ['invalid JSON when only the response header says json', { mimeType: undefined, bodyText: '{"a":', headers: { 'content-type': 'application/json; charset=utf-8' } }, ['delivered_invalid_json']],
    ['non-JSON text when JSON was never promised', { mimeType: 'text/plain', headers: { 'content-type': 'text/plain' }, bodyText: 'hello' }, []],
    ['a JSON-looking body under a text promise', { mimeType: 'text/plain', headers: { 'content-type': 'text/plain' }, bodyText: '{"a":1}' }, []],
    ['a truncated body is never judged as JSON', { bodyText: '{"posts":[{"id":1,"te', truncated: true }, []],
    ['a truncated body is not compared to a shape either', { bodyText: '{"po', truncated: true, learnedShape: learned }, []],
  ] as const)('%s', (_name, over, expected) => {
    expect(codes(over as never)).toEqual(expected);
  });

  test('shape drift against what was learned is a warning that names the paths', () => {
    const [f] = verifyDelivery({ ...OK, learnedShape: learned, bodyText: '{"posts":[{"id":"1"}],"extra":true}' });
    expect(f).toMatchObject({ code: 'schema_mismatch', severity: 'warn' });
    expect(f!.evidence.missingKeys).toEqual(['posts[].id', 'posts[].text']);
  });

  test('extra keys are fine', () => {
    expect(codes({ learnedShape: learned, bodyText: '{"posts":[{"id":1,"text":"a","likes":3}],"cursor":"x"}' })).toEqual([]);
  });

  test('a body that was JSON and no longer is counts as drift when JSON was not promised', () => {
    const f = verifyDelivery({ ...OK, mimeType: 'text/plain', headers: { 'content-type': 'text/plain' }, learnedShape: learned, bodyText: 'maintenance' });
    expect(f.map((x) => x.code)).toEqual(['schema_mismatch']);
    expect(f[0]!.evidence.missingKeys).toEqual(['$']);
  });

  test('slower than tooSlowMs is a warning; exactly at the limit is not', () => {
    expect(codes({ latencyMs: 15_001 })).toEqual(['too_slow']);
    expect(codes({ latencyMs: 15_000 })).toEqual([]);
    const [f] = verifyDelivery({ ...OK, latencyMs: 20_000, tooSlowMs: 5000 });
    expect(f).toMatchObject({ code: 'too_slow', severity: 'warn', evidence: { latencyMs: 20_000, tooSlowMs: 5000 } });
  });

  test('drift and slowness are both reported', () => {
    expect(codes({ learnedShape: learned, bodyText: '{"nope":1}', latencyMs: 99_999 })).toEqual(['schema_mismatch', 'too_slow']);
  });

  test('every finding is CONFIRMED: it came from a real payment', () => {
    const all = [
      ...verifyDelivery({ ...OK, status: 500 }),
      ...verifyDelivery({ ...OK, bodyText: '' }),
      ...verifyDelivery({ ...OK, bodyText: 'x' }),
      ...verifyDelivery({ ...OK, latencyMs: 99_999, learnedShape: learned, bodyText: '{}' }),
    ];
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const f of all) expect(f.basis).toBe('CONFIRMED');
  });
});
