import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
    // Archive and image fixtures are I/O-heavy; serial files keep unrelated command smoke tests responsive.
    maxWorkers: 1,
    // The first test in each file cold-loads every command module through the transformer.
    testTimeout: 20_000,
  },
});
