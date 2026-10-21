import { describe, expect, test } from 'vitest';
import { assetByAddress } from '@railwalker/core';
import { privateKeyToAddress } from 'viem/accounts';
import { getWalletFacts, listTokenTransfers } from '../src';

// Read-only calls to the public Celo Blockscout. They run only with LIVE=1, and they only ask questions.
// The buy gateway's payee wallet is public on-chain data: it has never sent a transaction, and only ever received tokens.
const PAYEE = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B';

describe('Blockscout (live)', () => {
  test('a wallet that only ever received tokens has a first activity and a first funder, as the real history says', async () => {
    const facts = await getWalletFacts(PAYEE);
    expect(facts).toEqual({ address: PAYEE, firstActivityAt: '2026-08-26T16:45:24.000Z', firstFunder: '0xa242f5baa872ac3920b84ac2a5cd68e63460578b' });
  });

  test('the recent transfers into it are listed oldest first, in tokens we know, with whole-number amounts', async () => {
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const transfers = await listTokenTransfers(PAYEE, { direction: 'in', since });
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.map((t) => t.at)).toEqual([...transfers.map((t) => t.at)].sort());
    for (const t of transfers) {
      expect(t.to).toBe(PAYEE.toLowerCase());
      expect(t.at >= since).toBe(true);
      expect(t.amountAtomic).toMatch(/^\d+$/);
      expect(t.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(transfers.some((t) => assetByAddress(t.token) !== null)).toBe(true);
  });

  test('a wallet that does not exist on chain has no history, and that is an answer, not an error', async () => {
    const facts = await getWalletFacts('0x000000000000000000000000000000000000dEaD'.replace('dEaD', 'beef'));
    expect(facts.firstFunder).toBeNull();
  });

  test.skipIf(!process.env.AGENT_PRIVATE_KEY)('the agent wallet, when there is one: facts have the right shape, whatever its history', async () => {
    const address = privateKeyToAddress(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
    const facts = await getWalletFacts(address);
    expect(facts.address).toBe(address);
    expect(facts.firstActivityAt === null || Number.isFinite(Date.parse(facts.firstActivityAt))).toBe(true);
    expect(facts.firstFunder === null || /^0x[0-9a-f]{40}$/.test(facts.firstFunder)).toBe(true);
  });
});
