import { readFileSync } from 'node:fs';

import { migrate, openDb, schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { createAppEvents, type AppEventMap } from '../../src/app/events.js';
import {
  applyAiurEvent,
  applyAiurEvents,
  applyIssueSnapshot,
  applyProgress,
  type FeedRecord,
  type JobRef,
} from '../../src/jobs/projection.js';

const DAEMON = 'everdred-games-castle-run';
const JOB = 'j_142';

function setup(
  jobs: Record<string, JobRef> = { '142': { id: JOB, state: 'running' } },
  lifecycle?: NonNullable<Parameters<typeof applyAiurEvent>[0]['lifecycle']>,
) {
  const { sqlite, db } = openDb(':memory:');
  migrate({ sqlite });
  const events = createAppEvents();
  const changes: AppEventMap['job.stage.changed'][] = [];
  const usage: string[] = [];
  events.on('job.stage.changed', (event) => changes.push(event));
  events.on('job.usage.changed', (event) => usage.push(event.jobId));
  const deps = {
    db,
    events,
    jobs: { byTicket: (daemon: string, ticket: string) => (daemon === DAEMON ? (jobs[ticket] ?? null) : null) },
    ...(lifecycle ? { lifecycle } : {}),
    now: () => new Date('2026-11-01T03:12:10Z'),
  };
  const projection = () => db.select().from(schema.jobProjections).all();
  const cursor = () => db.select().from(schema.aiurCursors).get()?.lastSeq;
  const stored = () => db.select().from(schema.aiurEvents).all();
  return { deps, changes, usage, projection, cursor, stored };
}

function event(seq: number, topic: string, payload: Record<string, unknown>, refs = {}): FeedRecord {
  return { type: 'event', seq, topic, payload, refs, observed_at: '2026-11-01T03:12:09Z' };
}

describe('applyAiurEvent', () => {
  it('turns the OGM-030 fixture record (lifecycle running) into Building', () => {
    const { deps, projection, cursor, changes } = setup();
    const page = JSON.parse(
      readFileSync(new URL('../../../../packages/aiur-client/test/fixtures/events-page.json', import.meta.url), 'utf8'),
    ) as { records: (FeedRecord & { attrs: Record<string, unknown> })[] };
    const [record] = page.records.map((r) => ({ ...r, payload: r.attrs }));

    expect(applyAiurEvent(deps, DAEMON, record!)).toEqual({ applied: true, stage: 'building' });
    expect(projection()[0]).toMatchObject({ jobId: JOB, ticket: '142', stage: 'building', stageText: 'Building' });
    expect(projection()[0]?.lastEventSeq).toBe(11);
    expect(cursor()).toBe(11);
    expect(changes).toEqual([{ jobId: JOB, from: null, to: 'building', text: 'Building' }]);
  });

  it('applying the same seq twice stores one row and emits once', () => {
    const { deps, stored, changes } = setup();
    const record = event(812, 'ticket.142.lifecycle.changed', { lifecycle: 'running' });
    applyAiurEvent(deps, DAEMON, record);
    expect(applyAiurEvent(deps, DAEMON, record)).toEqual({ applied: false });
    expect(stored()).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });

  it('applies an out-of-order page in seq order, ending on the newest record', () => {
    const { deps, stored, projection } = setup();
    applyAiurEvents(deps, DAEMON, [
      event(5, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }),
      event(4, 'ticket.142.lifecycle.changed', { lifecycle: 'queued' }),
    ]);
    expect(stored().map((r) => r.seq)).toEqual([4, 5]);
    expect(projection()[0]).toMatchObject({ stage: 'building', lastEventSeq: 5 });
  });

  it('stores a late older record without rewinding the stage', () => {
    const { deps, stored, projection } = setup();
    applyAiurEvent(deps, DAEMON, event(5, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }));
    applyAiurEvent(deps, DAEMON, event(4, 'ticket.142.lifecycle.changed', { lifecycle: 'queued' }));
    expect(stored()).toHaveLength(2);
    expect(projection()[0]).toMatchObject({ stage: 'building', lastEventSeq: 5 });
  });

  it('stores a record for a ticket with no job and emits nothing', () => {
    const { deps, stored, projection, changes } = setup();
    expect(applyAiurEvent(deps, DAEMON, event(7, 'ticket.999.lifecycle.changed', { lifecycle: 'running' }))).toEqual({
      applied: true,
    });
    expect(stored()[0]).toMatchObject({ ticket: '999', jobId: null });
    expect(projection()).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('follows the worked sequence: the spend cap holds Out of budget through a later completed', () => {
    const { deps, projection, changes, usage } = setup();
    applyAiurEvent(deps, DAEMON, event(810, 'ticket.142.lifecycle.changed', { lifecycle: 'queued' }));
    applyAiurEvent(
      deps,
      DAEMON,
      event(812, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }, { job_id: 'run-9' }),
    );
    applyAiurEvent(deps, DAEMON, event(815, 'ticket.142.agent.progress', { phase: 'work', percent: 40 }));
    expect(projection()[0]).toMatchObject({
      stage: 'building',
      phase: 'work',
      progressPercent: 40,
      aiurRunId: 'run-9',
    });

    applyIssueSnapshot(deps, DAEMON, '142', { running: { state: 'agent:ci-wait', labels: ['agent:ci-wait'] } });
    expect(projection()[0]?.stage).toBe('final_tests');

    applyAiurEvent(
      deps,
      DAEMON,
      event(840, 'ticket.142.usage.spend_cap_reached', { spend_cap_state: 'budget_exhausted', currency: 'USD' }),
    );
    applyAiurEvent(deps, DAEMON, event(841, 'ticket.142.lifecycle.changed', { lifecycle: 'completed' }));
    expect(projection()[0]).toMatchObject({ stage: 'out_of_budget', stageText: 'Out of budget', lastEventSeq: 841 });
    expect(changes.map((c) => c.to)).toEqual(['waiting_capacity', 'building', 'final_tests', 'out_of_budget']);
    expect(usage).toEqual([JOB]);
  });

  it('marks an exited cancel.result Stopped', () => {
    const { deps, projection } = setup();
    applyAiurEvent(deps, DAEMON, event(3, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }));
    applyAiurEvent(
      deps,
      DAEMON,
      event(4, 'ticket.142.cancel.result', { tracker_state: 'cancelled', process_status: 'exited' }),
    );
    expect(projection()[0]).toMatchObject({ stage: 'cancelled', stageText: 'Stopped' });
  });

  it('advances the cursor on a gap record without storing an event', () => {
    const { deps, cursor, stored } = setup();
    applyAiurEvent(deps, DAEMON, { type: 'gap', seq: 30 });
    expect(cursor()).toBe(30);
    expect(stored()).toEqual([]);
  });

  it('applies each lifecycle transition to the jobs table seam before projecting it', () => {
    const jobs: Record<string, JobRef> = { '142': { id: JOB, state: 'filed' } };
    const calls: string[] = [];
    const { deps, projection } = setup(jobs, {
      markRunning(jobId) {
        calls.push(`run:${jobId}`);
        jobs['142'] = { id: jobId, state: 'running' };
      },
      markPaused(jobId, reason) {
        calls.push(`pause:${jobId}:${reason}`);
        jobs['142'] = { id: jobId, state: 'paused_budget' };
      },
      markTerminal(jobId, state) {
        calls.push(`terminal:${jobId}:${state}`);
        jobs['142'] = { id: jobId, state };
      },
    });

    applyAiurEvent(deps, DAEMON, event(1, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }));
    applyAiurEvent(deps, DAEMON, event(2, 'ticket.142.lifecycle.changed', { lifecycle: 'paused', reason: 'budget' }));
    applyAiurEvent(deps, DAEMON, event(3, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }));
    const completed = event(4, 'ticket.142.lifecycle.changed', { lifecycle: 'completed', lifecycle_source: 'tracker' });
    applyAiurEvent(deps, DAEMON, completed);
    applyAiurEvent(deps, DAEMON, completed);

    expect(calls).toEqual([`run:${JOB}`, `pause:${JOB}:budget_exhausted`, `run:${JOB}`, `terminal:${JOB}:done`]);
    expect(projection()[0]).toMatchObject({ stage: 'done', stageText: 'Done', lastEventSeq: 4 });
  });

  it('projects a creator pause without turning it into a budget pause', () => {
    const calls: string[] = [];
    const { deps, projection } = setup(undefined, {
      markRunning() {},
      markPaused(jobId, reason) {
        calls.push(`pause:${jobId}:${reason}`);
      },
      markTerminal() {},
    });

    applyAiurEvent(deps, DAEMON, event(1, 'ticket.142.lifecycle.changed', { lifecycle: 'paused', reason: 'admin' }));

    expect(calls).toEqual([]);
    expect(projection()[0]).toMatchObject({ stage: 'paused', stageText: 'Paused' });
  });
});

