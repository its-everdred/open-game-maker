import { homedir } from 'node:os';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { NullRepoProvisioner } from '../src/games/repo-provisioner.js';
import { registeredSlug } from '../src/games/register.js';
import { X, seededApp } from './admin-fixture.js';
import { asUser } from './helpers.js';

// A game whose repository already exists: `games/blobs` in a monorepo someone else owns, already built by that
// monorepo's aiur instance on port 4011. Registering it must write the registry row and its daemon row and nothing
// else — no repository, no folder, no daemon start, no provisioner call — so the next game in the same repository
// takes this path instead of a hand-edited row.
const blobs = {
  title: 'Blobs',
  repo: { owner: 'open-games', name: 'instance-repo', path: 'games/blobs' },
  daemon: {
    port: 4011,
    checkoutPath: '/srv/open-games',
    unit: 'ogm-aiur@open-games.service',
    envFile: '/srv/config/ogm-aiur@open-games.env',
  },
};

const gameRow = (deps: Awaited<ReturnType<typeof seededApp>>['deps'], slug: string) =>
  deps.db.select().from(schema.games).where(eq(schema.games.slug, slug)).get();
const daemonRow = (deps: Awaited<ReturnType<typeof seededApp>>['deps'], slug: string) =>
  deps.db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, slug)).get();

