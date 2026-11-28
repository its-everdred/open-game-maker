import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

import { deliverQaReport } from '../src/reports/qa-outbox.js';
import { recordReport } from '../src/reports/store.js';
import { makeDeps } from './helpers.js';
import { crash, ids } from './reports-helpers.js';

function queuedReport() {
  const deps = makeDeps();
  const at = new Date('2026-11-01T16:00:00.000Z');
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.owner, createdAt: at.toISOString() })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.owner,
      title: 'Game',
      visibility: 'listed',
      repoVisibility: 'private',
      createdAt: at.toISOString(),
    })
    .run();
  const { report } = recordReport(deps, {
    body: crash(),
    reporterId: ids.player,
    now: at,
    qaOrigin: deps.config.appOrigin,
  });
  return { deps, reportId: report.id };
}

it('does not publish an unverified client-supplied build value', () => {
  const { deps } = queuedReport();
  const report = deps.db.select().from(schema.reports).get()!;
  const issue = deps.db.select().from(schema.platformIssueQueue).get()!;
  expect(issue.body).not.toContain(report.buildHash);
});

it('files the stored player report once and retries a failed Executor notification', async () => {
  const { deps, reportId } = queuedReport();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  const file = vi.fn().mockResolvedValue({ ref: 'issue:42' });
  const sendExecutorThreadMessage = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  deps.registry.coreAiurClient = { sendExecutorThreadMessage } as unknown as AiurClient;
  await deliverQaReport(deps, { file });
  expect(deps.db.select().from(schema.platformIssueQueue).get()).toMatchObject({ status: 'pending', ref: 'issue:42' });
  now.mockReturnValue(1_060_001);
  await deliverQaReport(deps, { file });
  expect(file).toHaveBeenCalledOnce();
  expect(file).toHaveBeenCalledWith(expect.objectContaining({ gameId: ids.game, labels: ['needs-triage'] }));
  expect(sendExecutorThreadMessage).toHaveBeenCalledTimes(2);
  expect(deps.db.select().from(schema.platformIssueQueue).get()).toMatchObject({ status: 'filed', ref: 'issue:42' });
  expect(sendExecutorThreadMessage.mock.calls[1]?.[0].client_request_id).toBe(`qa-report:${reportId}`);
  now.mockRestore();
});

it('continues notifying later reports when an earlier notification fails', async () => {
  const { deps, reportId } = queuedReport();
  const second = recordReport(deps, {
    body: crash(),
    reporterId: ids.player,
    now: new Date('2026-11-01T16:00:01.000Z'),
    qaOrigin: deps.config.appOrigin,
  }).report;
  deps.db
    .update(schema.platformIssueQueue)
    .set({ ref: 'issue:41' })
    .where(eq(schema.platformIssueQueue.id, `qa_${reportId}`))
    .run();
  deps.db
    .update(schema.platformIssueQueue)
    .set({ ref: 'issue:42' })
    .where(eq(schema.platformIssueQueue.id, `qa_${second.id}`))
    .run();
  const file = vi.fn();
  const sendExecutorThreadMessage = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  deps.registry.coreAiurClient = { sendExecutorThreadMessage } as unknown as AiurClient;
  await deliverQaReport(deps, { file });
  await deliverQaReport(deps, { file });
  expect(sendExecutorThreadMessage.mock.calls.map(([message]) => message.client_request_id)).toEqual([
    `qa-report:${reportId}`,
    `qa-report:${second.id}`,
  ]);
});

it('prioritizes never-attempted notifications over due retries', async () => {
  const { deps, reportId } = queuedReport();
  const second = recordReport(deps, {
    body: crash(),
    reporterId: ids.player,
    now: new Date('2026-11-01T16:00:01.000Z'),
    qaOrigin: deps.config.appOrigin,
  }).report;
  deps.db
    .update(schema.platformIssueQueue)
    .set({ ref: 'issue:41', nextAttemptAt: 1 })
    .where(eq(schema.platformIssueQueue.id, `qa_${reportId}`))
    .run();
  deps.db
    .update(schema.platformIssueQueue)
    .set({ ref: 'issue:42' })
    .where(eq(schema.platformIssueQueue.id, `qa_${second.id}`))
    .run();
  const sendExecutorThreadMessage = vi.fn().mockResolvedValue({});
  deps.registry.coreAiurClient = { sendExecutorThreadMessage } as unknown as AiurClient;
  await deliverQaReport(deps, { file: vi.fn() });
  expect(sendExecutorThreadMessage.mock.calls[0]?.[0].client_request_id).toBe(`qa-report:${second.id}`);
});

it('prioritizes unclaimed reports over expired claims', async () => {
  const { deps, reportId } = queuedReport();
  const second = recordReport(deps, {
    body: crash(),
    reporterId: ids.player,
    now: new Date('2026-11-01T16:00:01.000Z'),
    qaOrigin: deps.config.appOrigin,
  }).report;
  deps.db
    .update(schema.platformIssueQueue)
    .set({ ref: 'claim:1' })
    .where(eq(schema.platformIssueQueue.id, `qa_${reportId}`))
    .run();
  const file = vi.fn().mockResolvedValue({ ref: 'issue:42' });
  await deliverQaReport(deps, { file });
  expect(file.mock.calls[0]?.[0].idempotencyKey).toBe(second.id);
});

it('keeps an issue pending when the commit service refuses it', async () => {
  const { deps } = queuedReport();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  const file = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ ref: 'issue:43' });
  await deliverQaReport(deps, { file });
  expect(deps.db.select().from(schema.platformIssueQueue).get()).toMatchObject({
    status: 'pending',
    ref: 'claim:1000000',
  });
  now.mockReturnValue(1_120_001);
  await deliverQaReport(deps, { file });
  expect(file).toHaveBeenCalledTimes(2);
  expect(file.mock.calls[1]?.[0]).toMatchObject({ reconcile: true });
  expect(deps.db.select().from(schema.platformIssueQueue).get()).toMatchObject({ status: 'pending', ref: 'issue:43' });
  now.mockRestore();
});

it('claims a report before filing so concurrent workers do not both file it', async () => {
  const { deps } = queuedReport();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const file = vi.fn(async () => {
    await held;
    return { ref: 'issue:44' };
  });
  const first = deliverQaReport(deps, { file });
  await vi.waitFor(() => expect(file).toHaveBeenCalledOnce());
  await deliverQaReport(deps, { file });
  release();
  await first;
  expect(file).toHaveBeenCalledOnce();
});
