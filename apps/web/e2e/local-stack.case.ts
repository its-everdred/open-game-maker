import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { env, execPath } from 'node:process';

import { expect, test } from '@playwright/test';

import { startLocalApi } from '../../../services/api/test/system/local-api';
import { localProvisioner } from '../../../services/api/test/system/local-provisioner';
import { installAuthRoutes } from './fixtures/auth-routes';
import { createLocalInstance } from './support/local-instance';

const webOrigin = 'http://127.0.0.1:43179';

async function startWeb(apiOrigin: string): Promise<ChildProcess> {
  const child = spawn(
    execPath,
    [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '43179', '--strictPort'],
    { cwd: process.cwd(), env: { ...env, OGM_API_PORT: new URL(apiOrigin).port }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await new Promise<void>((resolveReady, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('web server did not start')), 120_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolveReady();
      };
      child.once('error', finish);
      child.once('exit', (code) => finish(new Error(`web server exited (${code}): ${output.slice(-500)}`)));
      const onOutput = (chunk: Buffer) => {
        output += chunk.toString();
        if (/VITE .*ready in/u.test(output)) finish();
      };
      child.stdout!.on('data', onOutput);
      child.stderr!.on('data', onOutput);
    });
    return child;
  } catch (error) {
    child.kill();
    throw error;
  }
}

test('real local API and web reach New Game onboarding', async ({ browser }) => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-local-stack-'));
  let instance: ReturnType<typeof createLocalInstance> | undefined;
  let api: Awaited<ReturnType<typeof startLocalApi>> | undefined;
  let web: ChildProcess | undefined;
  try {
    instance = createLocalInstance();
    api = await startLocalApi(root, { repoProvisioner: localProvisioner(instance.checkout) });
    web = await startWeb(api.origin);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      extraHTTPHeaders: { 'x-test-user': api.userId },
    });
    try {
      const page = await context.newPage();
      await installAuthRoutes(page, { signedIn: true });
      const catalog = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/catalog/style-families',
      );
      await page.goto(`${webOrigin}/new`, { waitUntil: 'domcontentloaded' });
      expect((await catalog).status()).toBe(200);
      await expect(page.getByRole('button', { name: 'Adventure', exact: true })).toBeVisible({ timeout: 90_000 });
    } finally {
      await context.close();
    }
  } finally {
    if (web && web.exitCode === null) {
      const closed = new Promise<void>((done) => web!.once('close', () => done()));
      web.kill();
      await closed;
    }
    try {
      await api?.close();
    } finally {
      instance?.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  }
});
