import { describe, expect, test } from 'vitest';
import { API_KEY, KEY, MAINNET_ENV, SALT, URL_OK, harness } from './harness';

describe('runCli', () => {
  test('no arguments, help and -h print the commands and exit 0', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const h = harness();
      expect(await h.run(...argv)).toBe(0);
      for (const name of ['wallet:new', 'doctor', 'balance', 'scan', 'check', 'register']) expect(h.out(), name).toContain(name);
    }
  });

  test('help mentions the exit codes', async () => {
    const h = harness();
    await h.run('help');
    expect(h.out()).toMatch(/exit/i);
    expect(h.out()).toMatch(/\b2\b.*usage/i);
    expect(h.out()).toMatch(/\b3\b.*refus/i);
  });

  test('an unknown command is exit 2, says so, and points at help', async () => {
    const h = harness();
    expect(await h.run('frobnicate')).toBe(2);
    expect(h.err()).toContain('unknown command "frobnicate"');
    expect(h.err()).toMatch(/help/);
  });

  test('a parse error is exit 2 and nothing runs', async () => {
    const h = harness();
    expect(await h.run('scan', URL_OK, '--nope')).toBe(2);
    expect(h.calls.scan).toEqual([]);
  });

  test('an unexpected exception is exit 1 with its message, not a stack trace', async () => {
    const h = harness({
      scan: async () => {
        throw new TypeError('something odd');
      },
    });
    expect(await h.run('scan', URL_OK)).toBe(1);
    expect(h.err()).toContain('something odd');
    expect(h.err()).not.toMatch(/\n\s+at /);
  });

  test('a thrown non-Error is still exit 1', async () => {
    const h = harness({
      scan: async () => {
        throw 'a string';
      },
    });
    expect(await h.run('scan', URL_OK)).toBe(1);
  });
});

describe('redaction: no secret leaves through any output', () => {
  const RPC = 'https://rpc.example/v1/SECRETRPCTOKEN';
  const secrets = [KEY, KEY.slice(2), API_KEY, SALT, RPC];

  test.each([
    ['stdout', 'out'],
    ['stderr', 'err'],
  ] as const)('a secret written to %s is replaced', async (_name, stream) => {
    const h = harness({
      env: { ...MAINNET_ENV, CELO_RPC_URL: RPC },
      scan: async () => {
        throw new Error(`leak: ${secrets.join(' | ')}`);
      },
    });
    await h.run('scan', URL_OK);
    for (const secret of secrets) expect(h[stream](), secret).not.toContain(secret);
    expect(h.err()).toContain('[redacted]');
  });

  test('only the secrets that are set are redacted: short or empty values do not blank out ordinary text', async () => {
    const h = harness({ env: { ...MAINNET_ENV, SELLER_SALT: '', X402_API_KEY: 'ab' } });
    await h.run('help');
    expect(h.out()).toContain('wallet:new');
    expect(h.out()).not.toContain('[redacted]');
  });
});
