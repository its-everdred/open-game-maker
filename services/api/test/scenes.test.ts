import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SceneDoc } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { commitScene, emptyScene } from '@ogm/design-log';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/app.js';
import { agentSceneRoutes } from '../src/internal/agent-scenes.js';
import { creatorAuthor } from '../src/scenes/store.js';
import { ids, insertJob } from './budget/fixture.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const user = (userId: string, displayName: string): TestUser => ({
  kind: 'user',
  userId,
  email: `${userId}@example.test`,
  familyId: ids.family,
  displayName,
  platformRole: 'none',
  capability: 'creator',
});

const CHEST = 't3:dusk-helm/sprites/chest';
const GROUND = 't3:dusk-helm/sprites/ground';

function cave(): SceneDoc {
  return {
    ...emptyScene('dusk-helm', 'goblin-cave', 'smallscaleint'),
    bounds: { width: 4, height: 4 },
    layers: {
      floor: { kind: 'tiles', order: 0, tiles: { '0,0': { asset: GROUND, facing: 'E' } } },
      decor: { kind: 'tiles', order: 2, tiles: { '1,1': { asset: CHEST, facing: 'E' } } },
    },
  };
}

/** A checkout holding the cave as an agent left it in the repository (rev 1), and a lock with one iso sprite. */
function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'ogm-scenes-'));
  roots.push(root);
  const game = join(root, 'games', 'dusk-helm');
  mkdirSync(join(game, 'scenes'), { recursive: true });
  const first = commitScene({
    head: { rev: 0, doc: emptyScene('dusk-helm', 'goblin-cave', 'smallscaleint') },
    log: [],
    doc: cave(),
    baseRev: 0,
    author: 'agent:1208',
    source: 'cli',
    label: 'convert',
    now: new Date('2026-11-22T00:00:00Z'),
  });
  if (!first.ok || !first.revision) throw new Error('fixture');
  writeFileSync(join(game, 'scenes', 'goblin-cave.scene.json'), JSON.stringify(first.head));
  writeFileSync(join(game, 'scenes', 'goblin-cave.revs.jsonl'), `${JSON.stringify(first.revision)}\n`);
  const sha = 'a'.repeat(64);
  writeFileSync(
    join(game, 'assets.lock.json'),
    JSON.stringify({
      version: 1,
      family: 'isometric-2d',
      pov: 'iso',
      assets: [
        {
          id: CHEST,
          path: 'Chest A1_E.png',
          source: 'vendored',
          sha256: sha,
          files: [{ path: 'Chest A1_N.png', sha256: 'b'.repeat(64) }],
          license: 'fixture',
          rights: { uses: [], audience: 'private', redistribution: 'in-build', attribution: null },
          added: '2026-11-01',
          meta: { sprite: { drawn_view: 'iso', facings: { E: 'Chest A1_E.png', N: 'Chest A1_N.png' } } },
        },
      ],
    }),
  );
  return { root, game };
}

