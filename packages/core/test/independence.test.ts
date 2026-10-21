import { describe, expect, test } from 'vitest';
import { classifyIndependence, type WalletFacts } from '../src/independence';

const START = '2026-10-06T00:00:00Z';
const OURS = '0xAAAA000000000000000000000000000000000001';
const wallet = (over: Partial<WalletFacts> = {}): WalletFacts => ({
  address: '0xBBBB000000000000000000000000000000000002',
  firstActivityAt: '2026-09-01T10:00:00Z',
  firstFunder: '0xCCCC000000000000000000000000000000000003',
  ...over,
});
const classify = (w: WalletFacts, projectWallets = [OURS]) => classifyIndependence({ wallet: w, projectWallets, hackathonStart: START });

describe('classifyIndependence', () => {
  test('first activity 2026-09-01 and a funder that is not ours -> counted', () => {
    expect(classify(wallet())).toEqual({ counted: true, reason: 'counted' });
  });

  test('an address in projectWallets -> is_project_wallet', () => {
    expect(classify(wallet({ address: OURS }))).toEqual({ counted: false, reason: 'is_project_wallet' });
  });

  test('a first funder in projectWallets -> funded_by_project', () => {
    expect(classify(wallet({ firstFunder: OURS }))).toEqual({ counted: false, reason: 'funded_by_project' });
  });

  test('no recorded activity -> no_prior_activity', () => {
    expect(classify(wallet({ firstActivityAt: null }))).toEqual({ counted: false, reason: 'no_prior_activity' });
    expect(classify(wallet({ firstActivityAt: 'not a date' }))).toEqual({ counted: false, reason: 'no_prior_activity' });
  });

  test('first activity 2026-10-07 -> activity_after_start', () => {
    expect(classify(wallet({ firstActivityAt: '2026-10-07T00:00:00Z' }))).toEqual({ counted: false, reason: 'activity_after_start' });
  });

  test('the hackathon start itself is not "before" it; one second earlier is', () => {
    expect(classify(wallet({ firstActivityAt: START })).reason).toBe('activity_after_start');
    expect(classify(wallet({ firstActivityAt: '2026-10-05T23:59:59Z' })).counted).toBe(true);
  });

  test('address comparison is case-insensitive', () => {
    expect(classify(wallet({ address: OURS.toLowerCase() })).reason).toBe('is_project_wallet');
    expect(classify(wallet({ firstFunder: OURS.toUpperCase().replace('0X', '0x') })).reason).toBe('funded_by_project');
  });

  test('an unknown funder cannot be shown to be ours, so prior activity counts', () => {
    expect(classify(wallet({ firstFunder: null }))).toEqual({ counted: true, reason: 'counted' });
  });

  test.each([['not a date'], [''], ['2026-13-45']])('a hackathon start of %j is refused: every wallet with any activity would otherwise be counted as independent', (hackathonStart) => {
    expect(() => classifyIndependence({ wallet: wallet(), projectWallets: [OURS], hackathonStart })).toThrow(/hackathonStart/);
    expect(() => classifyIndependence({ wallet: wallet({ address: OURS }), projectWallets: [OURS], hackathonStart })).toThrow(/hackathonStart/);
  });

  test('being a project wallet outranks every other reason', () => {
    expect(classify(wallet({ address: OURS, firstActivityAt: null, firstFunder: OURS })).reason).toBe('is_project_wallet');
  });
});
