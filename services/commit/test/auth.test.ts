import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppNotInstalledError, createGitHubApp } from '../src/auth/app.js';
import { GitHubRateLimitError } from '../src/github-request.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function privateKeyFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ogm-app-auth-'));
  temporaryDirectories.push(directory);
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const file = path.join(directory, 'app.pem');
  await writeFile(file, privateKey, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub App auth', () => {
  it('caches the owner installation and token until the five-minute refresh margin', async () => {
    let now = Date.parse('2026-11-01T00:00:00.000Z');
    let installationLists = 0;
    let tokenMints = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const target = typeof input === 'string' || input instanceof URL ? input : input.url;
      const url = new URL(target);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname === '/app/installations' && method === 'GET') {
        installationLists += 1;
        return json([
          { id: 1, account: { login: 'alice', type: 'User' } },
          { id: 2, account: { login: 'studio', type: 'Organization' } },
        ]);
      }
      if (url.pathname === '/app/installations/1/access_tokens' && method === 'POST') {
        tokenMints += 1;
        return json(
          {
            token: `installation-token-${tokenMints}`,
            expires_at: new Date(now + 60 * 60_000).toISOString(),
            permissions: {},
            repository_selection: 'all',
          },
          201,
        );
      }
      if (url.pathname === '/app' && method === 'GET') return json({ slug: 'ogm-app' });
      throw new Error(`unexpected GitHub request: ${method} ${url.pathname}`);
    };
    const app = await createGitHubApp({
      appId: '123',
      privateKeyPath: await privateKeyFile(),
      fetch: fetchImpl,
      now: () => now,
    });

    await app.forOwner('alice');
    await app.forOwner('ALICE');
    expect(installationLists).toBe(1);
    expect(tokenMints).toBe(1);
    now += 56 * 60_000;
    await app.forOwner('alice');
    expect(tokenMints).toBe(2);
    await expect(app.identity()).resolves.toEqual({
      name: 'ogm-app[bot]',
      email: 'ogm-app[bot]@users.noreply.github.com',
    });
  });

  it('keeps rate limits scoped to the affected installation', async () => {
    let aliceRequests = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const target = typeof input === 'string' || input instanceof URL ? input : input.url;
      const url = new URL(target);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname === '/app/installations')
        return json([
          { id: 1, account: { login: 'alice', type: 'User' } },
          { id: 2, account: { login: 'studio', type: 'Organization' } },
        ]);
      if (url.pathname.endsWith('/access_tokens'))
        return json(
          {
            token: `token-${url.pathname.split('/')[3]}`,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            permissions: {},
            repository_selection: 'all',
          },
          201,
        );
      if (url.pathname === '/repos/alice/game') {
        aliceRequests += 1;
        return new Response(JSON.stringify({ message: 'secondary rate limit' }), {
          status: 403,
          headers: { 'content-type': 'application/json', 'retry-after': '60' },
        });
      }
      if (url.pathname === '/repos/studio/game') return json({ name: 'game' });
      if (url.pathname === '/app') return json({ slug: 'ogm-app' });
      throw new Error(`unexpected ${method} ${url.pathname}`);
    };
    const app = await createGitHubApp({ appId: '123', privateKeyPath: await privateKeyFile(), fetch: fetchImpl });
    const alice = await app.forOwner('alice');
    const studio = await app.forOwner('studio');
    await expect(alice.request('GET /repos/{owner}/{repo}', { owner: 'alice', repo: 'game' })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );
    const aliceAgain = await app.forOwner('alice');
    await expect(
      aliceAgain.request('GET /repos/{owner}/{repo}', { owner: 'alice', repo: 'game' }),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(aliceRequests).toBe(1);
    await expect(studio.request('GET /repos/{owner}/{repo}', { owner: 'studio', repo: 'game' })).resolves.toMatchObject(
      { data: { name: 'game' } },
    );
    await expect(app.identity()).resolves.toMatchObject({ name: 'ogm-app[bot]' });
  });

  it('names an owner without an installation but never a credential', async () => {
    const fetchImpl: typeof fetch = async () => json([]);
    const app = await createGitHubApp({
      appId: '123',
      privateKeyPath: await privateKeyFile(),
      fetch: fetchImpl,
    });
    await expect(app.forOwner('missing-owner')).rejects.toEqual(new AppNotInstalledError('missing-owner'));
  });

  it('finds an owner installation after the first page', async () => {
    const pages: number[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const target = typeof input === 'string' || input instanceof URL ? input : input.url;
      const url = new URL(target);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname === '/app/installations' && method === 'GET') {
        const page = Number(url.searchParams.get('page'));
        pages.push(page);
        if (page === 1) {
          return json(
            Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              account: { login: `owner-${index + 1}`, type: 'User' },
            })),
          );
        }
        return json([{ id: 101, account: { login: 'alice', type: 'User' } }]);
      }
      if (url.pathname === '/app/installations/101/access_tokens' && method === 'POST') {
        return json(
          {
            token: 'installation-token',
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
            permissions: {},
            repository_selection: 'all',
          },
          201,
        );
      }
      throw new Error(`unexpected GitHub request: ${method} ${url.pathname}`);
    };
    const app = await createGitHubApp({
      appId: '123',
      privateKeyPath: await privateKeyFile(),
      fetch: fetchImpl,
    });

    await expect(app.forOwner('alice')).resolves.toMatchObject({ accountType: 'User' });
    expect(pages).toEqual([1, 2]);
  });

  it('honors a rate limit while resolving an installation', async () => {
    let installationLists = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const target = typeof input === 'string' || input instanceof URL ? input : input.url;
      const url = new URL(target);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname === '/app/installations' && method === 'GET') {
        installationLists += 1;
        if (installationLists === 1) {
          return new Response(JSON.stringify({ message: 'rate limited' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          });
        }
        return json([{ id: 1, account: { login: 'alice', type: 'User' } }]);
      }
      if (url.pathname === '/app/installations/1/access_tokens' && method === 'POST') {
        return json(
          {
            token: 'installation-token',
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
            permissions: {},
            repository_selection: 'all',
          },
          201,
        );
      }
      throw new Error(`unexpected GitHub request: ${method} ${url.pathname}`);
    };
    const app = await createGitHubApp({
      appId: '123',
      privateKeyPath: await privateKeyFile(),
      fetch: fetchImpl,
    });

    await expect(app.forOwner('alice')).resolves.toMatchObject({ accountType: 'User' });
    expect(installationLists).toBe(2);
  });

  it('fails closed after one App installation rate-limit retry', async () => {
    let installationLists = 0;
    const fetchImpl: typeof fetch = async () => {
      installationLists += 1;
      return new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    };
    const app = await createGitHubApp({
      appId: '123',
      privateKeyPath: await privateKeyFile(),
      fetch: fetchImpl,
    });

    await expect(app.forOwner('alice')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(installationLists).toBe(2);
  });

  it('aborts a stalled App installation request at the configured deadline', async () => {
    const fetchImpl = async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const app = await createGitHubApp({
      appId: '123',
      privateKeyPath: await privateKeyFile(),
      fetch: fetchImpl,
      timeoutMs: 1,
    });

    await expect(app.forOwner('alice')).rejects.toBeDefined();
  });
});
