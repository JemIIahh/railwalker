import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeFetch } from '@railwalker/testkit';
import { FileDataStore, RawGithubStore } from '../src';

describe('FileDataStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'railwalker-data-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test('writes and reads back, creating folders as needed', async () => {
    const s = new FileDataStore(dir);
    await s.write('reports/a.json', '{"a":1}');
    expect(await s.read('reports/a.json')).toBe('{"a":1}');
    await s.write('deep/er/still/x.json', 'x');
    expect(await s.read('deep/er/still/x.json')).toBe('x');
  });

  test('a file that is not there is null, not an error', async () => {
    expect(await new FileDataStore(dir).read('nothing.json')).toBeNull();
    expect(await new FileDataStore(dir).read('no/such/dir/x.json')).toBeNull();
  });

  test('overwrites, and leaves no temporary file behind', async () => {
    const s = new FileDataStore(dir);
    await s.write('a.json', 'one');
    await s.write('a.json', 'two');
    expect(await s.read('a.json')).toBe('two');
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  test('keeps text exactly, including non-ASCII', async () => {
    const s = new FileDataStore(dir);
    await s.write('t.txt', 'Cuenta: ¿cuánto? 🐦\n');
    expect(await s.read('t.txt')).toBe('Cuenta: ¿cuánto? 🐦\n');
  });

  test('lists by prefix, sorted, as relative posix paths, folders included', async () => {
    const s = new FileDataStore(dir);
    for (const p of ['runs/b.json', 'runs/a.json', 'reports/x.json', 'runs/sub/c.json', 'summary.json']) await s.write(p, '{}');
    expect(await s.list('runs/')).toEqual(['runs/a.json', 'runs/b.json', 'runs/sub/c.json']);
    expect(await s.list('reports/')).toEqual(['reports/x.json']);
    expect(await s.list('')).toEqual(['reports/x.json', 'runs/a.json', 'runs/b.json', 'runs/sub/c.json', 'summary.json']);
    expect(await s.list('runs/a')).toEqual(['runs/a.json']);
    expect(await s.list('nothing/')).toEqual([]);
  });

  test('an empty or missing store lists nothing', async () => {
    expect(await new FileDataStore(join(dir, 'not-created-yet')).list('')).toEqual([]);
  });

  test('listing ignores in-flight temporary files', async () => {
    const s = new FileDataStore(dir);
    await s.write('a.json', '{}');
    await mkdir(join(dir, 'runs'));
    await writeFile(join(dir, 'runs', '.tmp-123-b.json'), 'half');
    expect(await s.list('')).toEqual(['a.json']);
  });

  // The reason is checked as well as the refusal: two rules that both catch an input would otherwise hide a missing one.
  test.each([
    ['a parent folder', '../outside.json', /dot segment/],
    ['a parent folder in the middle', 'a/../../outside.json', /dot segment/],
    ['an absolute path', '/etc/passwd', /absolute/],
    ['a backslash path', '..\\outside.json', /backslash/],
    ['a null byte', 'a\0b.json', /null byte/],
    ['an empty path', '', /is empty/],
    ['a path that is just a folder separator', '/', /absolute/],
    ['a dot segment', './a.json', /dot segment/],
    ['a doubled separator', 'a//b.json', /empty segment/],
    ['a trailing separator', 'runs/', /empty segment/],
  ])('refuses %s, for reads and writes', async (_name, path, why) => {
    const s = new FileDataStore(dir);
    await expect(s.read(path)).rejects.toThrow(why);
    await expect(s.write(path, 'x')).rejects.toThrow(why);
  });

  test('a prefix cannot escape either', async () => {
    await expect(new FileDataStore(dir).list('../')).rejects.toThrow(/path/);
  });

  test('a symbolic link inside the store that points outside is not followed', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'railwalker-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'SECRET');
      const { symlink } = await import('node:fs/promises');
      await symlink(outside, join(dir, 'link'));
      const s = new FileDataStore(dir);
      await expect(s.read('link/secret.txt')).rejects.toThrow(/path/);
      await expect(s.write('link/new.txt', 'x')).rejects.toThrow(/path/);
      expect(await s.list('')).not.toContain('link/secret.txt');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('RawGithubStore', () => {
  const BASE = 'https://raw.githubusercontent.com/JemIIahh/railwalker/data';

  test('reads from the exact raw URL of the repo, branch and path', async () => {
    const f = fakeFetch({ [`${BASE}/reports/a.json`]: () => new Response('{"a":1}') });
    expect(await new RawGithubStore('JemIIahh/railwalker', 'data', f).read('reports/a.json')).toBe('{"a":1}');
    expect(f.calls.map((c) => c.url)).toEqual([`${BASE}/reports/a.json`]);
  });

  test('path segments are encoded', async () => {
    const f = fakeFetch({ [`${BASE}/runs/a%20b%23c.json`]: () => new Response('ok') });
    expect(await new RawGithubStore('JemIIahh/railwalker', 'data', f).read('runs/a b#c.json')).toBe('ok');
  });

  test('a 404 is null; any other failure is an error', async () => {
    const f = fakeFetch({ [`${BASE}/missing.json`]: () => new Response('nope', { status: 404 }), [`${BASE}/broken.json`]: () => new Response('x', { status: 500 }) });
    const s = new RawGithubStore('JemIIahh/railwalker', 'data', f);
    expect(await s.read('missing.json')).toBeNull();
    await expect(s.read('broken.json')).rejects.toThrow(/500/);
  });

  test('is read-only: writing throws', async () => {
    await expect(new RawGithubStore('JemIIahh/railwalker', 'data', fakeFetch({})).write('a.json', 'x')).rejects.toThrow(/read-only/);
  });

  test('a body over the size cap is refused rather than buffered', async () => {
    const f = fakeFetch({ [`${BASE}/big.json`]: () => new Response('x'.repeat(6 * 1024 * 1024)) });
    await expect(new RawGithubStore('JemIIahh/railwalker', 'data', f).read('big.json')).rejects.toThrow(/too large/);
  });

  test('lists the files of the branch by prefix, through the git trees API', async () => {
    const tree = { tree: [{ path: 'runs/a.json', type: 'blob' }, { path: 'runs', type: 'tree' }, { path: 'runs/sub/c.json', type: 'blob' }, { path: 'reports/x.json', type: 'blob' }, { path: 'summary.json', type: 'blob' }], truncated: false };
    const f = fakeFetch({ 'https://api.github.com/repos/JemIIahh/railwalker/git/trees/data?recursive=1': () => Response.json(tree) });
    const s = new RawGithubStore('JemIIahh/railwalker', 'data', f);
    expect(await s.list('runs/')).toEqual(['runs/a.json', 'runs/sub/c.json']);
    expect(await s.list('')).toEqual(['reports/x.json', 'runs/a.json', 'runs/sub/c.json', 'summary.json']);
  });

  test('a listing GitHub had to truncate is an error, not a silently short list', async () => {
    const f = fakeFetch({ 'https://api.github.com/repos/JemIIahh/railwalker/git/trees/data?recursive=1': () => Response.json({ tree: [], truncated: true }) });
    await expect(new RawGithubStore('JemIIahh/railwalker', 'data', f).list('')).rejects.toThrow(/truncated/);
  });

  test('a listing that fails is an error', async () => {
    const f = fakeFetch({ 'https://api.github.com/repos/JemIIahh/railwalker/git/trees/data?recursive=1': () => new Response('rate limited', { status: 403 }) });
    await expect(new RawGithubStore('JemIIahh/railwalker', 'data', f).list('')).rejects.toThrow(/403/);
  });

  test.each([
    ['a repo that is not owner/name', 'railwalker', 'data'],
    ['a repo with a path in it', 'JemIIahh/railwalker/extra', 'data'],
    ['a repo with a query', 'JemIIahh/rail?walker', 'data'],
    ['a branch with a parent folder', 'JemIIahh/railwalker', '../main'],
    ['a branch with a space', 'JemIIahh/railwalker', 'da ta'],
    ['an empty branch', 'JemIIahh/railwalker', ''],
  ])('refuses %s at construction', (_name, repo, branch) => {
    expect(() => new RawGithubStore(repo, branch, fakeFetch({}))).toThrow(/repo|branch/);
  });

  test('refuses paths that escape: no parent folders, no absolute paths, nothing that changes the URL', async () => {
    const s = new RawGithubStore('JemIIahh/railwalker', 'data', fakeFetch({}));
    for (const p of ['../x', 'a/../b', '/etc', '', 'a\0b']) await expect(s.read(p), p).rejects.toThrow(/path/);
  });

  test('never follows a redirect', async () => {
    const seen: RequestInit[] = [];
    const spy = (async (_i: Parameters<typeof fetch>[0], init?: RequestInit) => (seen.push(init ?? {}), new Response('{}'))) as typeof fetch;
    await new RawGithubStore('JemIIahh/railwalker', 'data', spy).read('a.json');
    expect(seen[0]).toMatchObject({ redirect: 'manual' });
  });
});

describe('FileDataStore: names it keeps for itself', () => {
  test('a path that looks like one of its temporary files is refused, so nothing can be written that a listing would hide', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'railwalker-data-'));
    try {
      const s = new FileDataStore(dir);
      await expect(s.write('runs/.tmp-1-a.json', 'x')).rejects.toThrow(/path/);
      await expect(s.write('.tmp-x/a.json', 'x')).rejects.toThrow(/path/);
      await expect(s.read('.tmp-1-a.json')).rejects.toThrow(/path/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('RawGithubStore: a GitHub that goes quiet', () => {
  afterEach(() => vi.useRealTimers());
  const signals: AbortSignal[] = [];
  beforeEach(() => {
    signals.length = 0;
  });
  const silent = ((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  test('a read is an error once the deadline passes, not a hang, and the connection is let go', async () => {
    vi.useFakeTimers();
    const settled = expect(new RawGithubStore('JemIIahh/railwalker', 'data', silent).read('a.json')).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(signals[0]?.aborted).toBe(true);
  });

  test('so is a listing', async () => {
    vi.useFakeTimers();
    const settled = expect(new RawGithubStore('JemIIahh/railwalker', 'data', silent).list('')).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('FileDataStore: writes', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'railwalker-data-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test('a reader never sees half a file: while a large write is in progress the path holds the old content or the new, nothing between', async () => {
    const s = new FileDataStore(dir);
    const before = 'old';
    const after = 'n'.repeat(40_000_000);
    await s.write('state.json', before);
    let writing = true;
    const write = s.write('state.json', after).finally(() => (writing = false));
    const torn: (number | null)[] = [];
    for (let i = 0; writing && i < 100_000; i++) {
      const text = await s.read('state.json');
      if (text !== before && text !== after) torn.push(text === null ? null : text.length);
    }
    await write;
    expect(torn).toEqual([]);
    expect(await s.read('state.json')).toBe(after);
  });

  test('a folder is not a file: reading it gives null', async () => {
    const s = new FileDataStore(dir);
    await s.write('runs/a.json', '{}');
    expect(await s.read('runs')).toBeNull();
  });

  test('lists in sorted order however many files there are, whatever order the disk keeps them in', async () => {
    const s = new FileDataStore(dir);
    const names = Array.from({ length: 40 }, (_, i) => `f-${(i * 7919) % 101}.json`); // scrambled, all different
    for (const name of names) await s.write(`runs/${name}`, '{}');
    const listed = await s.list('runs/');
    expect(listed).toHaveLength(40);
    expect(listed).toEqual([...listed].sort());
  });

  test('the store may be a git checkout: .git is never listed, read or written, in any spelling or place', async () => {
    const s = new FileDataStore(dir);
    await mkdir(join(dir, '.git', 'objects'), { recursive: true });
    await writeFile(join(dir, '.git', 'config'), 'x');
    await writeFile(join(dir, '.git', 'objects', 'ab'), 'x');
    await s.write('a.json', '{}');
    await s.write('.gitkeep', ''); // other names that start with .git are ordinary files
    expect(await s.list('')).toEqual(['.gitkeep', 'a.json']);
    for (const path of ['.git/config', '.git/hooks/pre-commit', '.GIT/config', 'runs/.git/x', '.git']) {
      await expect(s.read(path), path).rejects.toThrow(/\.git/);
      await expect(s.write(path, 'x'), path).rejects.toThrow(/\.git/);
    }
    expect(await readdir(join(dir, '.git'))).toEqual(['config', 'objects']); // untouched
  });

  test('a write that fails leaves nothing behind, and what was there before is untouched', async () => {
    const s = new FileDataStore(dir);
    await s.write('dir/x.json', '1');
    await expect(s.write('dir', 'y')).rejects.toThrow(); // a folder is in the way
    expect(await readdir(dir)).toEqual(['dir']);
    expect(await s.read('dir/x.json')).toBe('1');
  });

  test.each([
    ['a parent folder', '../', /dot segment/],
    ['a parent folder after a name', 'runs/../', /dot segment/],
    ['a doubled separator', 'a//b', /empty segment/],
    ['an absolute prefix', '/runs', /not relative/],
    ['a backslash', 'runs\\a', /not relative/],
    ['a null byte', 'a\0', /not relative/],
  ])('a listing prefix with %s is refused', async (_name, prefix, why) => {
    await expect(new FileDataStore(dir).list(prefix)).rejects.toThrow(why);
  });
});

describe('RawGithubStore: what GitHub sends back', () => {
  const BASE = 'https://raw.githubusercontent.com/JemIIahh/railwalker/data';
  const TREE = 'https://api.github.com/repos/JemIIahh/railwalker/git/trees/data?recursive=1';
  const store = (f: typeof fetch) => new RawGithubStore('JemIIahh/railwalker', 'data', f);

  test('a redirect is an answer to report, not a place to go', async () => {
    const f = fakeFetch({ [`${BASE}/moved.json`]: () => new Response('', { status: 302, headers: { location: 'https://elsewhere.example/x' } }) });
    await expect(store(f).read('moved.json')).rejects.toThrow(/302/);
    expect(f.calls).toHaveLength(1);
  });

  test('a listing that is not JSON is an error', async () => {
    await expect(store(fakeFetch({ [TREE]: () => new Response('<html>not json</html>') })).list('')).rejects.toThrow(/not JSON/);
  });

  test.each([
    ['a tree that is not a list', { tree: 'nope', truncated: false }],
    ['no word on whether it was truncated', { tree: [] }],
    ['entries without a path', { tree: [{ type: 'blob' }], truncated: false }],
  ])('a listing with %s is an error, not an empty list', async (_name, body) => {
    await expect(store(fakeFetch({ [TREE]: () => Response.json(body) })).list('')).rejects.toThrow(/shape/);
  });

  test('the listing request identifies itself, because GitHub refuses anonymous clients', async () => {
    const seen: unknown[] = [];
    const spy = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => (seen.push(init?.headers), Response.json({ tree: [], truncated: false }))) as typeof fetch;
    await store(spy).list('');
    expect(seen[0]).toMatchObject({ 'user-agent': expect.stringContaining('Railwalker'), accept: 'application/vnd.github+json' });
  });

  test('a listing prefix that climbs is refused', async () => {
    await expect(store(fakeFetch({})).list('../')).rejects.toThrow(/dot segment/);
  });

  test('no timer is left running once there is an answer', async () => {
    vi.useFakeTimers();
    try {
      const s = store(fakeFetch({ [`${BASE}/a.json`]: () => new Response('{}'), [TREE]: () => Response.json({ tree: [], truncated: false }) }));
      await s.read('a.json');
      await s.list('');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ['an owner that climbs', '../railwalker', 'data'],
    ['an owner with a dot in it', 'Jem.IIahh/railwalker', 'data'],
    ['a repo name that climbs', 'JemIIahh/..', 'data'],
    ['a repo name that is a dot', 'JemIIahh/.', 'data'],
    ['a branch with a doubled dot', 'JemIIahh/railwalker', 'da..ta'],
    ['a branch that starts with a dot', 'JemIIahh/railwalker', '.hidden'],
    ['a branch with a slash', 'JemIIahh/railwalker', 'feature/x'],
  ])('refuses %s, because it would change which URL is read', (_name, repo, branch) => {
    expect(() => new RawGithubStore(repo, branch, fakeFetch({}))).toThrow(/repo|branch/);
  });
});
