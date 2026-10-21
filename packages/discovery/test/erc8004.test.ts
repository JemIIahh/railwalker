import { describe, expect, test } from 'vitest';
import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import { IDENTITY_ABI, REGISTRIES, loadConfig } from '@railwalker/chain';
import { endpointsFromRegistration, listRegisteredAgents, type AgentLister } from '../src';

const KEY = `0x${'11'.repeat(32)}` as const;
const sepolia = loadConfig({ AGENT_PRIVATE_KEY: KEY });
const mainnet = loadConfig({ AGENT_PRIVATE_KEY: KEY, RAILWALKER_NETWORK: 'mainnet', RAILWALKER_ATTRIBUTION_CODE: 'celo_29928c447ace', SELLER_SALT: 'a-long-secret-salt-1234' });

/** A registry in which only the ids `exists` accepts are registered; tokenURI reverts for every other id, as it does for an id nobody owns. */
function registry(exists: (id: bigint) => boolean, uriOf: (id: bigint) => unknown = (id) => `https://agent.example/${id}.json`) {
  const calls: { address: string; abi: unknown; functionName: string; ids: bigint[]; allowFailure: boolean }[] = [];
  const client: AgentLister = {
    async multicall({ contracts, allowFailure }) {
      calls.push({ address: contracts[0]!.address, abi: contracts[0]!.abi, functionName: contracts[0]!.functionName, ids: contracts.map((c) => c.args[0]), allowFailure });
      return contracts.map((c) => (exists(c.args[0]) ? { status: 'success' as const, result: uriOf(c.args[0]) } : { status: 'failure' as const, error: new Error('ERC721NonexistentToken') }));
    },
  };
  return { client, calls, sizes: () => calls.map((c) => c.ids.length) };
}
/** Ids 1 to n are registered. */
const upTo = (n: number) => (id: bigint) => id >= 1n && id <= BigInt(n);

