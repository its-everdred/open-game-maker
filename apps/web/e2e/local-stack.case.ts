import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    [
      resolve('node_modules/vite/bin/vite.js'),
      'preview',
      '--config',
      'system.vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      '43179',
      '--strictPort',
    ],
    { cwd: process.cwd(), env: { ...env, OGM_API_PORT: new URL(apiOrigin).port }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    let output = '';
    let failure: Error | undefined;
    child.once('error', (error) => {
      failure = error;
    });
    child.once('exit', (code) => {
      failure = new Error(`web server exited (${code})`);
    });
    const onOutput = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout!.on('data', onOutput);
    child.stderr!.on('data', onOutput);
    try {
      await expect
        .poll(
          async () => {
            if (failure) throw failure;
            try {
              return (await fetch(webOrigin)).ok;
            } catch {
              return false;
            }
          },
          { timeout: 120_000, message: 'web server did not start' },
        )
        .toBe(true);
    } catch (error) {
      throw new Error(`web server did not start: ${output.slice(-1000)}`, { cause: error });
    }
    return child;
  } catch (error) {
    child.kill();
    throw error;
  }
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`real local API and web admit New Game at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const root = mkdtempSync(join(tmpdir(), 'ogm-local-stack-'));
    let instance: ReturnType<typeof createLocalInstance> | undefined;
    let api: Awaited<ReturnType<typeof startLocalApi>> | undefined;
    let web: ChildProcess | undefined;
    try {
      instance = createLocalInstance();
      let draftId = '';
      const delivered: string[] = [];
      const scopeMessage = 'A small forest game with a helpful owl.';
      const agreed = JSON.parse(
        readFileSync(new URL('../../../packages/contracts/fixtures/scope/agreed.json', import.meta.url), 'utf8'),
      ) as Record<string, unknown>;
      api = await startLocalApi(root, {
        repoProvisioner: localProvisioner(instance.checkout, instance.bare),
        aiurClientFor: () => ({
          async message(ticket, text) {
            if (ticket !== '42') throw new Error('unexpected scope ticket');
            delivered.push(text);
            return { request_id: 'system-test' };
          },
          async progress() {
            throw new Error('unexpected progress request');
          },
          async decisions() {
            throw new Error('unexpected decisions request');
          },
          async decision() {
            throw new Error('unexpected decision request');
          },
          async decide() {
            throw new Error('unexpected decide request');
          },
        }),
        draftScopeAssistant: {
          async create(input) {
            draftId = input.draftId;
            return { repo: 'instance/games', ticket: '42' };
          },
          async close() {},
          async transcript() {
            const hasMessage = delivered.includes(scopeMessage);
            return [
              {
                body: hasMessage
                  ? `Agreed.\n\`\`\`ogm-scope\n${JSON.stringify({ ...agreed, session_id: draftId })}\n\`\`\``
                  : 'Tell me about the game.',
                turn_id: hasMessage ? 'agreed' : 'initial',
              },
            ];
          },
        },
      });
      web = await startWeb(api.origin);
      const context = await browser.newContext({
        viewport,
        hasTouch: true,
        reducedMotion: 'reduce',
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
        const tap = async (name: string) => {
          const button = page.getByRole('button', { name, exact: true });
          await expect(button).toBeVisible({ timeout: 90_000 });
          await button.scrollIntoViewIfNeeded();
          await button.tap();
        };
        await tap('Adventure');
        await tap('Next');
        await tap('Cozy');
        await tap('Next');
        await tap('Pixel art');
        await tap('SmallScaleInt');
        await tap('Select SmallScaleInt');
        await tap('Next');
        await expect(page.getByRole('heading', { name: 'World' })).toBeVisible();
        await tap('Forest');
        await tap('Next');
        await tap('Solo');
        await tap('Next');
        const message = page.getByRole('textbox', { name: 'Message the builder' });
        await expect(message).toBeVisible({ timeout: 90_000 });
        await message.fill(scopeMessage);
        const sent = page.waitForResponse(
          (response) => response.url().includes('/chat') && response.request().method() === 'POST',
        );
        await tap('Send');
        expect((await sent).status()).toBe(201);
        await expect(page.getByText(scopeMessage)).toBeVisible();
        await expect.poll(() => delivered).toContain(scopeMessage);
        await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled({ timeout: 90_000 });
        const admission = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/jobs' && response.request().method() === 'POST',
        );
        await tap('Finish');
        const admitted = await admission;
        expect(admitted.status()).toBe(202);
        const { jobId } = (await admitted.json()) as { jobId: string };
        const job = api.deps.sqlite.prepare('SELECT game_id, kind FROM jobs WHERE id = ?').get(jobId) as {
          game_id: string;
          kind: string;
        };
        expect(job.kind).toBe('new_game');
        const game = api.deps.sqlite.prepare('SELECT slug FROM games WHERE id = ?').get(job.game_id) as {
          slug: string;
        };
        expect(
          execFileSync('git', ['--git-dir', instance.bare, 'show', `main:games/${game.slug}/package.json`], {
            encoding: 'utf8',
          }),
        ).toContain('name');
      } finally {
        await context.close();
      }
    } finally {
      if (web && web.exitCode === null && web.signalCode === null) {
        const closed = new Promise<void>((done) => web!.once('close', () => done()));
        web.kill();
        await closed;
      }
      try {
        await api?.close();
      } finally {
        try {
          instance?.cleanup();
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
    expect(existsSync(root)).toBe(false);
    expect(instance && existsSync(instance.root)).toBe(false);
  });
}
