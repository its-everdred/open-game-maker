import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { NullRepoProvisioner } from '../src/games/repo-provisioner.js';
import { slugify } from '../src/games/slug.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-05T00:00:00.000Z';

function user(overrides: Partial<TestUser> & Pick<TestUser, 'userId' | 'familyId'>): TestUser {
  return {
    kind: 'user',
    displayName: overrides.userId,
    email: `${overrides.userId}@example.com`,
    platformRole: 'none',
    capability: 'creator',
    ...overrides,
  };
}

const owner = user({ userId: 'u-owner', familyId: 'f-house' });
const sibling = user({ userId: 'u-sibling', familyId: 'f-house' });
const stranger = user({ userId: 'u-stranger', familyId: 'f-other' });

function seed(app: { deps: ReturnType<typeof makeDeps> }) {
  installUsers(app.deps, [owner, sibling, stranger]);
  app.deps.db
    .insert(schema.families)
    .values([
      { id: 'f-house', name: 'House', ownerUserId: owner.userId, createdAt: now },
      { id: 'f-other', name: 'Other', ownerUserId: stranger.userId, createdAt: now },
    ])
    .run();
  app.deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId: 'f-house', userId: owner.userId, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId: 'f-house', userId: sibling.userId, role: 'member', capability: 'player', joinedAt: now },
      { familyId: 'f-other', userId: stranger.userId, role: 'owner', capability: 'creator', joinedAt: now },
    ])
    .run();
}

async function setup() {
  const deps = makeDeps();
  deps.registry.repoProvisioner = new NullRepoProvisioner();
  deps.registry.githubInstallations = { loginFor: async () => 'castle-gh', revalidate: async () => 'castle-gh' };
  seed({ deps });
  const { app } = await makeApp(deps);
  await app.request('/api/v1/github/connect', {
    method: 'POST',
    headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
    body: JSON.stringify({ installationId: '12345', code: 'code-abc' }),
  });
  return { deps, app };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function createGame(app: App, title: string): Promise<{ id: string; slug: string; title: string }> {
  const response = await app.request('/api/v1/games', {
    method: 'POST',
    headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
    body: JSON.stringify({ title, repoVisibility: 'private' }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; slug: string; title: string };
}

async function resolve(app: App, ref: string, userId = owner.userId) {
  return app.request(`/api/v1/games/resolve/${encodeURIComponent(ref)}`, { headers: asUser(userId) });
}

async function rename(app: App, gameId: string, title: string) {
  return app.request(`/api/v1/games/${encodeURIComponent(gameId)}`, {
    method: 'PATCH',
    headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

describe('game slugs', () => {
  it('derives the shareable slug from the title and resolves it', async () => {
    const { app } = await setup();

    const game = await createGame(app, 'Castle Game!');

    expect(game.slug).toBe('castle-game');
    const response = await resolve(app, 'castle-game');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ game: expect.objectContaining({ id: game.id, slug: 'castle-game' }) });
  });

  it('keeps slugs unique per instance when two games share a title', async () => {
    const { app } = await setup();

    const first = await createGame(app, 'Castle Game');
    const second = await createGame(app, 'Castle Game');

    expect([first.slug, second.slug]).toEqual(['castle-game', 'castle-game-2']);
    await expect(
      resolve(app, 'castle-game-2')
        .then((response) => response.json())
        .then((body: { game: { id: string } }) => body.game.id),
    ).resolves.toBe(second.id);
  });

  // A slug is the game's top-level link (`/<slug>`), so a game titled like an app screen must not take that screen's
  // address: `/new` has to keep opening the new-game screen.
  it('never hands a game a slug an app route answers to', async () => {
    const { app } = await setup();

    const games = [await createGame(app, 'New'), await createGame(app, 'Settings'), await createGame(app, 'Play')];

    expect(games.map((game) => game.slug)).toEqual(['new-2', 'settings-2', 'play-2']);
  });

  it('skips a reserved slug on rename too', async () => {
    const { app } = await setup();
    const game = await createGame(app, 'Castle Game');

    const response = await rename(app, game.id, 'Admin');

    expect(((await response.json()) as { slug: string }).slug).toBe('admin-2');
  });

  it('keeps resolving a game by its id', async () => {
    const { app } = await setup();

    const game = await createGame(app, 'Castle Game');
    const response = await resolve(app, game.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ game: expect.objectContaining({ id: game.id }) });
  });

  it('moves the slug on rename and still opens the game from the old link', async () => {
    const { app } = await setup();
    const game = await createGame(app, 'Castle Game');

    expect((await rename(app, game.id, 'Space Castle')).status).toBe(200);

    const current = (await (await resolve(app, 'space-castle')).json()) as { game: { id: string; slug: string } };
    expect(current.game).toMatchObject({ id: game.id, slug: 'space-castle' });
    const retired = (await (await resolve(app, 'castle-game')).json()) as { game: { id: string; slug: string } };
    expect(retired.game).toMatchObject({ id: game.id, slug: 'space-castle' });
  });

  it('stops handing a renamed game’s old title slug to a new game', async () => {
    const { app } = await setup();
    const game = await createGame(app, 'Castle Game');
    await rename(app, game.id, 'Space Castle');

    const second = await createGame(app, 'Castle Game');

    expect(second.slug).toBe('castle-game-2');
  });

  it('answers 404 for a slug no game ever had', async () => {
    const { app } = await setup();

    const response = await resolve(app, 'never-existed');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'game_not_found' });
  });

  it('answers 403 rather than 404 when the game exists outside the caller’s household', async () => {
    const { app } = await setup();
    const game = await createGame(app, 'Castle Game');

    const response = await resolve(app, 'castle-game', stranger.userId);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'cross_family' });
    expect(game.id).toBeDefined();
  });

  it('answers 403 for a private game the caller cannot play', async () => {
    const { app } = await setup();
    await createGame(app, 'Castle Game');

    const response = await resolve(app, 'castle-game', sibling.userId);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'private_game' });
  });
});

describe('slugify', () => {
  it.each([
    ['Castle Game', 'castle-game'],
    ['  Spaces   and   dashes  ', 'spaces-and-dashes'],
    ['Pokémon Trainer', 'pokemon-trainer'],
    ['!!!', 'game'],
    ['x'.repeat(120), 'x'.repeat(48)],
  ])('turns %s into %s', (title, expected) => {
    expect(slugify(title)).toBe(expected);
  });
});
