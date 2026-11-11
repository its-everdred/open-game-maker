import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { launchArgs } from './support/gpu';

// This config is invoked only by gm capture shell; all paths come from that command.
// eslint-disable-next-line no-restricted-properties
const env = process.env;
const origin = `http://127.0.0.1:${env.GM_SHELL_PORT}`;
export default defineConfig({
  testDir: '.',
  testMatch: 'shell-capture.case.ts',
  workers: 1,
  timeout: 150_000,
  use: { baseURL: origin, launchOptions: { args: launchArgs() } },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command:
      'pnpm exec vite preview --outDir "$GM_SHELL_WEB_DIST" --host 127.0.0.1 --port "$GM_SHELL_PORT" --strictPort',
    url: origin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
