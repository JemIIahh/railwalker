import { describe, expect, test } from 'vitest';
import { ASSETS, makeFinding, type Verdict } from '@railwalker/core';
import type { RunRecord } from '@railwalker/scanner';
import type { ScanSummary } from '@railwalker/data';
import { mapCells } from '@railwalker/data';
import { assetBars, describeVerdict, explorerAddressUrl, explorerTxUrl, findingBars, formatPaid, formatUsd, formatUsdShort, formatWhen, groupVerdicts, mapRows, runFindings, shortHash, splitRow, splitUrl } from '../lib/view-models';

let n = 0;
const verdict = (over: Partial<Verdict> & { assetSymbol?: Verdict['assetSymbol'] } = {}): Verdict => ({ kind: 'PASS', basis: 'CONFIRMED', assetSymbol: 'USAT', findings: [], ...over });
const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: (++n).toString(16).padStart(16, '0'),
  kind: 'buy',
  startedAt: '2026-10-22T12:00:00.000Z',
  endpoint: { url: 'https://gateway.usebuy.ai/v1/social/x/posts/search', method: 'POST' },
  steps: [],
  verdicts: [verdict()],
  payments: [],
  ...over,
});

describe('mapRows', () => {
  test('lays cells out for drawing: only the assets that appear, in the order they are listed, fixtures before buy, a gap where there is no cell', () => {
    const cells = mapCells([
      run({ kind: 'fixture', endpoint: { url: 'https://x.example/api/fixtures/ok', method: 'GET' }, verdicts: [verdict({ assetSymbol: 'USAT' }), verdict({ assetSymbol: 'USDC' })] }),
      run({ endpoint: { url: 'https://gateway.usebuy.ai/v1/a', method: 'POST' }, verdicts: [verdict({ assetSymbol: 'USAT' })] }),
    ]);
    const map = mapRows(cells);
    expect(map.assets).toEqual(['USDC', 'USAT']);
    expect(map.groups.map((g) => [g.group, g.rows.map((r) => r.label)])).toEqual([['fixture', ['ok']], ['buy', ['a']]]);
    expect(map.groups[1]!.rows[0]!.cells.USDC).toBeUndefined();
    expect(map.groups[1]!.rows[0]!.cells.USAT).toMatchObject({ verdict: 'PASS' });
  });

  test('nothing in, nothing out', () => {
    expect(mapRows([])).toEqual({ assets: [], groups: [] });
  });

  test('a group with no rows is left out', () => {
    expect(mapRows(mapCells([run()])).groups.map((g) => g.group)).toEqual(['buy']);
  });
});

describe('describeVerdict', () => {
  test('is the kind, with the code after a colon when there is one', () => {
    expect(describeVerdict({ verdict: 'PASS' })).toBe('PASS');
    expect(describeVerdict({ verdict: 'FAIL', code: 'settle_failed' })).toBe('FAIL:settle_failed');
    expect(describeVerdict({ verdict: 'SKIPPED', code: 'over_event_cap' })).toBe('SKIPPED:over_event_cap');
  });
});

describe('formatUsd', () => {
  test.each([
    [0, '$0.00'],
    [2, '$2.00'],
    [1.25, '$1.25'],
    [0.3, '$0.30'],
    [0.1 + 0.2, '$0.30'],
    [0.005, '$0.005'],
    [0.0146, '$0.0146'],
    [0.014636, '$0.014636'],
    [0.000001, '$0.000001'],
    [1234.5, '$1234.50'],
  ])('%f is %s', (value, text) => {
    expect(formatUsd(value)).toBe(text);
  });

  test('something that is not a number is a dash, not NaN', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -Number.POSITIVE_INFINITY]) expect(formatUsd(v)).toBe('—');
  });
});

describe('shortHash and explorerTxUrl', () => {
  const hash = `0x${'ab'.repeat(32)}`;

  test('a hash is shortened to its head and tail', () => {
    expect(shortHash(hash)).toBe('0xabab…abab');
    expect(shortHash('0x1234')).toBe('0x1234');
  });

  test('a transaction links to Blockscout, and only a real transaction hash does', () => {
    expect(explorerTxUrl(hash)).toBe(`https://celo.blockscout.com/tx/${hash}`);
    for (const bad of ['0x123', 'nope', '', `0x${'g'.repeat(64)}`, `${hash}/../x`, `javascript:alert(1)`, `1${hash}`, ` ${hash}`, `x/${hash}`, `${hash}\n`]) expect(explorerTxUrl(bad), bad).toBeNull();
  });
});

