import { env } from 'node:process';

import { defineConfig } from '@playwright/test';
import { launchArgs } from './e2e/support/gpu';

// Test-only Better Auth configuration, matching the API's Vitest fixture.
env.OGM_APP_ORIGIN = 'http://127.0.0.1:43179';
env.OGM_SESSION_SECRET = 'session-secret-for-tests-0123456789abcdef';
env.OGM_WS_TOKEN_SECRET = 'ws-token-secret-for-tests-0123456789';
env.OGM_ALLOWED_EMAILS = '';
env.OGM_MAINTAINER_EMAILS = '';
env.GOOGLE_CLIENT_ID = '';
env.GOOGLE_CLIENT_SECRET = '';
env.SMTP_URL = '';
env.SMTP_FROM = '';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'local-stack.case.ts',
  workers: 1,
  timeout: 300_000,
  use: { viewport: { width: 390, height: 844 }, hasTouch: true, launchOptions: { args: launchArgs() } },
});
