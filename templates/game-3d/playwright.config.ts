import { defineConfig } from '@playwright/test';

const software = process.env.GM_VERIFY_SOFTWARE_GL === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:23173',
    launchOptions: {
      args: software
        ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    // CI builds every workspace package just before browser tests; locally, rebuild the
    // template's workspace dependencies so a stale dist/ from another branch is not bundled.
    command: `${process.env.CI ? '' : "pnpm --filter '@gm/template-game-3d^...' run build && "}pnpm exec tsc --noEmit && pnpm exec vite build --mode test && pnpm preview`,
    url: 'http://127.0.0.1:23173',
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