describe('registering a game whose repository already exists', () => {
  it('writes the game row with the repository and folder, and creates nothing else', async () => {
    const { deps, call } = await seededApp();
    const provisioner = new NullRepoProvisioner();
    deps.registry.repoProvisioner = provisioner;

    const response = await call(X.admin, 'POST', '/games/import', blobs);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      title: 'Blobs',
      slug: 'blobs',
      ownerId: X.admin.userId,
      visibility: 'private',
      repo: {
        owner: 'open-games',
        name: 'instance-repo',
        url: 'https://github.com/open-games/instance-repo',
      },
      daemon: { slug: 'blobs', port: 4011, repo: 'open-games/instance-repo' },
    });
    expect(gameRow(deps, 'blobs')).toMatchObject({
      familyId: X.family,
      ownerId: X.admin.userId,
      title: 'Blobs',
      slug: 'blobs',
      githubOwner: 'open-games',
      githubRepo: 'instance-repo',
      githubPath: 'games/blobs',
      repoUrl: 'https://github.com/open-games/instance-repo',
      repoVisibility: 'public',
      delistedAt: null,
    });
    // The daemon row links the game to the instance already building its repository: same slug, same repository.
    expect(daemonRow(deps, 'blobs')).toMatchObject({
      slug: 'blobs',
      repo: 'open-games/instance-repo',
      checkoutPath: '/srv/open-games',
      unit: 'ogm-aiur@open-games.service',
      envFile: '/srv/config/ogm-aiur@open-games.env',
      port: 4011,
      status: 'running',
      maxConcurrentAgents: 1,
    });
    // The provisioner would create a repository and a `games/blobs/` folder the game already has.
    expect(provisioner.calls).toEqual([]);
  });

  it('registers for another member of the same family', async () => {
    const { deps, call } = await seededApp();
    const response = await call(X.admin, 'POST', '/games/import', { ...blobs, ownerId: X.creator.userId });
    expect(response.status).toBe(201);
    expect(gameRow(deps, 'blobs')).toMatchObject({ ownerId: X.creator.userId, familyId: X.family });
  });

  it('opens from the games picker and its play link', async () => {
    const { app, deps } = await seededApp();
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const registered = await app.request('/api/v1/admin/games/import', {
      method: 'POST',
      headers: { ...asUser(X.owner.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ ...blobs, visibility: 'listed' }),
    });
    expect(registered.status).toBe(201);

    const picker = await app.request('/api/v1/games', { headers: asUser(X.player.userId) });
    expect(picker.status).toBe(200);
    const { games } = (await picker.json()) as { games: { slug: string; title: string }[] };
    expect(games).toContainEqual(expect.objectContaining({ slug: 'blobs', title: 'Blobs' }));

    const play = await app.request('/api/v1/games/resolve/blobs', { headers: asUser(X.player.userId) });
    expect(play.status).toBe(200);
    expect((await play.json()) as { game: { title: string } }).toMatchObject({ game: { title: 'Blobs' } });
  });

  it('refuses a path that is not the game folder under games/', async () => {
    const { call } = await seededApp();
    for (const path of ['blobs', 'packages/blobs', 'games/blobs/src', 'games/Blobs', 'games/../blobs', 'games/']) {
      const response = await call(X.admin, 'POST', '/games/import', { ...blobs, repo: { ...blobs.repo, path } });
      expect(response.status, path).toBe(422);
      expect(await response.json()).toEqual({ error: 'repo_path_invalid' });
    }
  });

  // `games/settings` would be the game's top-level link `/settings`, which the settings screen already answers to.
  it('refuses a folder named like an app route', async () => {
    const { call, deps } = await seededApp();
    const response = await call(X.admin, 'POST', '/games/import', {
      ...blobs,
      repo: { ...blobs.repo, path: 'games/settings' },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'game_slug_reserved' });
    expect(gameRow(deps, 'settings')).toBeUndefined();
  });

  it('refuses a repository and folder already registered', async () => {
    const { call } = await seededApp();
    expect((await call(X.admin, 'POST', '/games/import', blobs)).status).toBe(201);
    const response = await call(X.admin, 'POST', '/games/import', blobs);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'game_slug_taken' });
  });

  it('refuses a folder another game in another repository already answers to', async () => {
    const { deps, call } = await seededApp();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g-other-blobs',
        familyId: X.family,
        ownerId: X.owner.userId,
        title: 'Other blobs',
        slug: 'blobs',
        githubOwner: 'other',
        githubRepo: 'other-repo',
        githubPath: 'games/blobs',
        repoVisibility: 'private',
        visibility: 'private',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    const response = await call(X.admin, 'POST', '/games/import', blobs);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'game_slug_taken' });
  });

  it('refuses a daemon row the slug already has', async () => {
    const { deps, call } = await seededApp();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'blobs',
        repo: 'open-games/instance-repo',
        checkoutPath: '/srv/open-games',
        unit: 'ogm-aiur@open-games.service',
        envFile: '/srv/config/ogm-aiur@open-games.env',
        port: 4102,
        status: 'running',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    const response = await call(X.admin, 'POST', '/games/import', blobs);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'game_daemon_already_registered' });
  });

  it('refuses a port another daemon already listens on', async () => {
    const { deps, call } = await seededApp();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'other-game',
        repo: 'open-games/instance-repo',
        checkoutPath: '/srv/open-games',
        unit: 'ogm-aiur@open-games.service',
        envFile: '/srv/config/ogm-aiur@open-games.env',
        port: 4011,
        status: 'running',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    const response = await call(X.admin, 'POST', '/games/import', blobs);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'daemon_port_taken' });
  });

  it('refuses an owner who is not in the caller family', async () => {
    const { call } = await seededApp();
    const response = await call(X.admin, 'POST', '/games/import', { ...blobs, ownerId: 'u-not-in-family' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'member_not_found' });
  });

  it('refuses a player', async () => {
    const { call } = await seededApp();
    const response = await call(X.player, 'POST', '/games/import', blobs);
    expect(response.status).toBe(403);
  });

  it('refuses a title with no words', async () => {
    const { call } = await seededApp();
    const response = await call(X.admin, 'POST', '/games/import', { ...blobs, title: '   ' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses a daemon block with no port', async () => {
    const { call } = await seededApp();
    const response = await call(X.admin, 'POST', '/games/import', {
      ...blobs,
      daemon: { checkoutPath: '/srv/open-games', unit: 'ogm-aiur@open-games.service', envFile: '/srv/e.env' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('defaults the daemon unit and env file to the instance repository convention', async () => {
    const { deps, call } = await seededApp();
    const response = await call(X.admin, 'POST', '/games/import', {
      ...blobs,
      daemon: { port: 4011, checkoutPath: '/srv/open-games' },
    });
    expect(response.status).toBe(201);
    expect(daemonRow(deps, 'blobs')).toMatchObject({
      unit: 'ogm-aiur@instance-repo.service',
      envFile: join(homedir(), '.config/ogm/env', 'ogm-aiur@instance-repo.env'),
    });
  });
});

describe('registeredSlug', () => {
  it('names the folder under games/', () => {
    expect(registeredSlug('games/blobs')).toBe('blobs');
    expect(registeredSlug('games/coin-hop')).toBe('coin-hop');
  });

  it('refuses a folder that is not the whole path segment', () => {
    expect(() => registeredSlug('games/blobs/lib')).toThrow(/repo_path_invalid/);
    expect(() => registeredSlug('games/Blobs')).toThrow(/repo_path_invalid/);
    expect(() => registeredSlug('blobs')).toThrow(/repo_path_invalid/);
  });
});
