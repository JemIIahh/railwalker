import { configDefaults, defineConfig } from 'vitest/config';

// Tests named *.live.test.ts talk to real networks; they run only when LIVE=1.
export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, ...(process.env.LIVE ? [] : ['**/*.live.test.ts'])],
  },
});