describe('explorerAddressUrl', () => {
  const address = `0x${'ab'.repeat(20)}`;

  test('an address links to Blockscout, and only a real address does', () => {
    expect(explorerAddressUrl(address)).toBe(`https://celo.blockscout.com/address/${address}`);
    expect(explorerAddressUrl(ASSETS.USDC.address)).toBe(`https://celo.blockscout.com/address/${ASSETS.USDC.address}`);
    for (const bad of ['0x123', '', 'nope', `0x${'g'.repeat(40)}`, `${address}/../x`, ` ${address}`, `${address}\n`, `x${address}`, `0x${'ab'.repeat(32)}`, `${address}0`, `0x${'ab'.repeat(19)}a`]) expect(explorerAddressUrl(bad), bad).toBeNull();
  });
});

describe('runFindings', () => {
  const f = (code: Parameters<typeof makeFinding>[0], assetSymbol?: 'USDC' | 'USDT' | 'USAT', basis?: 'CONFIRMED' | 'PREDICTED') => makeFinding(code, `${code} happened`, {}, { ...(assetSymbol ? { assetSymbol } : {}), ...(basis ? { basis } : {}) });

  test('what a buyer would hit: errors before warnings, each in the order findings are ranked, and an asset’s own findings in the order the assets are listed', () => {
    const r = run({
      verdicts: [
        verdict({ assetSymbol: 'USAT', findings: [f('too_slow', 'USAT'), f('ambiguous_after_payment', 'USAT'), f('delivered_empty', 'USAT'), f('cors_missing'), f('payto_zero', 'USAT')] }),
        verdict({ assetSymbol: 'USDC', findings: [f('cors_missing'), f('payto_zero', 'USDC')] }),
      ],
    });
    // ambiguous_after_payment is an error that is listed after the warnings: the severity decides, not the listing
    expect(runFindings(r).issues.map((x) => [x.code, x.assetSymbol])).toEqual([
      ['payto_zero', 'USDC'],
      ['payto_zero', 'USAT'],
      ['delivered_empty', 'USAT'],
      ['ambiguous_after_payment', 'USAT'],
      ['cors_missing', undefined],
      ['too_slow', 'USAT'],
    ]);
  });

  test('a finding shown once however many verdicts repeat it, and the one a payment confirmed is the one kept', () => {
    const r = run({
      verdicts: [
        verdict({ basis: 'PREDICTED', findings: [f('cors_missing', 'USDC', 'PREDICTED')] }),
        verdict({ basis: 'CONFIRMED', findings: [f('cors_missing', 'USDC', 'CONFIRMED')] }),
        verdict({ basis: 'PREDICTED', findings: [f('cors_missing', 'USDC', 'PREDICTED')] }),
      ],
    });
    const { issues } = runFindings(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.basis).toBe('CONFIRMED');
  });

  test('notes that only inform are counted, not listed, and each is counted once', () => {
    const r = run({ verdicts: [verdict({ findings: [f('no_output_schema'), f('v1_challenge'), f('no_output_schema'), f('cors_missing')] }), verdict({ assetSymbol: 'USDC', findings: [f('v1_challenge')] })] });
    const out = runFindings(r);
    expect(out.issues.map((x) => x.code)).toEqual(['cors_missing']);
    expect(out.notes).toBe(2);
  });

  test('a run with nothing found has nothing to list', () => {
    expect(runFindings(run({ verdicts: [] }))).toEqual({ issues: [], notes: 0 });
  });
});

describe('groupVerdicts', () => {
  test('what a payment confirmed, and what is only predicted, each in the order the assets are listed, the whole endpoint first', () => {
    const r = run({
      verdicts: [
        verdict({ assetSymbol: 'USAT', basis: 'PREDICTED' }),
        verdict({ assetSymbol: 'USDC', basis: 'PREDICTED' }),
        verdict({ assetSymbol: undefined, basis: 'PREDICTED', kind: 'FAIL', code: 'not_x402' }),
        verdict({ assetSymbol: 'USDT', basis: 'CONFIRMED' }),
        verdict({ assetSymbol: 'USDC', basis: 'CONFIRMED' }),
      ],
    });
    const { confirmed, predicted } = groupVerdicts(r);
    expect(confirmed.map((v) => v.assetSymbol)).toEqual(['USDC', 'USDT']);
    expect(predicted.map((v) => v.assetSymbol)).toEqual([undefined, 'USDC', 'USAT']);
  });

  test('a run of nothing is two empty lists', () => {
    expect(groupVerdicts(run({ verdicts: [] }))).toEqual({ confirmed: [], predicted: [] });
  });
});

const summary = (over: Partial<ScanSummary> = {}): ScanSummary => ({ generatedAt: '2026-10-22T12:00:00.000Z', endpointsScanned: 200, byFinding: {}, assetAcceptance: {}, payablePct: 0, confirmedProbes: 0, ...over });

