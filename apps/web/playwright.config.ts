import { defineConfig, devices } from '@playwright/test';

import { launchArgs } from './e2e/support/gpu';

// Keep CI's stable default while allowing concurrent local agent runs to choose an unused 4317x port.
// eslint-disable-next-line no-restricted-properties
const previewPort = process.env.OGM_WEB_E2E_PORT ?? '43170';
const previewOrigin = `http://127.0.0.1:${previewPort}`;
// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '10001';
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;
// eslint-disable-next-line no-restricted-properties
const prototypePort = process.env.OGM_PROTOTYPE_E2E_PORT ?? '43176';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  use: {
    baseURL: previewOrigin,
    launchOptions: { args: launchArgs() },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `VITE_GAMES_ORIGIN=${bridgeOrigin} pnpm build && node e2e/support/stage-prototype-fixture.mjs && pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
      url: previewOrigin,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `OGM_WEB_BRIDGE_PORT=${bridgePort} node e2e/support/serve-bridge-game.ts`,
      url: `${bridgeOrigin}/health`,
      reuseExistingServer: false,
    },
    {
      command: `OGM_PROTOTYPE_E2E_PORT=${prototypePort} node e2e/support/serve-prototypes.ts`,
      url: `http://127.0.0.1:${prototypePort}/health`,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: undefined },
    },
  ],
});
