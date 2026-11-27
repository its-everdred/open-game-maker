import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  applyAiurEvent,
  applyIssueSnapshot,
  applyTerminalSnapshot,
  reconcileFiledTickets,
  type FeedRecord,
} from '../../src/jobs/projection.js';
import { byTicket } from '../../src/jobs/repo.js';
import { createTicketRecovery, resetTicketSequences } from '../../src/jobs/ticket-recovery.js';
import { makeDeps } from '../helpers.js';

function setup() {
  const deps = makeDeps();
  const at = '2026-11-01T00:00:00.000Z';
  deps.db.insert(schema.families).values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: at }).run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'g_1',
      familyId: 'f_1',
      ownerId: 'u_1',
      title: 'Game',
      slug: 'game',
      visibility: 'private',
      repoVisibility: 'private',
      githubOwner: 'owner',
      githubRepo: 'game',
      createdAt: at,
    })
    .run();
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'game',
      repo: 'owner/game',
      checkoutPath: '/game',
      unit: 'game',
      envFile: '/env',
      port: 4101,
      status: 'running',
      maxConcurrentAgents: 1,
      createdAt: at,
    })
    .run();
  deps.db
    .insert(schema.jobs)
    .values({
      id: 'j_1',
      gameId: 'g_1',
      branchId: 'main',
      familyId: 'f_1',
      creatorId: 'u_1',
      kind: 'feature',
      complexity: 1,
      state: 'running',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Feature',
        summary: 'Build it',
        scope: { included: [], excluded: [] },
        tickets: [
          { key: 'first', skills: [], dependsOn: [], acceptanceCriteria: [] },
          { key: 'second', skills: [], dependsOn: ['first'], acceptanceCriteria: [] },
        ],
      }),
      reservation: '{"amountMicroUsd":1,"sizeClass":"small","confidence":"low"}',
      hardCapMicroUsd: 1,
      aiurRepo: 'owner/game',
      aiurIssueNumber: 10,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  deps.db
    .insert(schema.jobTickets)
    .values([
      { jobId: 'j_1', key: 'first', issueNumber: 10, repo: 'owner/game', sig: 'one', filedAt: at },
      { jobId: 'j_1', key: 'second', issueNumber: 11, repo: 'owner/game', sig: 'two', filedAt: at },
    ])
    .run();
  const transitions: string[] = [];
  const projection = {
    db: deps.db,
    events: deps.events,
    jobs: { byTicket: (daemon: string, ticket: string) => byTicket(deps.db, daemon, ticket) },
    lifecycle: {
      markRunning() {},
      markPaused() {},
      markTerminal(jobId: string, state: 'done' | 'failed' | 'cancelled') {
        transitions.push(state);
        deps.db.update(schema.jobs).set({ state }).where(eq(schema.jobs.id, jobId)).run();
      },
    },
  };
  return { deps, projection, transitions };
}

function completed(seq: number, ticket: number): FeedRecord {
  return {
    type: 'event',
    seq,
    topic: `ticket.${ticket}.lifecycle.changed`,
    observed_at: '2026-11-01T00:00:00.000Z',
    payload: { lifecycle: 'completed', lifecycle_source: 'tracker' },
  };
}