describe('listRegisteredAgents', () => {
  test('asks the identity registry of the configured network for tokenURI(id), a hundred ids to a call, and returns the ids that exist', async () => {
    const { client, calls } = registry((id) => [1n, 2n, 3n, 150n].includes(id));
    const result = await listRegisteredAgents(client, mainnet, { nextId: 1n, maxIds: 1000 });
    expect(result.agents).toEqual([1n, 2n, 3n, 150n].map((agentId) => ({ agentId, agentUri: `https://agent.example/${agentId}.json` })));
    expect(calls.map((c) => c.ids.length)).toEqual([100, 100, 100]); // the third is all failures, so the scan ends there
    expect(calls[0]!.ids[0]).toBe(1n);
    expect(calls[0]!.ids.at(-1)).toBe(100n);
    expect(calls[1]!.ids[0]).toBe(101n);
    for (const call of calls) expect(call).toMatchObject({ address: REGISTRIES.mainnet.identity, abi: IDENTITY_ABI, functionName: 'tokenURI', allowFailure: true });
  });

  test('the other network has its own registry', async () => {
    const { client, calls } = registry(upTo(3));
    await listRegisteredAgents(client, sepolia, { nextId: 1n, maxIds: 100 });
    expect(calls[0]!.address).toBe(REGISTRIES.sepolia.identity);
  });

  test('a chunk with some ids missing is not the end: the scan goes on to the next', async () => {
    const { client, sizes } = registry((id) => id === 100n || id === 101n);
    const result = await listRegisteredAgents(client, mainnet, { nextId: 1n, maxIds: 1000 });
    expect(result.agents.map((a) => a.agentId)).toEqual([100n, 101n]);
    expect(sizes()).toEqual([100, 100, 100]); // [1..100] has id 100, [101..200] has 101, [201..300] has nothing
  });

  test('stops after the first chunk in which every id fails, and the budget does not matter then', async () => {
    const { client, sizes } = registry(upTo(5));
    await listRegisteredAgents(client, mainnet, { nextId: 1n, maxIds: 1_000_000 });
    expect(sizes()).toEqual([100, 100]);
  });

  test('stops at maxIds, with the last chunk as small as it has to be', async () => {
    const { client, sizes } = registry(() => true);
    const result = await listRegisteredAgents(client, mainnet, { nextId: 1n, maxIds: 250 });
    expect(sizes()).toEqual([100, 100, 50]);
    expect(result.agents).toHaveLength(250);
  });

  test('a budget that is not a whole number is rounded down', async () => {
    const { client, sizes } = registry(() => true);
    await listRegisteredAgents(client, mainnet, { nextId: 1n, maxIds: 150.9 });
    expect(sizes()).toEqual([100, 50]);
  });

  test.each([[0], [-5]])('a budget of %i asks nothing and leaves the cursor where it was', async (maxIds) => {
    const { client, calls } = registry(() => true);
    expect(await listRegisteredAgents(client, mainnet, { nextId: 5n, maxIds })).toEqual({ agents: [], nextId: 5n });
    expect(calls).toHaveLength(0);
  });

  test.each([[Number.NaN], [Number.POSITIVE_INFINITY]])('a budget of %f is refused: there would be no end to it', async (maxIds) => {
    await expect(listRegisteredAgents(registry(() => true).client, mainnet, { nextId: 1n, maxIds })).rejects.toThrow(/maxIds/);
  });

  test('a negative starting id is refused', async () => {
    await expect(listRegisteredAgents(registry(() => true).client, mainnet, { nextId: -1n, maxIds: 10 })).rejects.toThrow(/nextId/);
  });

  test('ids registered without a readable URI exist but are not agents: an empty or non-text URI is skipped, and so is an absurdly long one', async () => {
    const uris: Record<string, unknown> = { '1': 'https://a.example/1.json', '2': '', '3': 42, '4': null, '5': 'u'.repeat(400_000) };
    const { client } = registry(upTo(5), (id) => uris[String(id)]);
    const result = await listRegisteredAgents(client, mainnet, { nextId: 1n, maxIds: 100 });
    expect(result.agents.map((a) => a.agentId)).toEqual([1n]);
  });

  test('a multicall that answers with fewer results than asked counts the missing ones as failures', async () => {
    const short: AgentLister = { multicall: async () => [{ status: 'success', result: 'https://a.example/1.json' }] };
    const result = await listRegisteredAgents(short, mainnet, { nextId: 1n, maxIds: 100 });
    expect(result.agents).toEqual([{ agentId: 1n, agentUri: 'https://a.example/1.json' }]);
  });

  test('an RPC that fails outright is an error for the caller to decide about', async () => {
    const down: AgentLister = { multicall: async () => Promise.reject(new Error('rpc down')) };
    await expect(listRegisteredAgents(down, mainnet, { nextId: 1n, maxIds: 100 })).rejects.toThrow('rpc down');
  });

  test('ids beyond 2^53 are fine', async () => {
    const start = 2n ** 64n;
    const { client, calls } = registry((id) => id >= start && id < start + 5n);
    const result = await listRegisteredAgents(client, mainnet, { nextId: start, maxIds: 100 });
    expect(calls[0]!.ids[0]).toBe(start);
    expect(result.agents).toHaveLength(5);
    expect(result.nextId).toBe(start + 5n);
  });

  test('a real viem client can be handed in (checked by the compiler)', () => {
    const lister: AgentLister = createPublicClient({ chain: celo, transport: http('https://forno.celo.org') });
    expect(typeof lister.multicall).toBe('function');
  });
});

