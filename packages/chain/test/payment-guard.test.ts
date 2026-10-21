import { describe, expect, test } from 'vitest';
import { createDeadline, DeadlineExceeded } from '@railwalker/core';
import { guardPayments, SecondPaymentRefused } from '../src';

const URL_A = 'https://seller.example/api/data';
const header = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const payment = (extra: Record<string, unknown> = {}) => new Request(URL_A, { headers: { 'payment-signature': header({ x402Version: 2, accepted: { network: 'eip155:42220' }, ...extra }) } });
const plain = () => new Request(URL_A);

/** A base fetch that counts what reaches it and answers with whatever `answer` builds. */
function base(answer: () => Response | Promise<Response> = () => new Response('{"ok":true}')) {
  const seen: Request[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seen.push(new Request(input, init));
    return answer();
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe('guardPayments', () => {
  test('the first payment-carrying request goes through and is remembered', async () => {
    const b = base();
    const g = guardPayments(b.fetchImpl, createDeadline(1000), 1024);
    expect(g.paymentSent()).toBe(false);
    await g.fetch(payment());
    expect(g.paymentSent()).toBe(true);
    expect(b.seen).toHaveLength(1);
  });

  test('a second payment-carrying request is refused and never reaches the seller', async () => {
    const b = base();
    const g = guardPayments(b.fetchImpl, createDeadline(1000), 1024);
    await g.fetch(payment());
    await expect(g.fetch(payment())).rejects.toBeInstanceOf(SecondPaymentRefused);
    expect(b.seen).toHaveLength(1);
  });

  test('the legacy X-PAYMENT header counts as a payment too', async () => {
    const b = base();
    const g = guardPayments(b.fetchImpl, createDeadline(1000), 1024);
    await g.fetch(new Request(URL_A, { headers: { 'x-payment': header({ x402Version: 1, network: 'celo' }) } }));
    await expect(g.fetch(payment())).rejects.toBeInstanceOf(SecondPaymentRefused);
    expect(g.paymentNetwork()).toBe('celo');
  });

  test('requests without a payment are not limited', async () => {
    const b = base();
    const g = guardPayments(b.fetchImpl, createDeadline(1000), 1024);
    await g.fetch(plain());
    await g.fetch(plain());
    expect(g.paymentSent()).toBe(false);
    expect(b.seen).toHaveLength(2);
  });

  test('the payment is marked sent the moment it is dispatched, even if the seller never answers', async () => {
    const b = base(() => new Promise<Response>(() => {}));
    const d = createDeadline(40);
    const g = guardPayments(b.fetchImpl, d, 1024);
    await expect(g.fetch(payment())).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(g.paymentSent()).toBe(true);
  });

  test('the network of the payment is read from the header it sent (v2 accepted.network)', async () => {
    const g = guardPayments(base().fetchImpl, createDeadline(1000), 1024);
    await g.fetch(payment());
    expect(g.paymentNetwork()).toBe('eip155:42220');
  });

  test('once the deadline has passed nothing is sent, paid or not', async () => {
    const b = base();
    const d = createDeadline(10);
    await new Promise((r) => setTimeout(r, 40));
    const g = guardPayments(b.fetchImpl, d, 1024);
    await expect(g.fetch(payment())).rejects.toBeInstanceOf(DeadlineExceeded);
    await expect(g.fetch(plain())).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(b.seen).toHaveLength(0);
    expect(g.paymentSent()).toBe(false);
  });

  test('an unpaid 402 comes back as a capped copy: a hostile body is never buffered whole', async () => {
    let pulled = 0;
    const huge = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (pulled >= 5 * 1024 * 1024) return c.close();
          c.enqueue(new Uint8Array(64 * 1024).fill(65));
          pulled += 64 * 1024;
        },
      },
      { highWaterMark: 0 },
    );
    const b = base(() => new Response(huge, { status: 402, headers: { 'payment-required': 'abc' } }));
    const g = guardPayments(b.fetchImpl, createDeadline(2000), 1024);
    const res = await g.fetch(plain());
    expect(res.status).toBe(402);
    expect(res.headers.get('payment-required')).toBe('abc');
    expect((await res.text()).length).toBe(1024);
    expect(pulled).toBeLessThanOrEqual(1024 + 64 * 1024);
    expect(g.unpaid()).toMatchObject({ status: 402, truncated: true });
  });

  test('a paid response is handed back untouched and remembered', async () => {
    const b = base(() => new Response('paid body', { status: 200 }));
    const g = guardPayments(b.fetchImpl, createDeadline(1000), 1024);
    const res = await g.fetch(payment());
    expect(await res.text()).toBe('paid body');
    expect(g.paidResponse()).not.toBeNull();
  });
});