function setup(root: string) {
  const deps = makeDeps();
  installUsers(deps, [user(ids.creator, 'Kevin'), user(ids.other, 'Someone')]);
  const now = '2026-11-01T00:00:00.000Z';
  deps.db.insert(schema.families).values({ id: ids.family, name: 'F', ownerUserId: ids.creator, createdAt: now }).run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.creator, role: 'owner', capability: 'creator', joinedAt: now })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.creator,
      slug: 'dusk-helm',
      githubPath: 'games/dusk-helm',
      title: 'Dusk Helm',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'dusk-helm',
      repo: 'instance/games',
      checkoutPath: root,
      unit: 'dusk-helm.service',
      envFile: '/dusk-helm.env',
      port: 34568,
      status: 'idle',
      createdAt: now,
    })
    .run();
  return deps;
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('shared scene store', () => {
  it("saves Kevin's map edits as his revisions, which the agent pulls and cannot overwrite", async () => {
    const { root } = checkout();
    const deps = setup(root);
    const { app } = await makeApp(deps);
    const sceneUrl = `/api/v1/games/${ids.game}/editor/scenes/goblin-cave`;

    expect((await app.request(sceneUrl)).status).toBe(401);
    expect((await app.request(sceneUrl, { headers: asUser(ids.other) })).status).toBe(403);
    const opened = await app.request(sceneUrl, { headers: asUser(ids.creator) });
    expect(opened.status).toBe(200);
    const open = (await opened.json()) as { rev: number; doc: SceneDoc; author: string; sprites: unknown };
    // The first open starts the shared store from the repository's copy, history included.
    expect(open).toMatchObject({ rev: 1, author: 'agent:1208', doc: cave() });
    expect(open.sprites).toEqual({
      [CHEST]: {
        facings: {
          E: `/api/v1/games/${ids.game}/scenery/assets/0/${'a'.repeat(64)}/Chest%20A1_E.png`,
          N: `/api/v1/games/${ids.game}/scenery/assets/0/${'a'.repeat(64)}/Chest%20A1_N.png`,
        },
      },
    });

    // Kevin moves the chest and paints a floor cell.
    const edited = structuredClone(open.doc);
    delete edited.layers.decor!.tiles!['1,1'];
    edited.layers.decor!.tiles!['2,2'] = { asset: CHEST, facing: 'N' };
    edited.layers.floor!.tiles!['1,0'] = { asset: GROUND, facing: 'E' };
    const saveUrl = `${sceneUrl}/revisions`;
    expect((await app.request(saveUrl, json({ baseRev: 1, doc: edited }, asUser(ids.other)))).status).toBe(403);
    const saved = await app.request(
      saveUrl,
      json({ baseRev: 1, doc: edited, label: 'Moved the chest' }, asUser(ids.creator)),
    );
    expect(saved.status).toBe(200);
    const after = (await saved.json()) as { rev: number; doc: SceneDoc };
    expect(after.rev).toBe(2);
    expect(after.doc.layers.decor!.tiles!['2,2']).toEqual({ asset: CHEST, facing: 'N', lockedBy: 'creator' });

    // Reload: the store, not the repository copy, is what opens and what the scene chips list.
    const reopened = (await (await app.request(sceneUrl, { headers: asUser(ids.creator) })).json()) as {
      rev: number;
      author: string;
    };
    expect(reopened).toMatchObject({ rev: 2, author: 'kevin' });
    const list = await app.request(`/api/v1/games/${ids.game}/editor/scenes`, { headers: asUser(ids.creator) });
    expect(((await list.json()) as { scenes: unknown[] }).scenes).toEqual([
      expect.objectContaining({ id: 'goblin-cave', rev: 2, author: 'kevin' }),
    ]);

    // The agent's daemon reads the same store for its own ticket.
    insertJob(deps, { id: ids.running });
    deps.registry.ticketJobResolver = async (repo, ticket) =>
      repo === 'instance/games' && ticket === '1300'
        ? {
            jobId: ids.running,
            gameId: ids.game,
            repo,
            kind: 'feature',
            game: { title: 'Dusk Helm', family: 'any', pov: 'iso', genre: 'adventure', multiplayer: false },
          }
        : null;
    const internal = createApp(deps);
    internal.route(
      '/internal',
      agentSceneRoutes({
        identityForSecret: async (secret) =>
          secret === 'own'
            ? { repo: 'instance/games', slug: 'dusk-helm' }
            : secret === 'other'
              ? { repo: 'instance/games', slug: 'other' }
              : null,
      }),
    );
    const agentUrl = 'http://127.0.0.1/internal/jobs/by-ticket/1300/scenes/goblin-cave';
    const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });
    expect((await internal.request(agentUrl)).status).toBe(401);
    expect((await internal.request(agentUrl, { headers: auth('other') })).status).toBe(404);
    expect((await internal.request(agentUrl.replace('1300', '9'), { headers: auth('own') })).status).toBe(404);
    const pulled = (await (await internal.request(agentUrl, { headers: auth('own') })).json()) as {
      head: { rev: number; doc: SceneDoc };
      log: { author: string; source: string }[];
    };
    expect(pulled.head.rev).toBe(2);
    expect(pulled.log.map(({ author, source }) => [author, source])).toEqual([
      ['agent:1208', 'cli'],
      ['kevin', 'editor'],
    ]);

    // Starting from the old base, the agent's change to Kevin's chest is refused; its other edit, alone, applies.
    const mine = cave();
    mine.layers.decor!.tiles!['2,2'] = { asset: CHEST, facing: 'W' };
    const refused = await internal.request(agentUrl, json({ baseRev: 1, doc: mine }, auth('own')));
    expect(await refused.json()).toMatchObject({
      ok: false,
      conflicts: [expect.objectContaining({ unit: 'tile:decor:2,2', reason: 'creator_locked', by: 'kevin' })],
    });
    const next = structuredClone(pulled.head.doc);
    next.layers.floor!.tiles!['3,3'] = { asset: GROUND, facing: 'E' };
    const pushed = (await (await internal.request(agentUrl, json({ baseRev: 2, doc: next }, auth('own')))).json()) as {
      ok: boolean;
      head: { rev: number; doc: SceneDoc };
      revision: { author: string };
    };
    expect(pushed).toMatchObject({ ok: true, head: { rev: 3 }, revision: { author: 'agent:1300' } });
    expect(pushed.head.doc.layers.decor!.tiles!['2,2']).toEqual({ asset: CHEST, facing: 'N', lockedBy: 'creator' });

    // A seed never overwrites a store that exists.
    const seed = await internal.request(
      `${agentUrl}/seed`,
      json({ head: { rev: 0, doc: cave() }, log: [] }, auth('own')),
    );
    expect(((await seed.json()) as { head: { rev: number } }).head.rev).toBe(3);
  });

  it('names the creator by a slug of their display name', () => {
    expect(creatorAuthor('Kevin')).toBe('kevin');
    expect(creatorAuthor('Ana María Ruiz')).toBe('ana-maria-ruiz');
    expect(creatorAuthor('42')).toBe('creator');
  });
});
