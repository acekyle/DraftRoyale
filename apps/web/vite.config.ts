import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@arena/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      '@arena/combat-sim': fileURLToPath(new URL('../../services/combat-sim/src/index.ts', import.meta.url)),
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
