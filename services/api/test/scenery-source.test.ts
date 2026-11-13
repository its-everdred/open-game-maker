import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlobHash, BlobStore } from '@ogm/blob-store';
import { schema } from '@ogm/db';
import { readSceneryFile, readScenerySource } from '../src/scenery/source.js';
import { insertChatRow } from '../src/build-chat/store.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ogm-scenery-source-'));
  roots.push(root);
  const game = join(root, 'games', 'fixture');
  mkdirSync(join(game, 'models'), { recursive: true });
  const model = Buffer.from('locked model');
  writeFileSync(join(game, 'models', 'tree model.glb'), model);
  const id = 't3:fixture/models/tree';
  const lock = {
    version: 1,
    family: 'chunky-low-poly',
    pov: 'follow',
    assets: [
      {
        id,
        path: 'models/tree model.glb',
        source: 'vendored',
        sha256: createHash('sha256').update(model).digest('hex'),
        license: 'fixture',
        rights: { uses: [], audience: 'private', redistribution: 'in-build', attribution: null },
        added: '2026-11-01',
      },
    ],
  };
  writeFileSync(join(game, 'assets.lock.json'), JSON.stringify(lock));
  const blobStore = { open: async () => null } as unknown as BlobStore;
  return { root, game, id, blobStore };
}

