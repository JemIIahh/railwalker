import { describe, expect, test } from 'vitest';
import { explainNotPaid } from '../lib/not-paid';

const at = (status: number | null, method: 'GET' | 'POST' = 'GET') => explainNotPaid({ status, endpoint: { method } });

describe('explainNotPaid: why a link is not a paid API, in plain words', () => {
  test('a GET that is refused with 405 offers the same link as a POST, because many paid APIs only take POST', () => {
    const r = at(405);
    expect(r).toMatchObject({ kind: 'wrong_method', retry: 'POST' });
    expect(r.title).toMatch(/GET/);
    expect(r.body).toMatch(/POST/);
  });

  test('a POST that is refused with 405 offers GET instead', () => {
    expect(at(405, 'POST')).toMatchObject({ kind: 'wrong_method', retry: 'GET' });
  });

  test('an ordinary answer is a website or a free API: nothing to retry, and it is not called broken', () => {
    for (const status of [200, 204, 301, 302]) {
      const r = at(status);
      expect(r, String(status)).toMatchObject({ kind: 'website', retry: null });
      expect(r.title).toMatch(/website|free/i);
      expect(`${r.title} ${r.body}`).not.toMatch(/break|broken|fail/i);
    }
  });

  test('404 and 410 say nothing is there', () => {
    for (const status of [404, 410]) expect(at(status), String(status)).toMatchObject({ kind: 'not_found', retry: null });
  });

  test('401 and 403 say the server turned the check away', () => {
    for (const status of [401, 403]) expect(at(status), String(status)).toMatchObject({ kind: 'turned_away', retry: null });
  });

  test('400 and 422 on a POST say the server wanted a request body first, and point at More options', () => {
    for (const status of [400, 422]) {
      const r = at(status, 'POST');
      expect(r, String(status)).toMatchObject({ kind: 'needs_body', retry: null });
      expect(r.body).toMatch(/More options/);
    }
  });

  test('a 400 on a GET is just a bad request, not a request for a body', () => {
    expect(at(400, 'GET').kind).not.toBe('needs_body');
  });

  test('5xx is a server error, and no answer at all is unreachable', () => {
    for (const status of [500, 502, 503]) expect(at(status), String(status)).toMatchObject({ kind: 'server_error', retry: null });
    expect(at(null)).toMatchObject({ kind: 'unreachable', retry: null });
  });

  test('every answer has a title and a body of plain words', () => {
    for (const status of [null, 200, 301, 400, 401, 404, 405, 418, 500]) {
      const r = at(status);
      expect(r.title.length, String(status)).toBeGreaterThan(8);
      expect(r.body.length, String(status)).toBeGreaterThan(20);
    }
  });
});
