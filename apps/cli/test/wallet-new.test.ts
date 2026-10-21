import { describe, expect, test } from 'vitest';
import { privateKeyToAddress } from 'viem/accounts';
import { ADDRESS, KEY, OTHER_KEY, harness } from './harness';

const ENV_PATH = '/work/.env';
const KEY_LINE = `AGENT_PRIVATE_KEY=${KEY}`;
/** Anything that looks like a 32-byte secret: a leak of any key, not only this one. */
const LOOKS_LIKE_A_KEY = /[0-9a-f]{64}/i;

describe('wallet:new', () => {
  test('writes AGENT_PRIVATE_KEY=0x + 64 hex to .env when there is none, and prints the address only', async () => {
    const h = harness({ env: {} });
    expect(await h.run('wallet:new')).toBe(0);

    expect(h.files.get(ENV_PATH)!.data).toBe(`${KEY_LINE}\n`);
    expect(h.files.get(ENV_PATH)!.data).toMatch(/^AGENT_PRIVATE_KEY=0x[0-9a-f]{64}\n$/);
    expect(h.out()).toContain(ADDRESS);
  });

  test('the key never appears in anything printed, with or without the 0x', async () => {
    const h = harness({ env: {} });
    await h.run('wallet:new');
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(KEY.slice(2));
    expect(h.all()).not.toMatch(LOOKS_LIKE_A_KEY);
  });

  test('the file is private to the owner: mode 0600', async () => {
    const h = harness({ env: {} });
    await h.run('wallet:new');
    expect(h.files.get(ENV_PATH)!.mode).toBe(0o600);
  });

  test('the address printed is the one the key controls', async () => {
    const h = harness({ env: {}, generateKey: () => OTHER_KEY });
    await h.run('wallet:new');
    expect(h.out()).toContain(privateKeyToAddress(OTHER_KEY));
    expect(h.out()).not.toContain(ADDRESS);
    expect(h.files.get(ENV_PATH)!.data).toBe(`AGENT_PRIVATE_KEY=${OTHER_KEY}\n`);
  });

  test('appends to an existing .env that has no key, and leaves every other line alone', async () => {
    const h = harness({ env: {}, files: { [ENV_PATH]: 'RAILWALKER_NETWORK=sepolia\nSELLER_SALT=hush\n' } });
    expect(await h.run('wallet:new')).toBe(0);
    expect(h.files.get(ENV_PATH)!.data).toBe(`RAILWALKER_NETWORK=sepolia\nSELLER_SALT=hush\n${KEY_LINE}\n`);
  });

  test('appends on its own line when the file does not end in a newline', async () => {
    const h = harness({ env: {}, files: { [ENV_PATH]: 'RAILWALKER_NETWORK=sepolia' } });
    await h.run('wallet:new');
    expect(h.files.get(ENV_PATH)!.data).toBe(`RAILWALKER_NETWORK=sepolia\n${KEY_LINE}\n`);
  });

  test('fills the blank AGENT_PRIVATE_KEY= line that .env.example leaves, in place', async () => {
    const h = harness({ env: {}, files: { [ENV_PATH]: '# keys\nAGENT_PRIVATE_KEY=\nRAILWALKER_AGENT_ID=\n' } });
    expect(await h.run('wallet:new')).toBe(0);
    expect(h.files.get(ENV_PATH)!.data).toBe(`# keys\n${KEY_LINE}\nRAILWALKER_AGENT_ID=\n`);
  });

  test('a commented-out key does not count as a key', async () => {
    const h = harness({ env: {}, files: { [ENV_PATH]: `# AGENT_PRIVATE_KEY=${OTHER_KEY}\n` } });
    expect(await h.run('wallet:new')).toBe(0);
    expect(h.files.get(ENV_PATH)!.data).toBe(`# AGENT_PRIVATE_KEY=${OTHER_KEY}\n${KEY_LINE}\n`);
  });

  test('refuses to overwrite a key that is already in .env: exit 3, the file untouched, the existing key never printed', async () => {
    const original = `AGENT_PRIVATE_KEY=${OTHER_KEY}\nRAILWALKER_NETWORK=mainnet\n`;
    const h = harness({ env: {}, files: { [ENV_PATH]: original } });
    expect(await h.run('wallet:new')).toBe(3);
    expect(h.files.get(ENV_PATH)!.data).toBe(original);
    expect(h.all()).toMatch(/already|overwrite/i);
    expect(h.all()).not.toContain(OTHER_KEY.slice(2));
    expect(h.all()).not.toMatch(LOOKS_LIKE_A_KEY);
  });

  test('refuses when the environment already carries a key, even if .env has none: a wallet exists', async () => {
    const h = harness({ env: { AGENT_PRIVATE_KEY: OTHER_KEY } });
    expect(await h.run('wallet:new')).toBe(3);
    expect(h.files.has(ENV_PATH)).toBe(false);
    expect(h.all()).not.toMatch(LOOKS_LIKE_A_KEY);
  });

  test('an empty AGENT_PRIVATE_KEY in the environment is not a wallet', async () => {
    const h = harness({ env: { AGENT_PRIVATE_KEY: '' } });
    expect(await h.run('wallet:new')).toBe(0);
  });

  test('arguments are a usage error: nothing is written', async () => {
    const h = harness({ env: {} });
    expect(await h.run('wallet:new', 'now')).toBe(2);
    expect(h.files.size).toBe(0);
  });

  test('a failed write is exit 1, says so, and does not leak the key in the error', async () => {
    const h = harness({
      env: {},
      fs: {
        exists: async () => false,
        readFile: async () => '',
        mkdir: async () => {},
        writeFile: async (_p, data) => {
          throw new Error(`EACCES writing ${data}`); // an fs error that quotes what it was writing
        },
      },
    });
    expect(await h.run('wallet:new')).toBe(1);
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toMatch(LOOKS_LIKE_A_KEY);
  });

  test('layer 1: an fs error that quotes the key in a form no redactor could know (base64) is still never printed', async () => {
    const h = harness({
      env: {},
      fs: {
        exists: async () => false,
        readFile: async () => '',
        mkdir: async () => {},
        writeFile: async (_p, data) => {
          throw new Error(`EACCES ${Buffer.from(data).toString('base64')}`);
        },
      },
    });
    expect(await h.run('wallet:new')).toBe(1);
    expect(h.all()).not.toContain(Buffer.from(KEY_LINE).toString('base64'));
    expect(h.all()).not.toContain('EACCES');
  });

  test('layer 2: even if the error code itself echoes the key, the redactor removes it', async () => {
    const h = harness({
      env: {},
      fs: {
        exists: async () => false,
        readFile: async () => '',
        mkdir: async () => {},
        writeFile: async () => {
          throw Object.assign(new Error('boom'), { code: KEY });
        },
      },
    });
    expect(await h.run('wallet:new')).toBe(1);
    expect(h.all()).not.toContain(KEY);
    expect(h.all()).not.toContain(KEY.slice(2));
    expect(h.all()).toContain('[redacted]');
  });

  test('says where the key went and not to share it', async () => {
    const h = harness({ env: {} });
    await h.run('wallet:new');
    expect(h.out()).toMatch(/\.env/);
    expect(h.out()).toMatch(/never|do not|don't/i);
  });
});
