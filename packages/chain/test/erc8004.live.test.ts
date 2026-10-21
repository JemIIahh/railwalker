import { expect, test } from 'vitest';
import { IDENTITY_ABI, REGISTRIES, buildRegistration, loadConfig, makeClients, registerAgent, toAgentUri, verifyTagged } from '../src';

// LIVE=1 only. Needs a Sepolia-funded AGENT_PRIVATE_KEY and the expected RAILWALKER_ATTRIBUTION_CODE in the environment.
test('registers on Sepolia, reads the URI back from tokenURI, and the transaction carries our tag', async () => {
  const cfg = loadConfig({ ...process.env, RAILWALKER_NETWORK: 'sepolia', RAILWALKER_AGENT_ID: undefined });
  const c = makeClients(cfg);
  const uri = toAgentUri(buildRegistration({ name: 'Railwalker (test)', description: 'Sepolia registration test.', webUrl: 'https://github.com/JemIIahh/railwalker' }));

  const { hash, agentId } = await registerAgent(c, cfg, uri);

  expect(await c.publicClient.readContract({ address: REGISTRIES.sepolia.identity, abi: IDENTITY_ABI, functionName: 'tokenURI', args: [agentId] })).toBe(uri);
  expect(await verifyTagged(c, hash)).toMatchObject({ codes: [cfg.attributionCode], schemaId: 0 });
}, 90_000);
