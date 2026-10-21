import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { RAILWALKER_USER_AGENT, DeadlineExceeded, createDeadline, readCapped } from '@railwalker/core';

/** Where reports, runs and summaries live. Paths are forward-slash and relative: `reports/<id>.json`. */
export interface DataStore {
  /** null when there is nothing at that path. */
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  /** Every file whose path starts with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

/** Files in flight while a write is being made. They are never listed, and no path may use the name. */
const TEMP_PREFIX = '.tmp-';
/** The store may be a git checkout (the batch runner's `data` branch). Nothing may be read or written inside .git, or listed from it. */
const GIT_DIR = '.git';

function invalid(what: string): never {
  throw new Error(`invalid data path: ${what}`);
}

/** The segments of a relative path with nothing in it that could climb out of the store or hide from a listing. */
function parsePath(path: string): string[] {
  if (typeof path !== 'string' || path === '') return invalid('it is empty');
  if (path.includes('\0')) return invalid('it contains a null byte');
  if (path.includes('\\')) return invalid('it contains a backslash');
  if (path.startsWith('/')) return invalid('it is absolute');
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '') return invalid('it has an empty segment');
    if (segment === '.' || segment === '..') return invalid('it has a dot segment');
    if (segment.startsWith(TEMP_PREFIX)) return invalid(`names starting with ${TEMP_PREFIX} are kept for temporary files`);
    if (segment.toLowerCase() === GIT_DIR) return invalid(`${GIT_DIR} is git's own folder, not data`);
  }
  return segments;
}

/** A prefix is a path that may stop part-way through a name, or after a slash. */
function checkPrefix(prefix: string): void {
  if (typeof prefix !== 'string') return invalid('the prefix is not text');
  if (prefix === '') return;
  if (prefix.includes('\0') || prefix.includes('\\') || prefix.startsWith('/')) return invalid('the prefix is not relative');
  const segments = prefix.split('/');
  segments.forEach((segment, i) => {
    if (segment === '.' || segment === '..') invalid('the prefix has a dot segment');
    if (segment === '' && i < segments.length - 1) invalid('the prefix has an empty segment');
  });
}

const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
/** Nothing there; a directory where a file was expected counts, since there is no file to read. */
const isMissing = (err: unknown): boolean => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(errorCode(err) ?? '');

/**
 * Plain files in one folder. Writes go to a temporary name and are renamed into place, so a reader never sees half a file;
 * a symbolic link anywhere under the folder is refused rather than followed out of it.
 */
export class FileDataStore implements DataStore {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async read(path: string): Promise<string | null> {
    const segments = parsePath(path);
    if (!(await this.walk(segments))) return null;
    try {
      return await readFile(join(this.root, ...segments), 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const segments = parsePath(path);
    await this.walk(segments); // a missing tail is fine: it is created below
    const target = join(this.root, ...segments);
    await mkdir(dirname(target), { recursive: true });
    const temp = join(dirname(target), `${TEMP_PREFIX}${process.pid}-${randomUUID()}`);
    try {
      await writeFile(temp, content, 'utf8');
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    checkPrefix(prefix);
    const found: string[] = [];
    await this.collect('', prefix, found);
    return found.sort();
  }

  /** Follows `segments` down from the root, refusing a symbolic link on the way. False as soon as something does not exist. */
  private async walk(segments: string[]): Promise<boolean> {
    let current = this.root;
    for (const segment of segments) {
      current = join(current, segment);
      let info;
      try {
        info = await lstat(current);
      } catch (err) {
        if (isMissing(err)) return false;
        throw err;
      }
      if (info.isSymbolicLink()) return invalid('a symbolic link is not followed');
    }
    return true;
  }

  private async collect(dir: string, prefix: string, found: string[]): Promise<void> {
    const entries = await readdir(join(this.root, dir), { withFileTypes: true }).catch((err: unknown) => {
      if (isMissing(err)) return [];
      throw err;
    });
    for (const entry of entries) {
      // A symbolic link is neither a file nor a directory here (readdir does not follow it), so it is never listed or entered.
      if (entry.name.startsWith(TEMP_PREFIX) || entry.name.toLowerCase() === GIT_DIR) continue;
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        // Only go down where something beneath can still match.
        if (`${path}/`.startsWith(prefix) || prefix.startsWith(`${path}/`)) await this.collect(path, prefix, found);
      } else if (entry.isFile() && path.startsWith(prefix)) {
        found.push(path);
      }
    }
  }
}

const RAW_HOST = 'https://raw.githubusercontent.com';
const API_HOST = 'https://api.github.com';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LISTING_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

const TreeSchema = z.object({ tree: z.array(z.object({ path: z.string(), type: z.string() })), truncated: z.boolean() });

/** A public GitHub branch, read-only: what the deployed site shows of the data the batch runner commits. */
export class RawGithubStore implements DataStore {
  constructor(
    private readonly repo: string,
    private readonly branch: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const [owner, name, ...extra] = repo.split('/');
    if (!owner || !name || extra.length > 0 || !OWNER.test(owner) || !REPO_NAME.test(name) || name === '.' || name === '..') {
      throw new Error('invalid repo: expected owner/name');
    }
    if (!BRANCH.test(branch) || branch.includes('..')) throw new Error('invalid branch name');
  }

  async read(path: string): Promise<string | null> {
    const segments = parsePath(path);
    const url = `${RAW_HOST}/${this.repo}/${encodeURIComponent(this.branch)}/${segments.map(encodeURIComponent).join('/')}`;
    const res = await this.get(url, MAX_FILE_BYTES, {});
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) throw new Error(`GitHub answered ${res.status} for ${path}`);
    return res.text;
  }

  async write(_path: string, _content: string): Promise<void> {
    throw new Error('RawGithubStore is read-only');
  }

  async list(prefix: string): Promise<string[]> {
    checkPrefix(prefix);
    const url = `${API_HOST}/repos/${this.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`;
    const res = await this.get(url, MAX_LISTING_BYTES, { accept: 'application/vnd.github+json', 'user-agent': RAILWALKER_USER_AGENT });
    if (res.status !== 200) throw new Error(`GitHub answered ${res.status} listing ${this.repo}`);

    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error('GitHub sent a listing that is not JSON');
    }
    const tree = TreeSchema.safeParse(json);
    if (!tree.success) throw new Error('GitHub sent a listing in a shape nobody expected');
    // A short list that looks complete is worse than an error: the batch runner would rebuild what it thinks is missing.
    if (tree.data.truncated) throw new Error(`GitHub truncated the listing of ${this.repo}: too many files`);
    return tree.data.tree
      .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
      .map((entry) => entry.path)
      .sort();
  }

  /** One GET with one deadline. A redirect is an answer to report, never a place to go. */
  private async get(url: string, cap: number, headers: Record<string, string>): Promise<{ status: number; text: string }> {
    const deadline = createDeadline(TIMEOUT_MS);
    try {
      const res = await deadline.race(this.fetchImpl(url, { redirect: 'manual', signal: deadline.signal, headers }));
      if (res.status < 200 || res.status >= 300) {
        res.body?.cancel().catch(() => {});
        return { status: res.status, text: '' };
      }
      const body = await readCapped(res, cap, deadline, 'refuse');
      if (!body.ok) throw new Error(`GitHub sent more than ${cap} bytes: too large to read`);
      return { status: res.status, text: body.text };
    } catch (err) {
      if (err instanceof DeadlineExceeded) throw new Error('GitHub did not answer in time');
      throw err;
    } finally {
      deadline.clear();
    }
  }
}
