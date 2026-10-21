import { describe, expect, test } from 'vitest';
import { FIXTURE_EXPECTATIONS } from '@railwalker/fixtures';
import { appFetch, mockFacilitator } from '@railwalker/testkit';
import { scanEndpoint } from '@railwalker/scanner';
import { mountFixtures } from '../lib/fixtures-mount';

const PAY_TO = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B';
const SITE = 'https://railwalker.example';

/** Our own seller, served the way the site serves it, scanned by our own scanner. */
function scan(route: string) {
  const app = mountFixtures({ facilitator: mockFacilitator(), payTo: PAY_TO, network: 'eip155:42220' });
  return scanEndpoint(
    { fetchImpl: appFetch(app), resolveHost: async () => ['93.184.216.34'], isOptedOut: async () => false, now: () => new Date('2026-10-22T12:00:00Z'), userAgent: 'test' },
    { url: `${SITE}/api/fixtures${route}`, method: 'GET' },
  );
}

describe('self-check: the product runs on itself', () => {
  test('scanning /api/fixtures/ok finds nothing above info', async () => {
    const r = await scan('/ok');
    expect(r.status).toBe(402);
    expect(r.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(r.verdicts.every((v) => v.kind === 'PASS')).toBe(true);
  });

  test('and the broken fixtures are still broken the way they say, through the mount', async () => {
    for (const route of Object.keys(FIXTURE_EXPECTATIONS).filter((r) => r.startsWith('/bad/'))) {
      expect((await scan(route)).findings.map((f) => f.code), route).toContain(FIXTURE_EXPECTATIONS[route]);
    }
  });
});
