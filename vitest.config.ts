import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@arena/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@arena/combat-sim': fileURLToPath(new URL('./services/combat-sim/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['services/**/test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
  },
});
