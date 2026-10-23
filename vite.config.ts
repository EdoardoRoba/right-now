import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // Keep the budget honest: warn well before the 60 KB gzip budget is at risk.
    chunkSizeWarningLimit: 120,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
});
