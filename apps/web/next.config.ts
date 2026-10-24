import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  // The workspace packages ship TypeScript source, so Next compiles them with the app.
  transpilePackages: ['@railwalker/core', '@railwalker/chain', '@railwalker/scanner', '@railwalker/fixtures', '@railwalker/data'],
  // Trace files from the monorepo root, so a deploy rooted at apps/web still finds the packages it imports.
  outputFileTracingRoot: root,
  poweredByHeader: false,
  devIndicators: false,
  // `next dev` would otherwise write an AGENTS.md into the repo; nothing here wants one.
  agentRules: false,
  reactStrictMode: true,
  // the pages were called Ledger and Methodology before the navigation named them Proof and How it works
  async redirects() {
    return [
      { source: '/ledger', destination: '/proof', permanent: false },
      { source: '/methodology', destination: '/how', permanent: false },
    ];
  },
};

export default config;
