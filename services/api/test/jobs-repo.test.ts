import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { acceptedFor, activeJobs, activeJobsForSlug, byTicket, findJob, findJobRow } from '../src/jobs/repo.js';
import { creatorHoldsSlot } from '../src/jobs/creator-slot.js';
import { makeDeps } from './helpers.js';

function setup() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: '2026-11-01T00:00:00.000Z' })
    .run();
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
      githubOwner: 'Owner',
      githubRepo: 'Game',
      repoVisibility: 'private',
      createdAt: '2026-11-01T00:00:00.000Z',
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
      maxConcurrentAgents: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
    })
    .run();
  return deps;
}

function insertJob(
  deps: ReturnType<typeof makeDeps>,
  id: string,
  issueNumber: number,
  state: 'queued' | 'admitted' | 'running' | 'paused_budget' | 'cancelled' | 'done',
  releasedAt: string | null = null,
  gameId = 'g_1',
) {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId,
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
      aiurRepo: state === 'admitted' ? null : 'owner/game',
      aiurIssueNumber: state === 'admitted' ? null : issueNumber,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      terminalAt: state === 'done' ? '2026-11-01T01:00:00.000Z' : null,
      releasedAt,
    })
    .run();
}

describe('job projection directory', () => {
  it('does not keep a completed New Game parent in the active directory', () => {
    const deps = setup();
    insertJob(deps, 'j_parent', 143, 'done', '2026-11-01T01:00:00.000Z');
    deps.db.update(schema.jobs).set({ kind: 'new_game' }).where(eq(schema.jobs.id, 'j_parent')).run();
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game', issueNumber: 143, repo: 'owner/game', sig: 'sig' })
      .run();
    expect(activeJobs(deps.db, 'owner-game')).toEqual([]);
    expect(activeJobsForSlug(deps.db, 'owner-game')).toEqual([]);
    expect(creatorHoldsSlot(deps.db, 'u_1', 1)).toBe(false);
  });
  it('continues tracking a cancelled job until its ticket is terminal', () => {
    const deps = setup();
    insertJob(deps, 'j_cancelled', 144, 'cancelled', '2026-11-01T01:00:00.000Z');
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_cancelled', key: 'T1', issueNumber: 144, repo: 'owner/game', sig: 'sig' })
      .run();
    expect(activeJobs(deps.db, 'owner-game')).toEqual([{ jobId: 'j_cancelled', ticket: '144' }]);
    expect(activeJobsForSlug(deps.db, 'owner-game')).toEqual([{ kind: 'feature' }]);
  });
  it('continues tracking a released job while a ticket is nonterminal', () => {
    const deps = setup();
    insertJob(deps, 'j_released_live', 144, 'paused_budget', '2026-11-01T01:00:00.000Z');
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_released_live', key: 'T1', issueNumber: 144, repo: 'owner/game', sig: 'sig' })
      .run();
    expect(activeJobs(deps.db, 'owner-game')).toEqual([{ jobId: 'j_released_live', ticket: '144' }]);
    expect(activeJobsForSlug(deps.db, 'owner-game')).toEqual([{ kind: 'feature' }]);
  });
  it('lists every ticket of a live job for resynchronization', () => {
    const deps = setup();
    insertJob(deps, 'j_multi', 141, 'running');
    deps.db
      .insert(schema.jobTickets)
      .values([
        { jobId: 'j_multi', key: 'first', issueNumber: 141, repo: 'owner/game', sig: 'one' },
        { jobId: 'j_multi', key: 'second', issueNumber: 142, repo: 'owner/game', sig: 'two' },
      ])
      .run();

    expect(activeJobs(deps.db, 'owner-game')).toEqual([
      { jobId: 'j_multi', ticket: '141' },
      { jobId: 'j_multi', ticket: '142' },
    ]);
  });
  it('counts overdue reset jobs ahead of an immediate job but excludes future reset jobs', () => {
    const deps = setup();
    insertJob(deps, 'j_due', 1, 'queued');
    insertJob(deps, 'j_future', 2, 'queued');
    insertJob(deps, 'j_now', 3, 'queued');
    deps.db
      .update(schema.jobs)
      .set({ start: 'at_reset', startAt: '2000-01-01T00:00:00.000Z' })
      .where(eq(schema.jobs.id, 'j_due'))
      .run();
    deps.db
      .update(schema.jobs)
      .set({ start: 'at_reset', startAt: '2099-01-01T00:00:00.000Z' })
      .where(eq(schema.jobs.id, 'j_future'))
      .run();

    expect(findJob(deps.db, 'j_due').position).toBe(1);
    expect(findJob(deps.db, 'j_now').position).toBe(2);
    expect(acceptedFor(deps.db, findJobRow(deps.db, 'j_now'), new Date('1999-01-01T00:00:00.000Z')).position).toBe(1);
  });
  it('resolves daemon tickets and lists only non-terminal jobs', () => {
    const deps = setup();
    insertJob(deps, 'j_queued', 141, 'queued');
    insertJob(deps, 'j_admitted', 0, 'admitted');
    insertJob(deps, 'j_running', 142, 'running');
    insertJob(deps, 'j_done', 143, 'done');
    insertJob(deps, 'j_released', 144, 'running', '2026-11-01T01:00:00.000Z');

    expect(byTicket(deps.db, 'owner-game', '142')).toEqual({ id: 'j_running', state: 'running' });
    expect(byTicket(deps.db, 'other-game', '142')).toBeNull();
    expect(byTicket(deps.db, 'owner-game', 'not-a-ticket')).toBeNull();
    expect(activeJobs(deps.db, 'owner-game')).toEqual([
      { jobId: 'j_queued', ticket: '141' },
      { jobId: 'j_running', ticket: '142' },
    ]);
    expect(activeJobsForSlug(deps.db, 'OWNER-GAME')).toEqual([{ kind: 'feature' }, { kind: 'feature' }]);
  });

  // #1270: Dusk Helm was registered into the open-games repository and shares its daemon (`blobs`), with no daemon
  // row of its own. The worker's replies arrive on that daemon's feed and must still reach Dusk Helm's job chat.
  it('maps a shared daemon’s tickets to the jobs of every game that shares it', () => {
    const deps = setup();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g_2',
        familyId: 'f_1',
        ownerId: 'u_1',
        title: 'Dusk Helm',
        slug: 'dusk-helm',
        visibility: 'private',
        githubOwner: 'Owner',
        githubRepo: 'Game',
        repoVisibility: 'private',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    insertJob(deps, 'j_owner', 150, 'running');
    insertJob(deps, 'j_dusk', 151, 'running', null, 'g_2');

    expect(byTicket(deps.db, 'owner-game', '151')).toEqual({ id: 'j_dusk', state: 'running' });
    expect(activeJobs(deps.db, 'owner-game')).toEqual([
      { jobId: 'j_owner', ticket: '150' },
      { jobId: 'j_dusk', ticket: '151' },
    ]);
  });
});
