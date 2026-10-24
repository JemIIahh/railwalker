import { FileDataStore, RawGithubStore, type DataStore } from '@railwalker/data';

const DEFAULT_REPO = 'JemIIahh/railwalker';
const DEFAULT_BRANCH = 'data';

/**
 * Where the published data is read from: a folder in development (`DATA_DIR`), the public `data` branch of the repo in
 * production. An empty variable counts as unset, the way a blank line in an env file should.
 */
export function getData(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): DataStore {
  if (env.DATA_DIR) return new FileDataStore(env.DATA_DIR); // which resolves it, so a relative folder means relative to where the server runs
  return new RawGithubStore(env.RAILWALKER_DATA_REPO || DEFAULT_REPO, env.RAILWALKER_DATA_BRANCH || DEFAULT_BRANCH, fetchImpl);
}
