import { expect, test } from 'vitest';
import { loadConfig, makeClients, sendTagged, verifyTagged } from '../src';

// LIVE=1 only. Needs a Sepolia-funded AGENT_PRIVATE_KEY and the expected RAILWALKER_ATTRIBUTION_CODE in the environment.
test('a zero-value tagged transaction to self on Sepolia is read back with our code', async () => {
  const cfg = loadConfig({ ...process.env, RAILWALKER_NETWORK: 'sepolia' });
  const c = makeClients(cfg);
  const hash = await sendTagged(c, { to: c.account.address, value: 0n });
  await c.publicClient.waitForTransactionReceipt({ hash });
  expect(await verifyTagged(c, hash)).toMatchObject({ codes: [cfg.attributionCode], schemaId: 0 });
}, 60_000);
