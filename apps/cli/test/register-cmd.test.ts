import { describe, expect, test } from 'vitest';
import { CODE, KEY, MAINNET_ENV, SEPOLIA_ENV, harness } from './harness';

const ENV_PATH = '/work/.env';
const HASH = `0x${'12'.repeat(32)}`;

describe('register: consent', () => {
  test('without --yes: exit 2, says exactly what it would do, and sends nothing', async () => {
    const h = harness({ env: SEPOLIA_ENV });
    expect(await h.run('register', '--sepolia')).toBe(2);
    expect(h.calls.register).toEqual([]);
    const text = h.all();
    expect(text).toMatch(/sepolia/i);
    expect(text).toContain('0x8004A818BFB912233c491871b3d84c89A494BD9e');
    expect(text).toContain(CODE);
    expect(text).toMatch(/--yes/);
    expect(text).toMatch(/permanent/i);
  });

  test('mainnet is never the default: --mainnet must be said, even when the environment already says mainnet', async () => {
    const h = harness();
    expect(await h.run('register', '--yes')).toBe(2);
    expect(h.err()).toMatch(/--mainnet/);
    expect(h.calls.register).toEqual([]);
  });

  test('--sepolia and --mainnet together are a usage error', async () => {
    const h = harness();
    expect(await h.run('register', '--sepolia', '--mainnet', '--yes')).toBe(2);
    expect(h.err()).toMatch(/not both|only one/i);
  });

  test('an unknown --fee is a usage error', async () => {
    const h = harness();
    expect(await h.run('register', '--mainnet', '--yes', '--fee', 'DOGE')).toBe(2);
    expect(h.err()).toMatch(/--fee must be USAT, USDC or USDT/);
  });
});

describe('register: the checks it runs first (exit 3)', () => {
  test('a configuration that fails validation is refused', async () => {
    const h = harness({ env: {} });
    expect(await h.run('register', '--mainnet', '--yes')).toBe(3);
    expect(h.err()).toMatch(/AGENT_PRIVATE_KEY/);
    expect(h.calls.register).toEqual([]);
  });

  test('without an attribution code it refuses: a tag cannot be added afterwards', async () => {
    const { RAILWALKER_ATTRIBUTION_CODE: _c, ...rest } = SEPOLIA_ENV;
    const h = harness({ env: rest });
    expect(await h.run('register', '--sepolia', '--yes')).toBe(3);
    expect(h.err()).toMatch(/attribution/i);
    expect(h.calls.register).toEqual([]);
  });

  test('an agent that is already registered is refused: a second register mints a second identity', async () => {
    const h = harness({ env: { ...MAINNET_ENV, RAILWALKER_AGENT_ID: '5' } });
    expect(await h.run('register', '--mainnet', '--yes')).toBe(3);
    expect(h.err()).toMatch(/already registered/i);
    expect(h.calls.register).toEqual([]);
  });

  test('a wallet that holds nothing cannot pay for the transaction: refused', async () => {
    const h = harness({ readBalances: async () => ({ celo: 0n, USDC: 0n, USDT: 0n, USAT: 0n }) });
    expect(await h.run('register', '--mainnet', '--yes')).toBe(3);
    expect(h.err()).toMatch(/gas|balance|fund/i);
    expect(h.calls.register).toEqual([]);
  });

  test('gas can only be paid in a coin the wallet holds: --fee USDC with only USA₮ is refused, naming the coin', async () => {
    const h = harness(); // the faucet wallet holds USA₮ only
    expect(await h.run('register', '--mainnet', '--yes', '--fee', 'USDC')).toBe(3);
    expect(h.err()).toMatch(/no USDC to pay gas with/);
    expect(h.calls.register).toEqual([]);
  });

  test.each([
    ['an http --web', ['--web', 'http://railwalker.example'], /webUrl must be an https URL/],
    ['an http --mcp', ['--mcp', 'http://railwalker.example/mcp'], /mcpUrl must be an https URL/],
    ['an --image that is neither ipfs nor https', ['--image', 'data:image/png;base64,AAAA'], /image must be an ipfs:\/\/ or https URL/],
  ] as const)('%s is a usage error, and nothing is sent: a registration is permanent', async (_name, flags, message) => {
    const h = harness();
    expect(await h.run('register', '--mainnet', '--yes', ...flags)).toBe(2);
    expect(h.err()).toMatch(message);
    expect(h.calls.register).toEqual([]);
  });

  test('a balance that cannot be read stops it too (exit 1)', async () => {
    const h = harness({
      readBalances: async () => {
        throw new Error('rpc down');
      },
    });
    expect(await h.run('register', '--mainnet', '--yes')).toBe(1);
    expect(h.calls.register).toEqual([]);
  });
});

