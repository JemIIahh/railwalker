import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCli } from './cli';
import { realDeps } from './deps';

// `pnpm --filter … start` runs this with the package folder as its working directory, and INIT_CWD is where the command was typed.
// The .env file, data/ and any --record folder all belong to the second one.
const cwd = process.env.INIT_CWD || process.cwd();

// Variables already set in the real environment win: loadEnvFile never overrides them.
const envFile = resolve(cwd, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.exitCode = await runCli(process.argv.slice(2), realDeps(process.env, cwd));
