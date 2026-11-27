import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      pixelfx: fileURLToPath(new URL('../../third_party/pixelfx/src', import.meta.url)),
      // Tests mock the runtime; the alias only lets the import resolve (builds use scripts/effekseer-runtime.mjs).
      'effekseer-runtime': fileURLToPath(new URL('../../third_party/effekseer/effekseer.min.js', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
