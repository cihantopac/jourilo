import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        extends: true,
        test: { name: 'browser', include: ['tests/browser/**/*.test.ts'], fileParallelism: false },
      },
    ],
  },
});
