import { describe, expect, test } from 'vitest';
import { UnsafeUrlError, isPrivateAddress, parseSafeUrl, type UnsafeReason } from '../src/ssrf';

describe('parseSafeUrl (Review Focus 2)', () => {
  test.each<[string, UnsafeReason]>([
    ['http://example.com/', 'scheme'],
    ['https://user:pw@example.com/', 'credentials'],
    ['https://evil.com@127.0.0.1/', 'credentials'],
    ['https://example.com:8443/', 'port'],
    ['https://127.0.0.1/', 'ip_literal'],
    ['https://[::1]/', 'ip_literal'],
    ['https://[::ffff:7f00:1]/', 'ip_literal'],
    ['https://2130706433/', 'ip_literal'],
    ['https://0x7f000001/', 'ip_literal'],
    ['https://0177.0.0.1/', 'ip_literal'],
    ['https://localhost/', 'local_name'],
    ['https://app.localhost/', 'local_name'],
    ['https://metadata.google.internal/', 'local_name'],
    ['https://printer.local/', 'local_name'],
    ['https://intranet/', 'no_dot'],
    ['not a url', 'invalid'],
    ['', 'invalid'],
    [`https://${'a'.repeat(300)}.com/`, 'too_long'],
  ])('rejects %s as %s', (u, reason) => {
    expect(() => parseSafeUrl(u)).toThrowError(expect.objectContaining({ reason }));
  });

  test('the error is an UnsafeUrlError and never echoes a password', () => {
    try {
      parseSafeUrl('https://user:hunter2@example.com/');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeUrlError);
      expect((e as Error).message).not.toContain('hunter2');
    }
  });

  test('accepts a normal https URL', () => {
    expect(parseSafeUrl('https://example.com/path?q=1').hostname).toBe('example.com');
    expect(parseSafeUrl('https://example.com:443/x').port).toBe('');
  });
});

describe('isPrivateAddress', () => {
  test.each<[string, boolean]>([
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.15.255.255', false],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['255.255.255.255', true],
    ['192.0.2.1', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['::', true],
    ['::1', true],
    ['[::1]', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['fe80::1%eth0', true],
    ['ff02::1', true],
    ['2001:db8::1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['64:ff9b::7f00:1', true],
    ['2002:7f00:1::1', true],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true],
    ['999.1.1.1', true],
  ])('isPrivateAddress(%s)=%s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});
