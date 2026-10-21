export type UnsafeReason = 'scheme' | 'credentials' | 'port' | 'ip_literal' | 'local_name' | 'no_dot' | 'too_long' | 'invalid';

export class UnsafeUrlError extends Error {
  constructor(public readonly reason: UnsafeReason) {
    // The message never echoes any part of the input: it may contain credentials.
    super(`unsafe URL: ${reason}`);
    this.name = 'UnsafeUrlError';
  }
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/**
 * Static checks only (no DNS): https, port 443, no credentials, no IP literals, no local names.
 * WHATWG URL normalises decimal, hex and octal IPv4 forms to dotted quads, so they are caught as ip_literal.
 * Credentials are checked before IP literals so `https://evil.com@127.0.0.1/` reports the trick, not the target.
 */
export function parseSafeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError('invalid');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('scheme');
  if (url.username !== '' || url.password !== '') throw new UnsafeUrlError('credentials');
  if (url.port !== '' && url.port !== '443') throw new UnsafeUrlError('port');

  const host = url.hostname;
  if (host.length > 253) throw new UnsafeUrlError('too_long');
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new UnsafeUrlError('ip_literal');
  if (host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError('local_name');
  if (!host.includes('.')) throw new UnsafeUrlError('no_dot');
  return url;
}

function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isPrivateV4(o: number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true; // this-network, private, loopback, multicast + reserved + broadcast
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function parseIPv6(input: string): number[] | null {
  let s = (input.replace(/^\[|\]$/g, '').split('%')[0] ?? '').trim();
  if (!s.includes(':')) return null;
  const lastColon = s.lastIndexOf(':');
  const last = s.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parts = (p: string) => (p === '' ? [] : p.split(':'));
  const head = parts(halves[0] ?? '');
  const tail = halves.length === 2 ? parts(halves[1] ?? '') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isPrivateV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const v4From = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.every((x) => x === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return isPrivateV4(v4From(g6, g7)); // mapped / compatible
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateV4(v4From(g6, g7)); // NAT64
  if (g0 === 0x2002) return isPrivateV4(v4From(g1, g2)); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return false;
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges. Anything unparsable is treated as private (fail closed). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateV4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isPrivateV6(v6);
  return true;
}