describe('listRegisteredAgents: the cursor', () => {
  test('at the end of the registry it points just past the last id that exists, so ids registered later are found next time', async () => {
    const firstRun = await listRegisteredAgents(registry(upTo(5)).client, mainnet, { nextId: 1n, maxIds: 1000 });
    expect(firstRun.nextId).toBe(6n);
    const secondRun = await listRegisteredAgents(registry(upTo(8)).client, mainnet, { nextId: firstRun.nextId, maxIds: 1000 });
    expect(secondRun.agents.map((a) => a.agentId)).toEqual([6n, 7n, 8n]);
    expect(secondRun.nextId).toBe(9n);
  });

  test('across a chunk boundary: ids up to 150 give 151', async () => {
    expect((await listRegisteredAgents(registry(upTo(150)).client, mainnet, { nextId: 1n, maxIds: 1000 })).nextId).toBe(151n);
  });

  test('the registry ending inside the last chunk the budget allowed still points at the first id that did not exist', async () => {
    const result = await listRegisteredAgents(registry(upTo(220)).client, mainnet, { nextId: 1n, maxIds: 250 });
    expect(result.nextId).toBe(221n);
  });

  test('when the budget stops the scan with every id tried present, it points just past the last id tried', async () => {
    const result = await listRegisteredAgents(registry(() => true).client, mainnet, { nextId: 1n, maxIds: 250 });
    expect(result.nextId).toBe(251n);
  });

  test('a scan that finds nothing leaves the cursor where it was', async () => {
    const { client, sizes } = registry(() => false);
    expect(await listRegisteredAgents(client, mainnet, { nextId: 500n, maxIds: 1000 })).toEqual({ agents: [], nextId: 500n });
    expect(sizes()).toEqual([100]);
  });

  test('an id that exists without a readable URI still moves the cursor past it', async () => {
    const result = await listRegisteredAgents(registry(upTo(5), (id) => (id === 5n ? '' : 'https://a.example/x.json')).client, mainnet, { nextId: 1n, maxIds: 100 });
    expect(result.agents.map((a) => a.agentId)).toEqual([1n, 2n, 3n, 4n]);
    expect(result.nextId).toBe(6n);
  });
});

const registration = (over: Record<string, unknown> = {}) => ({
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Weather Oracle',
  description: 'Hourly weather data, paid per call.',
  services: [{ name: 'web', endpoint: 'https://weather.example/api/forecast', version: '1' }],
  x402Support: true,
  active: true,
  ...over,
});

