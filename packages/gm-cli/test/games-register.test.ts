import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { gm, tempDir } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

it('registers a checkout and lets publish dry-run find the game', async () => {
  const home = tempDir();
  const checkout = join(home, 'games', 'fixture-repo');
  mkdirSync(join(checkout, '.aiur'), { recursive: true });
  execFileSync('git', ['init', '-q', checkout]);
  execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', 'https://github.com/example/fixture-repo.git']);
  writeFileSync(join(checkout, '.aiur', 'config'), 'server:\n  port: 4011\n');
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toMatchObject({
        slug: 'fixture',
        repo: { owner: 'example', name: 'fixture-repo', path: 'games/fixture' },
        daemon: { port: 4011, checkoutPath: checkout },
      });
      return new Response(JSON.stringify({ id: 'g-fixture', ownerId: 'u-owner' }), { status: 201 });
    }
    return new Response(
      JSON.stringify({
        game: { id: 'g-fixture', slug: 'fixture', repo: { path: 'games/fixture' } },
        daemon: { checkoutPath: checkout },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const options = { home, env: { OGM_INTERNAL_TOKEN: 'fixture-token-long-enough', OGM_API_PORT: '8000' } };
  const registered = await gm(
    [
      'games',
      'register',
      'fixture',
      '--repo',
      'example/fixture-repo',
      '--folder',
      'games/fixture',
      '--title',
      'Fixture',
    ],
    options,
  );
  expect(registered.err).toEqual([]);
  expect(registered.code).toBe(0);
  expect(registered.out).toContain('registered fixture (owner: u-owner)');
  const dry = await gm(['publish', 'fixture', '--dry-run'], options);
  expect(dry.code).toBe(0);
  expect(dry.out.join('\n')).toContain('games/fixture');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
