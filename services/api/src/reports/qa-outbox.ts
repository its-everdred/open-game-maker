import { schema } from '@ogm/db';
import type { IssueWriter } from '@ogm/contracts';
import { and, asc, eq, isNull, like, lte, or, sql } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { CommitServiceIssueWriter } from './issue-writer.js';
import { notifyQaIssue } from './qa-delivery.js';

const LEASE_MS = 120_000;

/** Deliver one stored report. The issue reference is persisted before notification is attempted. */
export async function deliverQaReport(
  deps: AppDeps,
  writer: IssueWriter = new CommitServiceIssueWriter({
    baseUrl: deps.config.commitInternalUrl,
    token: deps.config.commitServiceToken,
  }),
): Promise<boolean> {
  const unfiled = deps.db
    .select()
    .from(schema.platformIssueQueue)
    .where(
      and(
        eq(schema.platformIssueQueue.status, 'pending'),
        like(schema.platformIssueQueue.id, 'qa_%'),
        or(
          isNull(schema.platformIssueQueue.ref),
          and(
            like(schema.platformIssueQueue.ref, 'claim:%'),
            sql`CAST(substr(${schema.platformIssueQueue.ref}, 7) AS INTEGER) < ${Date.now() - LEASE_MS}`,
          ),
        ),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${schema.platformIssueQueue.ref} IS NULL THEN 0 ELSE 1 END`,
      asc(schema.platformIssueQueue.createdAt),
    )
    .get();
  const row =
    unfiled ??
    (deps.registry.coreAiurClient === null
      ? undefined
      : deps.db
          .select()
          .from(schema.platformIssueQueue)
          .where(
            and(
              eq(schema.platformIssueQueue.status, 'pending'),
              like(schema.platformIssueQueue.id, 'qa_%'),
              like(schema.platformIssueQueue.ref, 'issue:%'),
              or(
                isNull(schema.platformIssueQueue.nextAttemptAt),
                lte(schema.platformIssueQueue.nextAttemptAt, Date.now()),
              ),
            ),
          )
          .orderBy(asc(schema.platformIssueQueue.nextAttemptAt), asc(schema.platformIssueQueue.createdAt))
          .get());
  if (!row) return false;
  const reportId = row.id.slice(3);
  const report = deps.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get();
  if (!report) {
    deps.db
      .update(schema.platformIssueQueue)
      .set({ status: 'dismissed' })
      .where(eq(schema.platformIssueQueue.id, row.id))
      .run();
    return true;
  }
  let ref = row.ref;
  if (!ref || ref.startsWith('claim:')) {
    const reconcile = ref !== null;
    const claim = `claim:${Date.now()}`;
    const changed = deps.db
      .update(schema.platformIssueQueue)
      .set({ ref: claim })
      .where(
        and(
          eq(schema.platformIssueQueue.id, row.id),
          eq(schema.platformIssueQueue.status, 'pending'),
          ref === null ? isNull(schema.platformIssueQueue.ref) : eq(schema.platformIssueQueue.ref, ref),
        ),
      )
      .run().changes;
    if (!changed) return true;
    try {
      const filed = await writer.file({
        gameId: report.gameId,
        title: row.title,
        body: row.body,
        labels: JSON.parse(row.labelsJson) as string[],
        idempotencyKey: reportId,
        ...(reconcile ? { reconcile: true } : {}),
      });
      ref = filed.ref;
      const saved = deps.db
        .update(schema.platformIssueQueue)
        .set({ ref })
        .where(and(eq(schema.platformIssueQueue.id, row.id), eq(schema.platformIssueQueue.ref, claim)))
        .run().changes;
      if (!saved) return true;
    } catch {
      deps.log({ event: 'qa-report-issue-failed', reportId });
      return true;
    }
  }
  const client = deps.registry.coreAiurClient;
  if (!client) return true;
  try {
    // The commit service resolves game issues to the instance repository, regardless of legacy game repo fields.
    const repository = `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`;
    await notifyQaIssue(client, { reportId, gameId: report.gameId, repository, ref });
    deps.db
      .update(schema.platformIssueQueue)
      .set({ status: 'filed' })
      .where(and(eq(schema.platformIssueQueue.id, row.id), eq(schema.platformIssueQueue.ref, ref)))
      .run();
  } catch {
    deps.db
      .update(schema.platformIssueQueue)
      .set({ nextAttemptAt: Date.now() + 60_000 })
      .where(and(eq(schema.platformIssueQueue.id, row.id), eq(schema.platformIssueQueue.ref, ref)))
      .run();
    deps.log({ event: 'qa-report-notify-failed', reportId });
  }
  return true;
}

export function startQaReportDelivery(deps: AppDeps) {
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (pending) return;
    pending = deliverQaReport(deps)
      .then(
        () => {},
        () => {
          deps.log({ event: 'qa-report-delivery-failed' });
        },
      )
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, 10_000);
  tick();
  return { stop: () => clearInterval(timer), idle: () => pending ?? Promise.resolve() };
}
