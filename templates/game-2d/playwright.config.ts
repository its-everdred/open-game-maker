import { defineConfig } from '@playwright/test';
import { env } from 'node:process';

const softwareGl = env.GM_VERIFY_SOFTWARE_GL === '1';
const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:23174',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      args: [softwareGl ? '--use-angle=swiftshader' : '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'],
      ...(executablePath ? { executablePath } : {}),
    },
  },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 23174 --strictPort',
    url: 'http://127.0.0.1:23174',
    reuseExistingServer: false,
  },
});