describe('findingBars', () => {
  test('the most common findings first, as a share of the endpoints scanned, with their severity', () => {
    const bars = findingBars(summary({ byFinding: { cors_missing: 120, too_slow: 50, payto_zero: 4 } }), 2);
    expect(bars).toEqual([
      { code: 'cors_missing', count: 120, share: 0.6, severity: 'warn' },
      { code: 'too_slow', count: 50, share: 0.25, severity: 'warn' },
    ]);
  });

  test('a note that only informs is not something that breaks, so it never makes a bar, however common', () => {
    const bars = findingBars(summary({ byFinding: { no_output_schema: 190, v1_challenge: 150, testnet_entry_present: 90, payto_zero: 2 } }));
    expect(bars.map((b) => b.code)).toEqual(['payto_zero']);
  });

  test('equal counts are ordered by how serious the finding is, then by name, so the list never shuffles', () => {
    const bars = findingBars(summary({ byFinding: { cors_missing: 10, payto_zero: 10, too_slow: 10 } }));
    expect(bars.map((b) => b.code)).toEqual(['payto_zero', 'cors_missing', 'too_slow']);
  });

  test('a finding nobody triggered is not a bar', () => {
    expect(findingBars(summary({ byFinding: { cors_missing: 0, payto_zero: 3 } })).map((b) => b.code)).toEqual(['payto_zero']);
  });

  test('equal counts and equal severity go alphabetically, which is not the order the findings are listed in', () => {
    const bars = findingBars(summary({ byFinding: { not_x402: 5, no_accepts: 5, payto_zero: 5 } }));
    expect(bars.map((b) => b.code)).toEqual(['no_accepts', 'not_x402', 'payto_zero']);
  });

  test('a share is never above one, and an empty scan has no bars and no division by zero', () => {
    expect(findingBars(summary({ endpointsScanned: 3, byFinding: { cors_missing: 9 } }))[0]!.share).toBe(1);
    expect(findingBars(summary({ endpointsScanned: 0, byFinding: { cors_missing: 9 } }))[0]!.share).toBe(0);
    expect(findingBars(summary())).toEqual([]);
  });

  test('the limit defaults to six', () => {
    const byFinding = Object.fromEntries(['not_x402', 'no_accepts', 'payto_zero', 'zero_amount', 'cors_missing', 'too_slow', 'schema_mismatch', 'timeout_too_short'].map((c, i) => [c, 10 + i]));
    expect(findingBars(summary({ byFinding }))).toHaveLength(6);
  });
});

describe('assetBars', () => {
  test('each asset’s share of the endpoints that accept it, in the order the assets are listed', () => {
    const bars = assetBars(summary({ assetAcceptance: { USAT: 50, USDC: 150 } }));
    expect(bars).toEqual([
      { symbol: 'USDC', count: 150, share: 0.75 },
      { symbol: 'USAT', count: 50, share: 0.25 },
    ]);
    expect(bars.map((b) => b.symbol)).toEqual(Object.keys(ASSETS).filter((s) => s === 'USDC' || s === 'USAT'));
  });

  test('no scan, no bars; and a share is never above one', () => {
    expect(assetBars(summary())).toEqual([]);
    expect(assetBars(summary({ endpointsScanned: 2, assetAcceptance: { USDC: 5 } }))[0]!.share).toBe(1);
    expect(assetBars(summary({ endpointsScanned: 0, assetAcceptance: { USDC: 5 } }))[0]!.share).toBe(0);
  });
});