describe('no-build scenery source', () => {
  it('uses the tracked scene commit time rather than checkout file time', async () => {
    const { root, game } = fixture();
    const scenePath = join(game, 'scenery.json');
    writeFileSync(
      scenePath,
      JSON.stringify({
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      }),
    );
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
        // The temporary Git fixture needs a deterministic committer timestamp.
        // eslint-disable-next-line no-restricted-properties
        env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z' },
      });
    git('init', '-q');
    git('add', 'games/fixture/scenery.json');
    git('commit', '-qm', 'scene');
    utimesSync(scenePath, new Date('2026-11-12T00:00:00Z'), new Date('2026-11-12T00:00:00Z'));
    expect((await readScenerySource(root, 'games/fixture')).updatedAt).toBe('2026-11-01T00:00:00.000Z');
    writeFileSync(
      scenePath,
      JSON.stringify({
        version: 1,
        items: [],
        terrain: [],
        lighting: 'night',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      }),
    );
    utimesSync(scenePath, new Date('2026-11-12T00:00:00Z'), new Date('2026-11-12T00:00:00Z'));
    expect((await readScenerySource(root, 'games/fixture')).updatedAt).toBe('2026-11-12T00:00:00.000Z');
  });
  it('authorizes the owner and exposes only locked file URLs', async () => {
    const { root, game } = fixture();
    const ids = {
      family: 'f_01K8Z6Y7X8P9Q0R1S2T3V4W5X6',
      creator: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X7',
      other: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X8',
      game: 'g_01K8Z6Y7X8P9Q0R1S2T3V4W5X9',
    };
    const user = (userId: string): TestUser => ({
      kind: 'user',
      userId,
      email: `${userId}@example.test`,
      familyId: ids.family,
      displayName: 'Creator',
      platformRole: 'none',
      capability: 'creator',
    });
    const deps = makeDeps();
    installUsers(deps, [user(ids.creator), user(ids.other)]);
    const now = '2026-11-01T00:00:00.000Z';
    deps.db
      .insert(schema.families)
      .values({ id: ids.family, name: 'Family', ownerUserId: ids.creator, createdAt: now })
      .run();
    deps.db
      .insert(schema.familyMembers)
      .values([
        { familyId: ids.family, userId: ids.creator, role: 'owner', capability: 'creator', joinedAt: now },
        { familyId: ids.family, userId: ids.other, role: 'member', capability: 'creator', joinedAt: now },
      ])
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: ids.game,
        familyId: ids.family,
        ownerId: ids.creator,
        slug: 'fixture',
        githubPath: 'games/fixture',
        title: 'Fixture',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'fixture',
        repo: 'example/repo',
        checkoutPath: root,
        unit: 'fixture.service',
        envFile: '/fixture.env',
        port: 34567,
        status: 'idle',
        createdAt: now,
      })
      .run();
    const { app } = await makeApp(deps);
    const url = `/api/v1/games/${ids.game}/scenery/source`;
    expect((await app.request(url)).status).toBe(401);
    expect((await app.request(url, { headers: asUser(ids.other) })).status).toBe(403);
    const fallbackUrl = `/api/v1/games/${ids.game}/editor/fallback`;
    expect((await app.request(fallbackUrl)).status).toBe(401);
    expect((await app.request(fallbackUrl, { headers: asUser(ids.other) })).status).toBe(403);
    const fallback = await app.request(fallbackUrl, { headers: asUser(ids.creator) });
    expect(fallback.status).toBe(200);
    const fallbackBody = await fallback.json();
    expect(fallbackBody).toMatchObject({ mode: 'request', palette: { items: [{ prefab: 't3:fixture/models/tree' }] } });
    expect(JSON.stringify(fallbackBody)).not.toContain(root);
    const response = await app.request(url, { headers: asUser(ids.creator) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assets: { url: string; sha256: string }[] };
    expect(JSON.stringify(body)).not.toContain(root);
    expect(body.assets[0]?.sha256).toBe(createHash('sha256').update('locked model').digest('hex'));
    const asset = await app.request(body.assets[0]!.url, { headers: asUser(ids.creator) });
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('locked model');
    writeFileSync(join(game, 'models/tree model.glb'), 'tampered');
    expect((await app.request(body.assets[0]!.url, { headers: asUser(ids.creator) })).status).toBe(404);
    const scenePath = join(game, 'scenery.json');
    writeFileSync(
      scenePath,
      JSON.stringify({
        version: 1,
        items: [],
        terrain: [],
        lighting: 'warm-forest',
        camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
      }),
    );
    utimesSync(scenePath, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    const datedScene = await app.request(url, { headers: asUser(ids.creator) });
    expect(await datedScene.json()).toMatchObject({ updatedAt: '2026-11-01T00:00:00.000Z' });
    writeFileSync(join(game, 'scenery.json'), '{invalid');
    expect((await app.request(fallbackUrl, { headers: asUser(ids.creator) })).status).toBe(200);
    expect((await app.request(url, { headers: asUser(ids.creator) })).status).toBe(404);
    deps.db
      .insert(schema.jobs)
      .values({
        id: 'j_scope',
        gameId: ids.game,
        branchId: 'main',
        familyId: ids.family,
        creatorId: ids.creator,
        kind: 'scope',
        complexity: 1,
        state: 'done',
        start: 'now',
        slot: 'edit',
        plan: '{}',
        reservation: '{}',
        hardCapMicroUsd: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    deps.db
      .insert(schema.scopeSessions)
      .values({
        id: 's_88000000-0000-4000-8000-000000000001',
        gameId: ids.game,
        creatorId: ids.creator,
        jobId: 'j_scope',
        status: 'agreed',
        revision: 1,
        choices: '{}',
        scope: JSON.stringify({
          session_id: 's_88000000-0000-4000-8000-000000000001',
          revision: 1,
          title: 'Game',
          summary: 'A game',
          scope: { included: ['Forest trees'], excluded: ['Dragons'] },
          tickets: [{ key: 'one', title: 'Build', skills: [], dependsOn: [], acceptanceCriteria: ['Works'] }],
          complexity: 1,
          open_questions: [],
          ideas: [],
        }),
        scopeHash: 'hash',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const mediaId = 'm_88000000-0000-4000-8000-000000000001';
    insertChatRow(deps.sqlite, {
      id: mediaId,
      jobId: 'j_scope',
      actor: 'agent',
      kind: 'image',
      at: now,
      media: { hash: `sha256:${'a'.repeat(64)}` as BlobHash, width: 100, height: 100 },
    });
    insertChatRow(deps.sqlite, {
      jobId: 'j_scope',
      actor: 'agent',
      kind: 'command',
      at: now,
      command: {
        decision_id: 'decision',
        question: 'Choose a scene',
        options: [{ id: 'a', label: 'Forest', media_id: mediaId }],
        status: 'answered',
        option_id: 'a',
      },
    });
    const stageUrl = `/api/v1/games/${ids.game}/editor/stage`;
    expect((await app.request(stageUrl)).status).toBe(401);
    expect((await app.request(stageUrl, { headers: asUser(ids.other) })).status).toBe(403);
    const stage = await app.request(stageUrl, { headers: asUser(ids.creator) });
    expect(await stage.json()).toMatchObject({ stage: { kind: 'image', url: expect.stringContaining('/sha256/') } });
    const otherBranch = await app.request(`${stageUrl}?branch=other`, { headers: asUser(ids.creator) });
    expect(await otherBranch.json()).toEqual({ stage: null });
    rmSync(join(game, 'assets.lock.json'));
    const scopeOnly = await app.request(fallbackUrl, { headers: asUser(ids.creator) });
    expect(scopeOnly.status).toBe(200);
    expect(await scopeOnly.json()).toMatchObject({
      mode: 'request',
      palette: { items: [{ prefab: 'scope:0', label: 'Forest trees', category: 'scenery' }] },
    });
  }, 60_000);
  it('serves only hash-verified files listed in the game lock', async () => {
    const { root, game, id, blobStore } = fixture();
    const source = await readScenerySource(root, 'games/fixture');
    expect(source.scene.items).toEqual([]);
    const options = { root: source.root, lock: source.lock, assetId: id, path: 'models/tree model.glb', blobStore };
    expect(Buffer.from(await readSceneryFile(options)).toString()).toBe('locked model');
    await expect(readSceneryFile({ ...options, path: '../assets.lock.json' })).rejects.toThrow('file not locked');
    await expect(readSceneryFile({ ...options, assetId: 'missing' })).rejects.toThrow('asset not locked');
    writeFileSync(join(game, 'models/tree model.glb'), 'changed');
    await expect(readSceneryFile(options)).rejects.toThrow('hash mismatch');
  });

  it('rejects game and locked file symlinks that escape their roots', async () => {
    const { root, game, id, blobStore } = fixture();
    const outside = mkdtempSync(join(tmpdir(), 'ogm-scenery-outside-'));
    roots.push(outside);
    symlinkSync(outside, join(root, 'escape'));
    await expect(readScenerySource(root, 'escape')).rejects.toThrow('outside allowed');
    const source = await readScenerySource(root, 'games/fixture');
    rmSync(join(game, 'models/tree model.glb'));
    writeFileSync(join(outside, 'tree model.glb'), 'locked model');
    symlinkSync(join(outside, 'tree model.glb'), join(game, 'models/tree model.glb'));
    await expect(
      readSceneryFile({ root: source.root, lock: source.lock, assetId: id, path: 'models/tree model.glb', blobStore }),
    ).rejects.toThrow('outside allowed');
  });

  it('reads verified library and blob files referenced by the lock', async () => {
    const { root, id, blobStore } = fixture();
    const source = await readScenerySource(root, 'games/fixture');
    const entry = source.lock.assets[0]!;
    const libraryId = 't1:example/tree@1.0';
    const library = join(root, 'library');
    const extracted = join(library, 'packs/example/1.0/extracted/models');
    mkdirSync(extracted, { recursive: true });
    writeFileSync(join(extracted, 'tree model.glb'), 'locked model');
    const lock = { ...source.lock, assets: [{ ...entry, id: libraryId, source: 'library' as const }] };
    expect(
      Buffer.from(
        await readSceneryFile({
          root: source.root,
          lock,
          assetId: libraryId,
          path: entry.path,
          assetsRoot: library,
          blobStore,
        }),
      ).toString(),
    ).toBe('locked model');
    const blob = {
      open: async () => ({ ref: { bytes: 12 }, stream: Readable.from([Buffer.from('locked model')]) }),
    } as unknown as BlobStore;
    const blobLock = { ...source.lock, assets: [{ ...entry, source: 'blob' as const }] };
    expect(
      Buffer.from(
        await readSceneryFile({ root: source.root, lock: blobLock, assetId: id, path: entry.path, blobStore: blob }),
      ).toString(),
    ).toBe('locked model');
  });
});