describe('applyIssueSnapshot', () => {
  it('shows friendly words for error, never aiur reason text', () => {
    const { deps, projection } = setup();
    const reason = 'codex exited 137: OOM killed in /work/142';
    applyIssueSnapshot(deps, DAEMON, '142', {
      retry: { state: 'agent:error', labels: ['agent:error'], error: reason } as never,
    });
    const row = projection()[0];
    expect(row?.stageText).toBe('Something went wrong');
    expect(row?.stageText).not.toContain(reason);
  });

  it('reads a paused-decision modifier as Waiting for your answer', () => {
    const { deps, projection } = setup();
    applyIssueSnapshot(deps, DAEMON, '142', {
      idle: { state: 'agent:in-progress', labels: ['agent:in-progress', 'agent:paused-decision'] },
    });
    expect(projection()[0]).toMatchObject({ stage: 'paused', stageText: 'Waiting for your answer' });
  });

  it('returns null for an issue with no job', () => {
    const { deps } = setup({});
    expect(applyIssueSnapshot(deps, DAEMON, '142', { running: { state: 'agent:ci-wait' } })).toBeNull();
  });
});

describe('applyProgress', () => {
  it('sets phase and percent without moving the stage', () => {
    const { deps, projection } = setup();
    applyAiurEvent(deps, DAEMON, event(1, 'ticket.142.lifecycle.changed', { lifecycle: 'running' }));
    applyProgress(deps, DAEMON, '142', {
      phase: { status: 'known', value: 'review' },
      progress: { status: 'known', percent: 70 },
    });
    expect(projection()[0]).toMatchObject({ stage: 'building', phase: 'review', progressPercent: 70 });
  });
});
