import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fakeFetch } from '@railwalker/testkit';
import { getData } from '../lib/data';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'railwalker-web-data-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('getData', () => {
  test('in development, DATA_DIR names a folder, and what is in it is what is read', async () => {
    await mkdir(join(dir, 'runs'));
    await writeFile(join(dir, 'summary.json'), '{"x":1}');
    const store = getData({ DATA_DIR: dir });
    expect(await store.read('summary.json')).toBe('{"x":1}');
    expect(await store.read('nothing.json')).toBeNull();
    expect(await store.list('')).toEqual(['summary.json']);
  });

  test('without DATA_DIR it reads the public data branch of the repo, from raw.githubusercontent.com', async () => {
    const f = fakeFetch({ 'https://raw.githubusercontent.com/JemIIahh/railwalker/data/summary.json': () => new Response('{"ok":true}') });
    expect(await getData({}, f).read('summary.json')).toBe('{"ok":true}');
    expect(f.calls).toHaveLength(1);
  });

  test('an empty DATA_DIR is no DATA_DIR: a blank line in an env file must not point the site at the current folder', async () => {
    const f = fakeFetch({ 'https://raw.githubusercontent.com/JemIIahh/railwalker/data/map.json': () => new Response('[]') });
    expect(await getData({ DATA_DIR: '' }, f).read('map.json')).toBe('[]');
  });

  test('the repo and the branch can be changed, for a fork or a trial', async () => {
    const f = fakeFetch({ 'https://raw.githubusercontent.com/someone/else/trial/map.json': () => new Response('[1]') });
    expect(await getData({ RAILWALKER_DATA_REPO: 'someone/else', RAILWALKER_DATA_BRANCH: 'trial' }, f).read('map.json')).toBe('[1]');
  });

  test('empty overrides are ignored, and a repo that is not owner/name is refused at once', () => {
    expect(() => getData({ RAILWALKER_DATA_REPO: '', RAILWALKER_DATA_BRANCH: '' }, fakeFetch({}))).not.toThrow();
    expect(() => getData({ RAILWALKER_DATA_REPO: 'nonsense' }, fakeFetch({}))).toThrow(/repo/);
    expect(() => getData({ RAILWALKER_DATA_BRANCH: '../main' }, fakeFetch({}))).toThrow(/branch/);
  });

  test('DATA_DIR is resolved, so a relative one means relative to where the server runs', async () => {
    const store = getData({ DATA_DIR: join(dir, '.', 'runs', '..') });
    await writeFile(join(dir, 'a.json'), '1');
    expect(await store.read('a.json')).toBe('1');
  });
});