describe('endpointsFromRegistration', () => {
  test('returns the https service endpoints of an agent that supports x402, as erc8004 endpoints to be read with GET', () => {
    expect(endpointsFromRegistration('42', registration())).toEqual([
      { url: 'https://weather.example/api/forecast', method: 'GET', source: 'erc8004', agentId: '42', description: 'Hourly weather data, paid per call.' },
    ]);
  });

  test.each([[false], ['true'], [1], [null], [undefined]])('x402Support of %j means nothing is returned: only a true is a yes', (x402Support) => {
    expect(endpointsFromRegistration('42', registration({ x402Support }))).toEqual([]);
  });

  test.each([[null], [undefined], ['x'], [42], [true], [[]], [{}], [{ x402Support: true }]])('%j is not a registration', (reg) => {
    expect(endpointsFromRegistration('42', reg)).toEqual([]);
  });

  test('only https endpoints count: not http, not other schemes, not names on other systems', () => {
    const services = ['http://a.example/x', 'ftp://a.example/x', 'ens://agent.eth', 'did:web:a.example', 'mailto:a@a.example', 'javascript:alert(1)', 'data:text/plain,hi', 'wss://a.example/x', 'a.example/x', ''].map((endpoint) => ({ name: 'x', endpoint }));
    expect(endpointsFromRegistration('42', registration({ services }))).toEqual([]);
  });

  test('what the scanner would refuse anyway is dropped here: IP addresses, local names, credentials, odd ports', () => {
    const services = ['https://203.0.113.5/x', 'https://[::1]/x', 'https://localhost/x', 'https://printer.local/x', 'https://user:pw@a.example/x', 'https://a.example:8443/x', 'https://singlelabel/x'].map((endpoint) => ({ name: 'x', endpoint }));
    expect(endpointsFromRegistration('42', registration({ services }))).toEqual([]);
  });

  test('older registrations used an endpoints list with url fields; they are read too', () => {
    const out = endpointsFromRegistration('42', registration({ services: undefined, endpoints: [{ name: 'web', url: 'https://old.example/api' }] }));
    expect(out.map((e) => e.url)).toEqual(['https://old.example/api']);
    const mixed = endpointsFromRegistration('42', registration({ services: [{ name: 'web', endpoint: 'https://new.example/api' }], endpoints: [{ name: 'web', url: 'https://old.example/api' }] }));
    expect(mixed.map((e) => e.url)).toEqual(['https://new.example/api', 'https://old.example/api']);
  });

  test('entries that are not objects, or have no usable endpoint, are skipped', () => {
    const services = [null, 1, 'https://a.example/x', [], {}, { name: 'web' }, { endpoint: 5 }, { endpoint: 'https://ok.example/x' }];
    expect(endpointsFromRegistration('42', registration({ services })).map((e) => e.url)).toEqual(['https://ok.example/x']);
  });

  test('services that is not a list gives nothing', () => {
    for (const services of ['x', 5, { endpoint: 'https://a.example/x' }, null]) expect(endpointsFromRegistration('42', registration({ services }))).toEqual([]);
  });

  test('at most five endpoints per agent: a registration is a stranger’s list, and each entry is a scan', () => {
    const services = Array.from({ length: 40 }, (_, i) => ({ name: 'web', endpoint: `https://seller${i}.example/api` }));
    const out = endpointsFromRegistration('42', registration({ services }));
    expect(out.map((e) => e.url)).toEqual([0, 1, 2, 3, 4].map((i) => `https://seller${i}.example/api`));
  });

  test('the same endpoint listed twice is one endpoint, and does not use up the five', () => {
    const services = [{ endpoint: 'https://a.example/x' }, { endpoint: 'https://A.example/x' }, { endpoint: 'https://b.example/x' }];
    expect(endpointsFromRegistration('42', registration({ services })).map((e) => e.url)).toEqual(['https://a.example/x', 'https://b.example/x']);
  });

  test('the agent’s wallet is kept when the registration states one that is a valid address, and not otherwise', () => {
    const wallet = '0x2222222222222222222222222222222222222222';
    expect(endpointsFromRegistration('42', registration({ agentWallet: wallet }))[0]!.agentWallet).toBe(wallet);
    for (const agentWallet of ['0x123', 'nobody', 5, null]) expect('agentWallet' in endpointsFromRegistration('42', registration({ agentWallet }))[0]!, String(agentWallet)).toBe(false);
  });

  test('a wallet written in lower case is returned checksummed', () => {
    const lower = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
    expect(endpointsFromRegistration('42', registration({ agentWallet: lower }))[0]!.agentWallet).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
  });

  test('no more than two hundred entries are looked at, and an address over 2048 characters is not an endpoint', () => {
    const junk = Array.from({ length: 250 }, () => ({ endpoint: 'ens://nobody.eth' }));
    expect(endpointsFromRegistration('42', registration({ services: [...junk, { endpoint: 'https://late.example/x' }] }))).toEqual([]);
    expect(endpointsFromRegistration('42', registration({ services: [{ endpoint: `https://a.example/${'x'.repeat(3000)}` }] }))).toEqual([]);
  });

  test('the description is the agent’s, and is bounded', () => {
    expect(endpointsFromRegistration('42', registration({ description: 'd'.repeat(5000) }))[0]!.description!.length).toBeLessThanOrEqual(301);
    expect('description' in endpointsFromRegistration('42', registration({ description: 5 }))[0]!).toBe(false);
  });

  test('an agent id that is not a plain number is refused: it would be quoted back in reports', () => {
    for (const id of ['', 'abc', '-1', '1.5', '12 34', '0x2a', '1'.repeat(100)]) expect(endpointsFromRegistration(id, registration()), id).toEqual([]);
    expect(endpointsFromRegistration('0', registration())).toHaveLength(1);
  });

  test('a hostile registration is read without throwing: huge text, deep nesting, __proto__ keys', () => {
    const hostile = JSON.parse(`{"x402Support":true,"description":${JSON.stringify('d'.repeat(1_000_000))},"services":[{"__proto__":{"endpoint":"https://evil.example/x"},"endpoint":"https://ok.example/x"}],"deep":${'['.repeat(500)}${']'.repeat(500)}}`);
    const out = endpointsFromRegistration('42', hostile);
    expect(out.map((e) => e.url)).toEqual(['https://ok.example/x']);
  });
});
