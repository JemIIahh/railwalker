import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  // The workspace packages ship TypeScript source, so Next compiles them with the app.
  transpilePackages: ['@railwalker/core', '@railwalker/chain', '@railwalker/scanner', '@railwalker/fixtures'],
  // Trace files from the monorepo root, so a deploy rooted at apps/web still finds the packages it imports.
  outputFileTracingRoot: root,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