describe('multi-ticket job lifecycle', () => {
  it('records completions that arrive during filing and finalizes after filing', () => {
    const { deps, projection, transitions } = setup();
    deps.db
      .update(schema.jobs)
      .set({ state: 'admitted', aiurIssueNumber: null })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    applyAiurEvent(projection, 'game', completed(1, 10));
    applyAiurEvent(projection, 'game', completed(2, 11));
    expect(transitions).toEqual([]);
    expect(deps.db.select().from(schema.jobProjections).get()?.lifecycle).toBe('waiting');
    expect(
      deps.db
        .select()
        .from(schema.jobTickets)
        .all()
        .map((row) => row.terminalState),
    ).toEqual(['done', 'done']);
    deps.db.update(schema.jobs).set({ state: 'filed', aiurIssueNumber: 10 }).where(eq(schema.jobs.id, 'j_1')).run();
    reconcileFiledTickets(projection, 'game', '10');
    expect(transitions).toEqual(['done']);
  });
  it('does not show the job as done when a single child snapshot is done', () => {
    const { deps, projection } = setup();
    applyIssueSnapshot(projection, 'game', '10', { idle: { state: 'done', labels: [] } });
    expect(deps.db.select().from(schema.jobProjections).get()?.stage).not.toBe('done');
  });
  it('records ticket termination after the job was already cancelled', () => {
    const { deps, projection, transitions } = setup();
    deps.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.id, 'j_1')).run();
    applyAiurEvent(projection, 'game', { ...completed(1, 10), payload: { lifecycle: 'cancelled' } });
    expect(
      deps.db.select().from(schema.jobTickets).where(eq(schema.jobTickets.issueNumber, 10)).get()?.terminalState,
    ).toBe('cancelled');
    expect(transitions).toEqual([]);
  });
  it('does not confuse migrated history with a live epoch named legacy', () => {
    const { deps, projection } = setup();
    deps.db
      .insert(schema.aiurCursors)
      .values({ daemonSlug: 'game', lastSeq: 0, epoch: 'legacy', updatedAt: 'now' })
      .run();
    deps.db
      .insert(schema.aiurEvents)
      .values({
        daemonSlug: 'game',
        epoch: 'legacy',
        seq: 1,
        topic: 'ticket.10.lifecycle.changed',
        ticket: '10',
        jobId: 'j_1',
        payload: '{}',
        observedAt: 'now',
      })
      .run();

    expect(applyAiurEvent(projection, 'game', completed(1, 11)).applied).toBe(true);
    expect(deps.db.select().from(schema.aiurEvents).all()).toHaveLength(2);
  });
  it('holds the job until every ticket is terminal', () => {
    const { deps, projection, transitions } = setup();
    expect(byTicket(deps.db, 'game', '11')).toEqual({ id: 'j_1', state: 'running' });
    applyAiurEvent(projection, 'game', completed(1, 10));
    expect(transitions).toEqual([]);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('running');
    expect(deps.db.select().from(schema.jobProjections).get()?.lifecycle).not.toBe('completed');
    applyAiurEvent(projection, 'game', completed(2, 11));
    expect(transitions).toEqual(['done']);
  });
  it('waits for tracker confirmation after a worker reports completion', () => {
    const { deps, projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(1, 10));
    applyAiurEvent(projection, 'game', {
      ...completed(2, 11),
      payload: { lifecycle: 'completed', lifecycle_source: 'status_report' },
    });
    expect(transitions).toEqual([]);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('running');
    applyAiurEvent(projection, 'game', completed(3, 11));
    expect(transitions).toEqual(['done']);
    applyAiurEvent(projection, 'game', {
      ...completed(4, 11),
      payload: { lifecycle: 'completed', lifecycle_source: 'status_report' },
    });
    expect(
      deps.db.select().from(schema.jobTickets).where(eq(schema.jobTickets.issueNumber, 11)).get()?.terminalState,
    ).toBe('done');
  });
  it('resets the sequence fence of a ticket filed before job admission completes', () => {
    const { deps, projection, transitions } = setup();
    deps.db
      .update(schema.jobs)
      .set({ state: 'admitted', aiurIssueNumber: null })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    applyAiurEvent(projection, 'game', { ...completed(100, 10), payload: { lifecycle: 'running' } });
    resetTicketSequences(deps.db, 'game');
    applyAiurEvent(projection, 'game', completed(1, 10));
    expect(
      deps.db.select().from(schema.jobTickets).where(eq(schema.jobTickets.issueNumber, 10)).get()?.terminalState,
    ).toBe('done');
    expect(transitions).toEqual([]);
  });
  it('keeps separate ticket ordering when an older event arrives late', () => {
    const { deps, projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(2, 11));
    expect(transitions).toEqual([]);
    applyAiurEvent(projection, 'game', completed(1, 10));
    expect(transitions).toEqual(['done']);
    expect(deps.db.select().from(schema.jobProjections).get()?.stage).toBe('done');
  });
  it('does not release a job when only one ticket is cancelled', () => {
    const { projection, transitions } = setup();
    const cancelled = {
      ...completed(1, 10),
      payload: { lifecycle: 'cancelled', lifecycle_source: 'tracker' },
    } as FeedRecord;
    applyAiurEvent(projection, 'game', cancelled);
    expect(transitions).toEqual([]);
    applyAiurEvent(projection, 'game', completed(2, 11));
    expect(transitions).toEqual(['cancelled']);
  });
  it('recovers a missed terminal event from a verified tracker snapshot', () => {
    const { projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(1, 10));
    applyTerminalSnapshot(projection, 'game', '11', 'done');
    expect(transitions).toEqual(['done']);
  });
  it('recovers a missing ticket only after the tracker confirms its terminal label', async () => {
    const { projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(1, 10));
    const notDone = createTicketRecovery(projection, async () => ['agent:todo']);
    await notDone('game', '11');
    expect(transitions).toEqual([]);
    const done = createTicketRecovery(projection, async () => ['agent:done']);
    await done('game', '11');
    expect(transitions).toEqual(['done']);
  });
  it('uses the recorded ticket repository when filing has not recorded the job repository', async () => {
    const { deps, projection } = setup();
    deps.db.update(schema.jobs).set({ aiurRepo: null, state: 'paused_budget' }).where(eq(schema.jobs.id, 'j_1')).run();
    const labels = vi.fn().mockResolvedValue(['agent:done']);
    await createTicketRecovery(projection, labels)('game', '10');
    expect(labels).toHaveBeenCalledWith('owner/game', 10);
    expect(
      deps.db.select().from(schema.jobTickets).where(eq(schema.jobTickets.issueNumber, 10)).get()?.terminalState,
    ).toBe('done');
  });
  it('does not trust conflicting tracker states or a snapshot overtaken by a feed event', async () => {
    const { deps, projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(1, 10));
    const conflicting = createTicketRecovery(projection, async () => ['agent:done', 'agent:todo']);
    await conflicting('game', '11');
    expect(transitions).toEqual([]);
    const overtaken = createTicketRecovery(projection, async () => {
      deps.db.update(schema.aiurCursors).set({ lastSeq: 2 }).where(eq(schema.aiurCursors.daemonSlug, 'game')).run();
      return ['agent:done'];
    });
    await overtaken('game', '11');
    expect(transitions).toEqual([]);
  });
  it('does not let an older feed event undo a tracker-confirmed terminal state', async () => {
    const { deps, projection, transitions } = setup();
    deps.db
      .insert(schema.aiurCursors)
      .values({ daemonSlug: 'game', lastSeq: 100, epoch: null, updatedAt: 'now' })
      .run();
    const done = createTicketRecovery(projection, async () => ['agent:done']);
    await done('game', '10');
    const stale = {
      ...completed(50, 10),
      payload: { lifecycle: 'running', lifecycle_source: 'tracker' },
    } as FeedRecord;
    applyAiurEvent(projection, 'game', stale);
    await done('game', '11');
    expect(transitions).toEqual(['done']);
  });
  it('accepts lower event sequence numbers after a feed epoch reset', () => {
    const { deps, projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(100, 10));
    resetTicketSequences(deps.db, 'game');
    applyAiurEvent(projection, 'game', completed(1, 11));
    expect(transitions).toEqual(['done']);
  });
  it('does not discard an event when a new feed epoch reuses its sequence', () => {
    const { deps, projection, transitions } = setup();
    applyAiurEvent(projection, 'game', completed(1, 10));
    deps.db
      .update(schema.aiurCursors)
      .set({ epoch: 'new-epoch' })
      .where(eq(schema.aiurCursors.daemonSlug, 'game'))
      .run();
    resetTicketSequences(deps.db, 'game');
    applyAiurEvent(projection, 'game', completed(1, 11));
    expect(transitions).toEqual(['done']);
  });
});
