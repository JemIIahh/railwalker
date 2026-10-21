import { describe, expect, test } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from 'viem';
import { parseTransaction } from 'viem/celo';
import { fromDataSuffix, toDataSuffix } from '@celo/attribution-tags';
import { RAILWALKER_USER_AGENT } from '@railwalker/core';
import { fakeFetch } from '@railwalker/testkit';
import { IDENTITY_ABI, REGISTRIES, REPUTATION_ABI, buildRegistration, feeCurrencyFor, giveFeedback, loadConfig, loadRegistration, makeClients, readAgentWallet, registerAgent, toAgentUri } from '../src';
import { fakeCeloRpc, type ReceiptPlan } from './fake-rpc';

const KEY = `0x${'11'.repeat(32)}` as const;
const CODE = 'celo_29928c447ace';
const SEPOLIA = 11142220;
const OWNER = '0x2222222222222222222222222222222222222222' as const;
const SALT = 'a-long-secret-salt-1234';
const FEEDBACK_HASH = `0x${'cd'.repeat(32)}` as const;

const sepolia = (extra: Record<string, string> = {}) => loadConfig({ AGENT_PRIVATE_KEY: KEY, RAILWALKER_ATTRIBUTION_CODE: CODE, ...extra });
const mainnet = () => loadConfig({ AGENT_PRIVATE_KEY: KEY, RAILWALKER_NETWORK: 'mainnet', RAILWALKER_ATTRIBUTION_CODE: CODE, SELLER_SALT: SALT });

const meta = { name: 'Railwalker', description: 'Mystery shopper for Celo x402 sellers.', webUrl: 'https://railwalker.example' };

/** What the sent transaction looked like once the tag is stripped. */
function sentTx(raw: Hex) {
  const tx = parseTransaction(raw as never) as unknown as { to: string; data: Hex; type: string; feeCurrency?: string };
  const suffix = toDataSuffix(CODE);
  return { ...tx, tagged: fromDataSuffix(tx.data), calldata: tx.data.slice(0, tx.data.length - (suffix.length - 2)) as Hex };
}

const registeredLog = (a: { agentId: bigint; uri: string; owner?: string; address?: string }): unknown => ({
  address: a.address ?? REGISTRIES.sepolia.identity,
  topics: encodeEventTopics({ abi: IDENTITY_ABI, eventName: 'Registered', args: { agentId: a.agentId, owner: (a.owner ?? OWNER) as `0x${string}` } }),
  data: encodeAbiParameters([{ type: 'string' }], [a.uri]),
  blockNumber: '0x10',
  blockHash: `0x${'22'.repeat(32)}`,
  transactionHash: `0x${'33'.repeat(32)}`,
  transactionIndex: '0x0',
  logIndex: '0x0',
  removed: false,
});

describe('buildRegistration', () => {
  test('is the current registration-v1 shape: type URI, services with name and endpoint, x402 and reputation', () => {
    expect(buildRegistration(meta)).toEqual({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Railwalker',
      description: 'Mystery shopper for Celo x402 sellers.',
      services: [{ name: 'web', endpoint: 'https://railwalker.example' }],
      x402Support: true,
      active: true,
      supportedTrust: ['reputation'],
    });
  });

  test('an MCP endpoint and an image are added when given, and only then', () => {
    const r = buildRegistration({ ...meta, mcpUrl: 'https://railwalker.example/mcp', image: 'ipfs://bafyimage' });
    expect(r.services).toEqual([
      { name: 'web', endpoint: 'https://railwalker.example' },
      { name: 'MCP', endpoint: 'https://railwalker.example/mcp' },
    ]);
    expect(r.image).toBe('ipfs://bafyimage');
    expect('image' in buildRegistration(meta)).toBe(false);
  });

  test('an https image is accepted', () => {
    expect(buildRegistration({ ...meta, image: 'https://railwalker.example/logo.png' }).image).toBe('https://railwalker.example/logo.png');
  });

  test('none of the deprecated shapes appear: no endpoints array, no url key, no "Agent" type', () => {
    const r = buildRegistration({ ...meta, mcpUrl: 'https://railwalker.example/mcp' });
    expect('endpoints' in r).toBe(false);
    for (const s of r.services as Record<string, unknown>[]) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.endpoint).toBe('string');
      expect('url' in s).toBe(false);
    }
    expect(r.type).not.toBe('Agent');
  });

  test.each([
    ['an http web URL', { webUrl: 'http://railwalker.example' }],
    ['a web URL that is not a URL', { webUrl: 'railwalker' }],
    ['an http MCP URL', { mcpUrl: 'http://railwalker.example/mcp' }],
    ['an empty name', { name: '' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['a description over 1000 characters', { description: 'x'.repeat(1001) }],
    ['an image that is neither ipfs nor https', { image: 'http://railwalker.example/logo.png' }],
    ['an image that is a data URL', { image: 'data:image/png;base64,AAAA' }],
  ] as const)('%s is refused: a registration is permanent', (_name, over) => {
    expect(() => buildRegistration({ ...meta, ...over })).toThrow(TypeError);
  });
});

