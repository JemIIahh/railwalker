import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

// The real program, spawned: the one place the real entry point, the real file system and the exit code are exercised together.
// The environment is rebuilt from nothing, so a real key in the developer's shell can never reach a test.
const TSX = resolve(import.meta.dirname, '../node_modules/.bin/tsx');
const MAIN = resolve(import.meta.dirname, '../src/main.ts');
const LOOKS_LIKE_A_KEY = /[0-9a-f]{64}/i;

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'railwalker-cli-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function railwalker(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(
      TSX,
      [MAIN, ...args],
      { cwd: opts.cwd ?? work, env: { PATH: process.env.PATH ?? '', HOME: work, ...opts.env }, timeout: 60_000 },
      (err, stdout, stderr) => done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
}

describe('the real program', () => {
  test('help: exit 0 and the commands', async () => {
    const r = await railwalker(['help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('wallet:new');
  }, 30_000);

  test('scan of a URL it refuses prints the report as JSON, the verdict on stderr, and exits 0, with no network', async () => {
    const r = await railwalker(['scan', 'https://127.0.0.1/']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).verdicts[0]).toMatchObject({ kind: 'SKIPPED', code: 'unsafe_url' });
    expect(r.stderr).toContain('SKIPPED:unsafe_url');
  }, 30_000);

  test('exit codes reach the shell: a usage error is 2, an unknown command is 2, a refusal is 3', async () => {
    expect((await railwalker(['check'])).code).toBe(2);
    expect((await railwalker(['frobnicate'])).code).toBe(2);
    expect((await railwalker(['balance'])).code).toBe(3); // no wallet configured: refused
  }, 60_000);

  test('wallet:new writes .env where the command was typed (INIT_CWD), not where the script runs, privately, and never prints the key', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'railwalker-pkg-'));
    try {
      const r = await railwalker(['wallet:new'], { cwd: elsewhere, env: { INIT_CWD: work } });
      expect(r.code).toBe(0);
      expect(existsSync(join(elsewhere, '.env'))).toBe(false);
      const envFile = join(work, '.env');
      expect(readFileSync(envFile, 'utf8')).toMatch(/^AGENT_PRIVATE_KEY=0x[0-9a-f]{64}\n$/);
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
      expect(r.stdout).toMatch(/Address: 0x[0-9a-fA-F]{40}/);
      expect(r.stdout + r.stderr).not.toMatch(LOOKS_LIKE_A_KEY);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }, 30_000);

  test('without INIT_CWD it uses the working directory, and a second wallet:new refuses (exit 3) and changes nothing', async () => {
    expect((await railwalker(['wallet:new'])).code).toBe(0);
    const before = readFileSync(join(work, '.env'), 'utf8');
    const again = await railwalker(['wallet:new']);
    expect(again.code).toBe(3);
    expect(readFileSync(join(work, '.env'), 'utf8')).toBe(before);
    expect(again.stdout + again.stderr).not.toMatch(LOOKS_LIKE_A_KEY);
  }, 60_000);

  test('.env is loaded: doctor sees the wallet wallet:new made, and reports a valid configuration', async () => {
    await railwalker(['wallet:new'], { env: { INIT_CWD: work } });
    // an RPC that cannot resolve, so the balance check fails quickly and the test needs no network
    const r = await railwalker(['doctor'], { env: { INIT_CWD: work, CELO_RPC_URL: 'https://rpc.invalid/' } });
    expect(r.stdout).toMatch(/^ok\s+config\s+valid \(sepolia, chain 11142220\)/m);
    expect(r.stdout).toMatch(/^FAIL\s+wallet/m);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).not.toMatch(LOOKS_LIKE_A_KEY);
    expect(r.stdout + r.stderr).not.toContain('rpc.invalid');
  }, 60_000);

  test('a variable already in the environment wins over .env', async () => {
    await railwalker(['wallet:new'], { env: { INIT_CWD: work } });
    const r = await railwalker(['doctor'], { env: { INIT_CWD: work, RAILWALKER_NETWORK: 'sepolia', CELO_RPC_URL: 'https://rpc.invalid/', RAILWALKER_REPO: 'someone/else' } });
    expect(r.stdout).toMatch(/repo someone\/else/);
  }, 60_000);
});