describe('register: sending', () => {
  test('registers with the default registration, paying gas in USA₮, and prints the hash, the agentId and the tag it carries', async () => {
    const h = harness();
    expect(await h.run('register', '--mainnet', '--yes')).toBe(0);
    expect(h.calls.register).toHaveLength(1);
    expect(h.calls.register[0]!.opts).toEqual({ fee: 'USAT' });
    expect(h.calls.register[0]!.meta).toMatchObject({ name: 'Railwalker', webUrl: 'https://github.com/JemIIahh/railwalker' });
    expect(h.out()).toContain(HASH);
    expect(h.out()).toMatch(/agentId\s+7/);
    expect(h.out()).toContain(CODE);
  });

  test('--fee, --web, --mcp and --image are passed through', async () => {
    const h = harness({ readBalances: async () => ({ celo: 0n, USDC: 1_000_000n, USDT: 0n, USAT: 0n }) });
    await h.run('register', '--mainnet', '--yes', '--fee', 'USDC', '--web', 'https://railwalker.example', '--mcp', 'https://railwalker.example/mcp', '--image', 'ipfs://bafyimage');
    expect(h.calls.register[0]!.opts).toEqual({ fee: 'USDC' });
    expect(h.calls.register[0]!.meta).toMatchObject({ webUrl: 'https://railwalker.example', mcpUrl: 'https://railwalker.example/mcp', image: 'ipfs://bafyimage' });
  });

  test('--sepolia overrides an environment that says mainnet', async () => {
    const h = harness();
    expect(await h.run('register', '--sepolia', '--yes')).toBe(0);
    expect(h.calls.loadConfig).toBeGreaterThan(0);
    expect((h.calls.register[0]!.cfg as { network: string }).network).toBe('sepolia');
  });

  test('--mainnet overrides an environment that says sepolia', async () => {
    const h = harness({ env: { ...MAINNET_ENV, RAILWALKER_NETWORK: 'sepolia' } });
    await h.run('register', '--mainnet', '--yes');
    expect((h.calls.register[0]!.cfg as { network: string }).network).toBe('mainnet');
  });

  test('the agentId is saved to .env so it is not lost, replacing a blank line or appending', async () => {
    const blank = harness({ files: { [ENV_PATH]: 'RAILWALKER_NETWORK=mainnet\nRAILWALKER_AGENT_ID=\n' } });
    await blank.run('register', '--mainnet', '--yes');
    expect(blank.files.get(ENV_PATH)!.data).toBe('RAILWALKER_NETWORK=mainnet\nRAILWALKER_AGENT_ID=7\n');

    const none = harness({ files: { [ENV_PATH]: 'RAILWALKER_NETWORK=mainnet\n' } });
    await none.run('register', '--mainnet', '--yes');
    expect(none.files.get(ENV_PATH)!.data).toBe('RAILWALKER_NETWORK=mainnet\nRAILWALKER_AGENT_ID=7\n');
  });

  test('with no .env to save into it says what to add instead, and still succeeds', async () => {
    const h = harness();
    expect(await h.run('register', '--mainnet', '--yes')).toBe(0);
    expect(h.out()).toMatch(/RAILWALKER_AGENT_ID=7/);
  });

  test('a tag that did not come back is called out loudly: the registration is on chain without the attribution', async () => {
    const h = harness({
      register: async () => ({ hash: HASH as `0x${string}`, agentId: 7n, tagged: null }),
    });
    expect(await h.run('register', '--mainnet', '--yes')).toBe(1);
    expect(h.all()).toMatch(/tag/i);
    expect(h.all()).toContain(HASH);
  });

  test('a failed registration is exit 1 with the reason, and no agentId is saved', async () => {
    const h = harness({
      files: { [ENV_PATH]: 'RAILWALKER_AGENT_ID=\n' },
      register: async () => {
        throw new Error('the registration transaction reverted');
      },
    });
    expect(await h.run('register', '--mainnet', '--yes')).toBe(1);
    expect(h.err()).toContain('reverted');
    expect(h.files.get(ENV_PATH)!.data).toBe('RAILWALKER_AGENT_ID=\n');
  });

  test('nothing printed contains the key', async () => {
    const h = harness();
    await h.run('register', '--mainnet', '--yes');
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(KEY.slice(2));
  });
});
