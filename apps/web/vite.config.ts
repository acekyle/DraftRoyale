import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // GitHub Pages serves from /<repo>/ — CI sets BASE_PATH=/DraftRoyale/.
  base: process.env.BASE_PATH ?? '/',
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
