import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { seededApp, X, Y } from '../admin-fixture.js';
import { INTERNAL_TOKEN } from '../helpers.js';

const body = {
  slug: 'fixture',
  title: 'Fixture',
  repo: { owner: 'example', name: 'games', path: 'games/fixture' },
  daemon: { port: 4011, checkoutPath: '/srv/games' },
  ownerId: X.owner.userId,
};

describe('operator game registration', () => {
  it('requires the internal token and registers, updates, and exposes the game to publish', async () => {
    const { app, deps } = await seededApp();
    const send = (payload: unknown, token = INTERNAL_TOKEN) =>
      app.request('/internal/operator/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ogm-internal': token },
        body: JSON.stringify(payload),
      });
    expect((await send(body, 'wrong')).status).toBe(401);
    const { ownerId: _ignoredOwner, ...noOwner } = body;
    expect((await send(noOwner)).status).toBe(409);
    deps.config.instanceOwnerId = X.owner.userId;
    expect((await send(noOwner)).status).toBe(201);
    expect((await send({ ...body, title: 'Updated', daemon: { port: 4012, checkoutPath: '/srv/new' } })).status).toBe(
      200,
    );
    const facts = await app.request('/internal/operator/games/fixture', {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(await facts.json()).toMatchObject({
      game: { title: 'Updated', repo: { path: 'games/fixture' } },
      daemon: { port: 4012, checkoutPath: '/srv/new' },
    });
    const second = {
      ...body,
      daemon: { port: 4012, checkoutPath: '/srv/new' },
      slug: 'other',
      repo: { ...body.repo, path: 'games/other' },
    };
    expect((await send(second)).status).toBe(201);
    const shared = await app.request('/internal/operator/games/other', {
      headers: { 'x-ogm-internal': INTERNAL_TOKEN },
    });
    expect(await shared.json()).toMatchObject({ daemon: { port: 4012, checkoutPath: '/srv/new' } });
    expect((await send({ ...second, repo: { ...second.repo, owner: 'different' } })).status).toBe(409);
    expect(
      (
        await send({
          ...second,
          slug: 'third',
          repo: { ...second.repo, path: 'games/third' },
          daemon: { ...second.daemon, port: 4013 },
        })
      ).status,
    ).toBe(409);
    expect(deps.db.select().from(schema.games).where(eq(schema.games.slug, 'fixture')).all()).toHaveLength(1);
  });
});

it('registers a fixture through gm and finds it with publish dry-run', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { vi } = await import('vitest');
  const { run } = await import('../../../../packages/gm-cli/src/cli.js');
  const { app, deps } = await seededApp();
  deps.db.delete(schema.familyMembers).where(eq(schema.familyMembers.familyId, Y.family)).run();
  const home = mkdtempSync(join(tmpdir(), 'operator-register-'));
  try {
    const checkout = join(home, 'games', 'games');
    mkdirSync(join(checkout, '.aiur'), { recursive: true });
    execFileSync('git', ['init', '-q', checkout]);
    execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', 'https://github.com/example/games.git']);
    writeFileSync(join(checkout, '.aiur', 'config'), 'server:\n  port: 4011\n');
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
    const output: string[] = [];
    const options = {
      home,
      env: { OGM_INTERNAL_TOKEN: INTERNAL_TOKEN, OGM_API_PORT: '8000' },
      out: (line: string) => output.push(line),
    };
    expect(
      await run(
        ['games', 'register', 'fixture', '--repo', 'example/games', '--folder', 'games/fixture', '--title', 'Fixture'],
        options,
      ),
    ).toBe(0);
    expect(await run(['publish', 'fixture', '--dry-run'], options)).toBe(0);
    expect(output.join('\n')).toContain('games/fixture');
    expect(deps.db.select().from(schema.games).where(eq(schema.games.slug, 'fixture')).get()?.ownerId).toBe(
      X.owner.userId,
    );
  } finally {
    vi.unstubAllGlobals();
    rmSync(home, { recursive: true, force: true });
  }
});