describe('toAgentUri', () => {
  test('is a base64 JSON data URI that round-trips to the same JSON', () => {
    const reg = buildRegistration({ ...meta, mcpUrl: 'https://railwalker.example/mcp' });
    const uri = toAgentUri(reg);
    expect(uri.startsWith('data:application/json;base64,')).toBe(true);
    expect(JSON.parse(Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8'))).toEqual(reg);
  });

  test('non-ASCII text survives the round trip', () => {
    const reg = buildRegistration({ ...meta, description: 'Cuenta de cobro: ¿cuánto cuesta? 🐦' });
    const back = JSON.parse(Buffer.from(toAgentUri(reg).split(',')[1]!, 'base64').toString('utf8'));
    expect(back.description).toBe('Cuenta de cobro: ¿cuánto cuesta? 🐦');
  });
});

describe('the deployed registries', () => {
  test('addresses on both networks, from the deployments', () => {
    expect(REGISTRIES.mainnet).toEqual({ identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' });
    expect(REGISTRIES.sepolia).toEqual({ identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e', reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713' });
  });

  test('the recorded ABI has only what is used, with string tags as deployed', () => {
    expect(IDENTITY_ABI.map((i) => i.name).sort()).toEqual(['Registered', 'getAgentWallet', 'register', 'tokenURI']);
    expect(REPUTATION_ABI.map((i) => i.name).sort()).toEqual(['NewFeedback', 'giveFeedback']);
    const give = REPUTATION_ABI.find((i) => i.name === 'giveFeedback')!;
    expect(give.inputs.map((x) => `${x.type} ${x.name}`)).toEqual([
      'uint256 agentId',
      'int128 value',
      'uint8 valueDecimals',
      'string tag1',
      'string tag2',
      'string endpoint',
      'string feedbackURI',
      'bytes32 feedbackHash',
    ]);
  });
});

describe('registerAgent', () => {
  const uri = toAgentUri(buildRegistration(meta));
  const plan = (p: ReceiptPlan | ((to: string | null) => ReceiptPlan)) => (sent: { to: string | null }) => (typeof p === 'function' ? p(sent.to) : p);

  test('sends register(string) with the data URI to the identity registry, tagged, and returns the agentId from the Registered event', async () => {
    const rpc = fakeCeloRpc(SEPOLIA, { receipt: plan({ logs: [registeredLog({ agentId: 42n, uri })] }) });
    const c = makeClients(sepolia(), { transport: rpc.transport });
    const result = await registerAgent(c, sepolia(), uri);

    const [raw] = rpc.rawTxs();
    expect(rpc.rawTxs()).toHaveLength(1);
    const tx = sentTx(raw!);
    expect(tx.to.toLowerCase()).toBe(REGISTRIES.sepolia.identity.toLowerCase());
    expect(decodeFunctionData({ abi: IDENTITY_ABI, data: tx.calldata })).toEqual({ functionName: 'register', args: [uri] });
    expect(tx.tagged).toMatchObject({ codes: [CODE], schemaId: 0 });
    expect(result).toEqual({ hash: expect.stringMatching(/^0x[0-9a-f]{64}$/), agentId: 42n });
  });

  test('on mainnet it goes to the mainnet registry', async () => {
    const rpc = fakeCeloRpc(42220, { receipt: plan({ logs: [registeredLog({ agentId: 7n, uri, address: REGISTRIES.mainnet.identity })] }) });
    const cfg = mainnet();
    await registerAgent(makeClients(cfg, { transport: rpc.transport }), cfg, uri);
    expect(sentTx(rpc.rawTxs()[0]!).to.toLowerCase()).toBe(REGISTRIES.mainnet.identity.toLowerCase());
  });

  test('gas can be paid in a fee adapter: the wallet may hold only stablecoins', async () => {
    const rpc = fakeCeloRpc(SEPOLIA, { receipt: plan({ logs: [registeredLog({ agentId: 1n, uri })] }) });
    await registerAgent(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), uri, { fee: 'USAT' });
    const tx = sentTx(rpc.rawTxs()[0]!);
    expect(tx.type).toBe('cip64');
    expect(tx.feeCurrency!.toLowerCase()).toBe(feeCurrencyFor('USAT').toLowerCase());
  });

  test('the agentId comes from the registry that was called: a Registered event from any other contract is ignored', async () => {
    const rpc = fakeCeloRpc(SEPOLIA, {
      receipt: plan({ logs: [registeredLog({ agentId: 999n, uri, address: '0x9999999999999999999999999999999999999999' })] }),
    });
    await expect(registerAgent(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), uri)).rejects.toThrow(/Registered/);
  });

  test('a reverted registration is an error, not an agentId', async () => {
    const rpc = fakeCeloRpc(SEPOLIA, { receipt: plan({ status: 'reverted' }) });
    await expect(registerAgent(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), uri)).rejects.toThrow(/reverted/);
  });

  test('a wallet that is already registered is refused before anything is sent: a second register mints a second identity', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const cfg = sepolia({ RAILWALKER_AGENT_ID: '5' });
    await expect(registerAgent(makeClients(cfg, { transport: rpc.transport }), cfg, uri)).rejects.toThrow(/already registered/);
    expect(rpc.seen).toEqual([]);
  });

  const b64json = (v: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(v)).toString('base64')}`;
  test.each([
    ['an https URI (it can be changed after registration)', 'https://example.com/agent.json', /can be changed after registration/],
    ['a data URI that is not JSON', 'data:text/plain;base64,aGVsbG8=', /base64 JSON data URI/],
    ['an empty string', '', /1 to 16384 characters/],
    ['a URI over 16 KB', `data:application/json;base64,${'A'.repeat(17_000)}`, /1 to 16384 characters/],
    ['JSON that is not a registration', b64json({ a: 1 }), /registration-v1 document/],
    ['a registration with the old type', b64json({ ...buildRegistration(meta), type: 'Agent' }), /registration-v1 document/],
    ['JSON that does not parse', `data:application/json;base64,${Buffer.from('{"a":').toString('base64')}`, /registration-v1 document/],
  ] as const)('%s is refused before anything is sent', async (_name, bad, reason) => {
    const rpc = fakeCeloRpc(SEPOLIA);
    await expect(registerAgent(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), bad)).rejects.toMatchObject({ name: 'TypeError', message: expect.stringMatching(reason) });
    expect(rpc.seen).toEqual([]);
  });

  test('an ipfs:// URI is accepted: its CID is the integrity check', async () => {
    const rpc = fakeCeloRpc(SEPOLIA, { receipt: plan({ logs: [registeredLog({ agentId: 3n, uri: 'ipfs://bafyreg' })] }) });
    const r = await registerAgent(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), 'ipfs://bafyreg');
    expect(r.agentId).toBe(3n);
  });

  test('without an attribution code nothing is sent', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const cfg = loadConfig({ AGENT_PRIVATE_KEY: KEY });
    await expect(registerAgent(makeClients(cfg, { transport: rpc.transport }), cfg, uri)).rejects.toThrow(/attribution/);
    expect(rpc.rawTxs()).toEqual([]);
  });
});

describe('giveFeedback', () => {
  const args = { agentId: 42n, value: 95, tag1: 'x402-check', tag2: 'PASS', endpoint: 'https://seller.example/api/data', feedbackUri: 'ipfs://bafyreport', feedbackHash: FEEDBACK_HASH };

  test('sends giveFeedback with string tags and an int128 value to the reputation registry, tagged', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    const hash = await giveFeedback(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), args);
    const tx = sentTx(rpc.rawTxs()[0]!);
    expect(tx.to.toLowerCase()).toBe(REGISTRIES.sepolia.reputation.toLowerCase());
    expect(decodeFunctionData({ abi: REPUTATION_ABI, data: tx.calldata })).toEqual({
      functionName: 'giveFeedback',
      args: [42n, 95n, 0, 'x402-check', 'PASS', 'https://seller.example/api/data', 'ipfs://bafyreport', FEEDBACK_HASH],
    });
    expect(tx.tagged).toMatchObject({ codes: [CODE] });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('a negative value is allowed (int128), and gas can be paid in an adapter', async () => {
    const rpc = fakeCeloRpc(SEPOLIA);
    await giveFeedback(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), { ...args, value: -5 }, { fee: 'USDC' });
    const tx = sentTx(rpc.rawTxs()[0]!);
    expect((decodeFunctionData({ abi: REPUTATION_ABI, data: tx.calldata }).args as readonly unknown[])[1]).toBe(-5n);
    expect(tx.type).toBe('cip64');
  });

  test.each([
    ['a fractional value', { value: 0.5 }],
    ['NaN', { value: NaN }],
    ['a value beyond 2^53', { value: 2 ** 60 }],
    ['a feedback hash that is not 32 bytes', { feedbackHash: '0x1234' as `0x${string}` }],
    ['a negative agent id', { agentId: -1n }],
  ] as const)('%s is refused before anything is sent', async (_name, over) => {
    const rpc = fakeCeloRpc(SEPOLIA);
    await expect(giveFeedback(makeClients(sepolia(), { transport: rpc.transport }), sepolia(), { ...args, ...over })).rejects.toThrow(TypeError);
    expect(rpc.seen).toEqual([]);
  });
});

describe('readAgentWallet', () => {
  const reader = (answer: unknown) => {
    const calls: unknown[] = [];
    return { calls, reader: { readContract: async (a: unknown) => (calls.push(a), answer) } as never };
  };

  test('calls getAgentWallet on the identity registry for that agent and returns a checksummed address', async () => {
    const mixed = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const r = reader(mixed);
    const wallet = await readAgentWallet(r.reader, sepolia(), 42n);
    expect(wallet).toBe(getAddress(mixed));
    expect(wallet).not.toBe(mixed); // the checksummed form differs from the lowercase one, so this proves it was checksummed
    expect(r.calls).toEqual([expect.objectContaining({ address: REGISTRIES.sepolia.identity, functionName: 'getAgentWallet', args: [42n] })]);
  });

  test('uses the mainnet registry on mainnet', async () => {
    const r = reader(OWNER);
    await readAgentWallet(r.reader, mainnet(), 1n);
    expect(r.calls[0]).toMatchObject({ address: REGISTRIES.mainnet.identity });
  });

  test('an answer that is not an address is an error, not a value', async () => {
    await expect(readAgentWallet(reader('0x12').reader, sepolia(), 1n)).rejects.toThrow(/address/);
    await expect(readAgentWallet(reader(undefined).reader, sepolia(), 1n)).rejects.toThrow(/address/);
  });
});

describe('loadRegistration', () => {
  const REG = { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'a' };
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
  const PUBLIC = ['93.184.216.34'];
  const opts = { resolveHost: async () => PUBLIC };
  const none = fakeFetch({});

  describe('data: URIs', () => {
    test.each([
      ['base64', `data:application/json;base64,${b64(REG)}`],
      ['base64 with a charset', `data:application/json;charset=utf-8;base64,${b64(REG)}`],
      ['percent-encoded', `data:application/json,${encodeURIComponent(JSON.stringify(REG))}`],
    ])('%s is decoded', async (_name, uri) => {
      expect(await loadRegistration(uri, none, opts)).toEqual(REG);
      expect(none.calls).toHaveLength(0);
    });

    test.each([
      ['a media type that is not JSON', `data:text/html;base64,${b64(REG)}`],
      ['no media type', `data:;base64,${b64(REG)}`],
      ['invalid base64', 'data:application/json;base64,!!!not-base64!!!'],
      ['JSON that does not parse', `data:application/json;base64,${Buffer.from('{"a":').toString('base64')}`],
      ['a JSON array', `data:application/json;base64,${b64([1, 2])}`],
      ['a JSON number', `data:application/json;base64,${b64(7)}`],
      ['JSON null', `data:application/json;base64,${b64(null)}`],
      ['a body over 256 KB', `data:application/json;base64,${b64({ pad: 'x'.repeat(300 * 1024) })}`],
      ['nothing after the comma', 'data:application/json;base64,'],
      ['valid base64 followed by junk that a lenient decoder would skip', `data:application/json;base64,${b64(REG)}!!!`],
      ['a percent-encoded body over 256 KB that is under the length pre-check', `data:application/json,${encodeURIComponent(JSON.stringify({ pad: 'x'.repeat(300 * 1024) }))}`],
    ])('%s is null', async (_name, uri) => {
      expect(await loadRegistration(uri, none, opts)).toBeNull();
    });
  });

  describe('ipfs:// URIs', () => {
    const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

    test('are read through the ipfs.io gateway', async () => {
      const f = fakeFetch({ [`https://ipfs.io/ipfs/${CID}`]: () => new Response(JSON.stringify(REG), { headers: { 'content-type': 'application/json' } }) });
      expect(await loadRegistration(`ipfs://${CID}`, f, opts)).toEqual(REG);
      expect(f.calls.map((c) => c.url)).toEqual([`https://ipfs.io/ipfs/${CID}`]);
    });

    test('a path inside the CID is kept', async () => {
      const f = fakeFetch({ [`https://ipfs.io/ipfs/${CID}/agent.json`]: () => new Response(JSON.stringify(REG)) });
      expect(await loadRegistration(`ipfs://${CID}/agent.json`, f, opts)).toEqual(REG);
    });

    test.each([
      ['path traversal', `ipfs://${CID}/../../etc`],
      ['an empty CID', 'ipfs://'],
      ['a leading slash', `ipfs:///${CID}`],
      ['a query string', `ipfs://${CID}?x=1`],
      ['a fragment', `ipfs://${CID}#x`],
      ['a host smuggled in', `ipfs://evil.example@${CID}`],
      ['a scheme-relative escape', `ipfs://${CID}/%2e%2e/x`],
    ])('%s is null and nothing is fetched', async (_name, uri) => {
      const f = fakeFetch({});
      expect(await loadRegistration(uri, f, opts)).toBeNull();
      expect(f.calls).toHaveLength(0);
    });
  });

  describe('https:// URIs', () => {
    const URL_A = 'https://agent.example/registration.json';
    const answer = (res: () => Response | Promise<Response>) => fakeFetch({ [URL_A]: res });

    test('are fetched with an identifying user agent and parsed', async () => {
      const f = answer(() => new Response(JSON.stringify(REG)));
      expect(await loadRegistration(URL_A, f, opts)).toEqual(REG);
      expect(f.calls[0]).toMatchObject({ method: 'GET' });
      expect(f.calls[0]!.headers['user-agent']).toBe(RAILWALKER_USER_AGENT);
    });

    test.each([
      ['http', 'http://agent.example/registration.json'],
      ['file', 'file:///etc/passwd'],
      ['ftp', 'ftp://agent.example/x'],
      ['javascript', 'javascript:alert(1)'],
      ['an IP literal', 'https://127.0.0.1/x'],
      ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data'],
      ['credentials', 'https://user:pw@agent.example/x'],
      ['localhost', 'https://localhost/x'],
      ['a non-443 port', 'https://agent.example:8443/x'],
      ['garbage', 'not a uri'],
      ['an empty string', ''],
    ])('%s is null and nothing is fetched', async (_name, uri) => {
      const f = fakeFetch({});
      expect(await loadRegistration(uri, f, opts)).toBeNull();
      expect(f.calls).toHaveLength(0);
    });

    test('a host that resolves to a private address is null and nothing is fetched', async () => {
      const f = answer(() => new Response(JSON.stringify(REG)));
      expect(await loadRegistration(URL_A, f, { resolveHost: async () => ['10.0.0.5'] })).toBeNull();
      expect(await loadRegistration(URL_A, f, { resolveHost: async () => ['93.184.216.34', '169.254.169.254'] })).toBeNull();
      expect(await loadRegistration(URL_A, f, { resolveHost: async () => [] })).toBeNull();
      expect(await loadRegistration(URL_A, f, { resolveHost: async () => { throw new Error('ENOTFOUND'); } })).toBeNull();
      expect(f.calls).toHaveLength(0);
    });

    test('a redirect is never followed', async () => {
      const f = answer(() => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x' } }));
      expect(await loadRegistration(URL_A, f, opts)).toBeNull();
      expect(f.calls).toHaveLength(1);
    });

    test("fetch is always called with redirect 'manual' and an abort signal", async () => {
      const seen: RequestInit[] = [];
      const spy = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => (seen.push(init ?? {}), new Response(JSON.stringify(REG)))) as typeof fetch;
      await loadRegistration(URL_A, spy, opts);
      expect(seen[0]).toMatchObject({ redirect: 'manual' });
      expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
    });

    test.each([
      ['an error status', () => new Response('{"a":1}', { status: 500 })],
      ['a 404', () => new Response('nope', { status: 404 })],
      ['text that is not JSON', () => new Response('<html>hi</html>')],
      ['a JSON array', () => new Response('[1,2]')],
      ['a declared length over 256 KB', () => new Response('{}', { headers: { 'content-length': String(300 * 1024) } })],
    ])('%s is null', async (_name, res) => {
      expect(await loadRegistration(URL_A, answer(res), opts)).toBeNull();
    });

    test('a streamed body over 256 KB is null and is never read to the end', async () => {
      let pulled = 0;
      const huge = new ReadableStream<Uint8Array>(
        {
          pull(c) {
            if (pulled >= 5 * 1024 * 1024) return c.close();
            c.enqueue(new Uint8Array(64 * 1024).fill(32));
            pulled += 64 * 1024;
          },
        },
        { highWaterMark: 0 },
      );
      expect(await loadRegistration(URL_A, answer(() => new Response(huge)), opts)).toBeNull();
      expect(pulled).toBeLessThanOrEqual(256 * 1024 + 64 * 1024);
    });

    test('a server that never answers, and a body that never ends, are null at the timeout', async () => {
      const t = { ...opts, timeoutMs: 50 };
      expect(await loadRegistration(URL_A, answer(() => new Promise<Response>(() => {})), t)).toBeNull();
      const hang = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }, { highWaterMark: 0 });
      expect(await loadRegistration(URL_A, answer(() => new Response(hang)), t)).toBeNull();
    });

    test('a network error is null, never a throw', async () => {
      expect(await loadRegistration(URL_A, answer(() => { throw new TypeError('fetch failed'); }), opts)).toBeNull();
    });
  });
});
