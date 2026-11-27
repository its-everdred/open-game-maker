import { homedir } from 'node:os';

import type { AiurClient } from '@ogm/aiur-client';
import { daemonPaths } from '@ogm/builder';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { createChatJobDirectory } from '../../src/build-chat/job-directory.js';
import { createDraftScopeAssistant } from '../../src/new-game/draft-assistant.js';
import { gameDrafts } from '../../src/new-game/drafts.js';
import { makeDeps } from '../helpers.js';

const NOW = '2026-11-01T00:00:00.000Z';

function insertJob(deps: ReturnType<typeof makeDeps>, id: string, state: 'queued' | 'running', ticket?: number): void {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId: 'g_1',
      branchId: 'main',
      familyId: 'f_1',
      creatorId: 'u_1',
      kind: 'feature',
      complexity: 1,
      state,
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Feature',
        summary: 'Build it',
        scope: { included: ['feature'], excluded: [] },
        tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['works'] }],
      }),
      reservation: '{"amountMicroUsd":500000,"sizeClass":"small","confidence":"low"}',
      hardCapMicroUsd: 500_000,
      aiurRepo: ticket === undefined ? null : 'owner/game',
      aiurIssueNumber: ticket ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

describe('build chat job directory', () => {
  it('maps job ownership and lists only active jobs with daemon tickets', async () => {
    const deps = makeDeps();
    deps.db.insert(schema.families).values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: NOW }).run();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g_1',
        familyId: 'f_1',
        ownerId: 'u_1',
        title: 'Game',
        // The game's slug keys its daemon.
        slug: 'owner-game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: NOW,
      })
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'owner-game',
        repo: 'owner/game',
        checkoutPath: '/games/owner-game',
        unit: 'ogm-aiur@owner-game.service',
        envFile: '/config/owner-game.env',
        port: 4101,
        status: 'running',
        createdAt: NOW,
      })
      .run();
    insertJob(deps, 'j_queued', 'queued');
    insertJob(deps, 'j_running', 'running', 142);

    const directory = createChatJobDirectory(deps.db);
    expect(await directory.get('j_running')).toEqual({
      jobId: 'j_running',
      gameId: 'g_1',
      familyId: 'f_1',
      ownerId: 'u_1',
      kind: 'feature',
      state: 'running',
      aiur: { daemonSlug: 'owner-game', ticket: '142' },
    });
    expect(await directory.get('j_queued')).toMatchObject({ aiur: null, ownerId: 'u_1' });
    expect(await directory.get('missing')).toBeNull();
    expect(await directory.active()).toEqual([await directory.get('j_running')]);
  });

  // #1270: Dusk Helm shares the open-games daemon (`blobs`) and has no row of its own. Its worker's replies arrive on
  // `blobs`, so the chat must address that daemon, or they never reach Dusk Helm's edit chat.
  it('addresses a game’s chat to the registered daemon its repository shares', async () => {
    const deps = makeDeps();
    deps.db.insert(schema.families).values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: NOW }).run();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g_1',
        familyId: 'f_1',
        ownerId: 'u_1',
        title: 'Dusk Helm',
        slug: 'dusk-helm',
        githubOwner: 'owner',
        githubRepo: 'open-games',
        visibility: 'private',
        repoVisibility: 'public',
        createdAt: NOW,
      })
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'blobs',
        repo: 'owner/open-games',
        checkoutPath: '/games/open-games',
        unit: 'aiur-main@open-games',
        envFile: '/games/open-games/.aiur/config',
        port: 4011,
        status: 'running',
        createdAt: NOW,
      })
      .run();
    insertJob(deps, 'j_running', 'running', 7);

    const directory = createChatJobDirectory(deps.db);
    expect(await directory.get('j_running')).toMatchObject({ aiur: { daemonSlug: 'blobs', ticket: '7' } });
    expect(await directory.active()).toEqual([await directory.get('j_running')]);
  });

  it('resolves draft scope chats through the shared daemon without a game row', async () => {
    const deps = makeDeps();
    deps.db.insert(schema.families).values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: NOW }).run();
    const draft = gameDrafts.create(deps.db, {
      familyId: 'f_1',
      creatorId: 'u_1',
      choices: {
        genre: 'platformer',
        vibe: 'cozy',
        family: 'pixel',
        world: 'island',
        players: 'single',
        pov: 'isometric',
      },
      allowAiGeneratedAssets: true,
      at: new Date(NOW),
    });
    gameDrafts.attachTicket(deps.db, draft.id, 'owner/instance', 143, NOW);
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'instance-daemon',
        repo: 'owner/instance',
        checkoutPath: '/games/instance',
        unit: 'instance',
        envFile: '/config/instance',
        port: 4101,
        status: 'running',
        createdAt: NOW,
      })
      .run();

    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'other-daemon',
        repo: 'owner/instance',
        checkoutPath: daemonPaths(homedir(), 'other-daemon').dir,
        unit: 'other',
        envFile: '/config/other',
        port: 4102,
        status: 'running',
        createdAt: '2026-11-02T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'core',
        repo: 'owner/instance',
        checkoutPath: '/games/core',
        unit: 'core',
        envFile: '/config/core',
        port: 4103,
        status: 'running',
        createdAt: '2026-10-01T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'unrelated',
        repo: 'owner/other',
        checkoutPath: '/games/unrelated',
        unit: 'unrelated',
        envFile: '/config/unrelated',
        port: 4104,
        status: 'running',
        createdAt: '2026-09-01T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'managed',
        repo: 'owner/instance',
        checkoutPath: daemonPaths(homedir(), 'managed').dir,
        unit: 'managed',
        envFile: '/config/managed',
        port: 4105,
        status: 'stopped',
        createdAt: '2026-08-01T00:00:00.000Z',
      })
      .run();
    const ticketTranscript = vi.fn(async () => ({ events: [] }));
    const enqueueTodo = vi.fn(async () => undefined);
    const clientForSlug = vi.fn(async (slug: string) =>
      slug === 'instance-daemon' ? ({ enqueueTodo, ticketTranscript } as unknown as AiurClient) : null,
    );
    const issues = {
      ensureLabel: vi.fn(async () => undefined),
      findByMarkers: vi.fn(async () => ({ number: 143, url: 'https://example.test/143' })),
      create: vi.fn(),
      close: vi.fn(),
    };
    const assistant = createDraftScopeAssistant({ db: deps.db, repo: 'owner/instance', issues, clientForSlug });
    await assistant.create({ draftId: draft.id, choices: JSON.parse(draft.choices) });
    expect(clientForSlug).toHaveBeenCalledWith('instance-daemon');
    expect(enqueueTodo).toHaveBeenCalledWith(['143']);
    expect(issues.findByMarkers).toHaveBeenCalledWith('owner/instance', draft.id, 'scope');
    await assistant.transcript({ repo: 'owner/instance', ticket: '143' });
    expect(ticketTranscript).toHaveBeenCalledWith('143');
    expect(clientForSlug).toHaveBeenLastCalledWith('instance-daemon');

    const directory = createChatJobDirectory(deps.db);
    expect(await directory.get(`draft:${draft.id}`)).toEqual({
      jobId: `draft:${draft.id}`,
      gameId: draft.id,
      familyId: 'f_1',
      ownerId: 'u_1',
      kind: 'scope',
      state: 'running',
      aiur: { daemonSlug: 'instance-daemon', ticket: '143' },
    });
    expect(await directory.active()).toEqual([await directory.get(`draft:${draft.id}`)]);
    deps.db
      .update(schema.gameDaemons)
      .set({ checkoutPath: '/games/other' })
      .where(eq(schema.gameDaemons.slug, 'other-daemon'))
      .run();
    expect(await directory.get(`draft:${draft.id}`)).toMatchObject({ aiur: null });
    await expect(assistant.create({ draftId: draft.id, choices: JSON.parse(draft.choices) })).rejects.toThrow(
      'shared_aiur_unavailable',
    );
    deps.db.update(schema.gameDaemons).set({ repo: 'owner/other' }).run();
    expect(await directory.get(`draft:${draft.id}`)).toMatchObject({ aiur: null });
    expect(await directory.active()).toMatchObject([{ aiur: null }]);
    expect(deps.db.select().from(schema.games).all()).toEqual([]);
  });
});
