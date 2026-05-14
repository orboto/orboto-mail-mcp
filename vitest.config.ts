import { defineConfig } from 'vitest/config';

// MCP placeholder — real tests land in OMS-11.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