describe('formatWhen', () => {
  test.each([
    ['2026-10-22T12:00:00.000Z', '22 Oct 2026, 12:00 UTC'],
    ['2026-01-05T03:07:59.999Z', '5 Jan 2026, 03:07 UTC'],
    ['2026-12-31T23:59:00Z', '31 Dec 2026, 23:59 UTC'],
  ])('%s is %s', (iso, text) => {
    expect(formatWhen(iso)).toBe(text);
  });

  test('a time that cannot be read is a dash', () => {
    for (const bad of ['', 'yesterday', 'not a date']) expect(formatWhen(bad), bad).toBe('—');
  });

  test('the visitor’s time zone never leaks in: a zone nearly six hours ahead is still the same UTC moment', () => {
    const before = process.env.TZ;
    process.env.TZ = 'Asia/Kathmandu';
    try {
      expect(new Date('2026-10-22T23:30:00Z').getDate(), 'the zone took effect').toBe(23);
      expect(formatWhen('2026-10-22T23:30:00Z')).toBe('22 Oct 2026, 23:30 UTC');
      expect(formatWhen('2026-12-31T23:30:00Z')).toBe('31 Dec 2026, 23:30 UTC');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe('formatPaid', () => {
  test('a dollar asset with six decimals is shown in dollars', () => {
    expect(formatPaid(ASSETS.USAT.address, '5000')).toBe('$0.005');
    expect(formatPaid(ASSETS.USDC.address, '1000000')).toBe('$1.00');
    expect(formatPaid(ASSETS.USDT.address.toLowerCase(), '6030')).toBe('$0.00603');
  });

  test('anything else is shown as what it is: the raw amount, never a guessed dollar value', () => {
    expect(formatPaid(ASSETS.cNGN.address, '5000'), 'six decimals but not a dollar').toBe('5000 units of cNGN');
    expect(formatPaid(ASSETS.wARS.address, '1000000000000000000')).toBe('1000000000000000000 units of wARS');
    expect(formatPaid('0x1234567890123456789012345678901234567890', '5')).toBe('5 units of an unknown token');
  });

  test('the amount is exact at any size a token can hold, and longer than that is a dash', () => {
    expect(formatPaid(ASSETS.USAT.address, '9'.repeat(78))).toBe(`$${'9'.repeat(72)}.999999`);
    expect(formatPaid(ASSETS.cNGN.address, '9'.repeat(78))).toBe(`${'9'.repeat(78)} units of cNGN`);
    expect(formatPaid(ASSETS.USAT.address, '9'.repeat(79))).toBe('—');
    expect(formatPaid(ASSETS.USAT.address, '1' + '0'.repeat(77))).toBe(`$1${'0'.repeat(71)}.00`);
  });

  test('leading zeros are not shown, and zero is zero dollars', () => {
    expect(formatPaid(ASSETS.cNGN.address, '0005')).toBe('5 units of cNGN');
    expect(formatPaid('0x1234567890123456789012345678901234567890', '0005')).toBe('5 units of an unknown token');
    expect(formatPaid(ASSETS.USAT.address, '0005000')).toBe('$0.005');
    expect(formatPaid(ASSETS.USAT.address, '0')).toBe('$0.00');
    expect(formatPaid(ASSETS.USAT.address, '100000')).toBe('$0.10');
  });

  test('an amount that is not a whole number is a dash', () => {
    for (const bad of ['', '1.5', '-5', 'lots', '0x10']) expect(formatPaid(ASSETS.USAT.address, bad), bad).toBe('—');
  });
});

describe('splitRow', () => {
  test('a row name is its folders, quiet, and its last part, plain', () => {
    expect(splitRow('paid/empty')).toEqual({ dir: 'paid/', leaf: 'empty' });
    expect(splitRow('social/x/posts/search')).toEqual({ dir: 'social/x/posts/', leaf: 'search' });
    expect(splitRow('ok')).toEqual({ dir: '', leaf: 'ok' });
  });

  test('the root, a name that starts with a slash, a name that ends with one, and nothing, stay whole', () => {
    expect(splitRow('/')).toEqual({ dir: '', leaf: '/' });
    expect(splitRow('')).toEqual({ dir: '', leaf: '' });
    expect(splitRow('/foo')).toEqual({ dir: '', leaf: '/foo' });
    expect(splitRow('a/')).toEqual({ dir: '', leaf: 'a/' });
  });
});

describe('formatUsdShort', () => {
  test('whole dollars drop the cents; anything else is as formatUsd writes it', () => {
    expect(formatUsdShort(3)).toBe('$3');
    expect(formatUsdShort(0)).toBe('$0');
    expect(formatUsdShort(1234)).toBe('$1234');
    expect(formatUsdShort(0.05)).toBe('$0.05');
    expect(formatUsdShort(0.1)).toBe('$0.10');
    expect(formatUsdShort(0.005)).toBe('$0.005');
    expect(formatUsdShort(3.5)).toBe('$3.50');
  });

  test('something that is not a number is a dash', () => {
    expect(formatUsdShort(Number.NaN)).toBe('—');
  });
});

describe('splitUrl', () => {
  test('a web address in two parts: the host, to be shown quietly, and the path, to be shown plain', () => {
    expect(splitUrl('https://railwalker-sample.example/api/fixtures/ok')).toEqual({ host: 'railwalker-sample.example', path: '/api/fixtures/ok' });
    expect(splitUrl('https://gateway.usebuy.ai:8443/v1/social/x?q=1')).toEqual({ host: 'gateway.usebuy.ai:8443', path: '/v1/social/x?q=1' });
    expect(splitUrl('https://seller.example/a?b=1#top')).toEqual({ host: 'seller.example', path: '/a?b=1' }); // a fragment never leaves the browser, so it is not part of what was asked
  });

  test('a bare host has the root as its path', () => {
    expect(splitUrl('https://seller.example')).toEqual({ host: 'seller.example', path: '/' });
    expect(splitUrl('https://seller.example/')).toEqual({ host: 'seller.example', path: '/' });
  });

  test('something that is not a web address is shown whole, as the path', () => {
    expect(splitUrl('not a url')).toEqual({ host: '', path: 'not a url' });
    expect(splitUrl('')).toEqual({ host: '', path: '' });
  });
});
