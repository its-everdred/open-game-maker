import { randomUUID } from 'node:crypto';

import type { CompleteTriage, CreateReport, ReportRoute, TriageResult } from '@ogm/contracts';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { and, asc, desc, eq, inArray, isNull, lte, ne, notLike, or, sql } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { classify, type Classification } from './classify.js';
import { signature, textSignature, type SignatureScope } from './signature.js';
import { qaIssue } from './qa-delivery.js';

export type ReportRow = typeof schema.reports.$inferSelect;
export type SignatureRow = typeof schema.reportSignatures.$inferSelect;

export type Intake = {
  report: ReportRow;
  signature: SignatureRow;
  classification: Classification;
  duplicate?: boolean;
};

// Classify and record in one immediate transaction, so concurrent reports see each other's counts.
export function recordReport(
  deps: { db: Db; sqlite: Sqlite },
  input: { body: CreateReport; reporterId: string; now: Date; qaOrigin?: string },
): Intake {
  const { db } = deps;
  const { body } = input;
  const at = input.now.toISOString();
  return deps.sqlite
    .transaction(() => {
      if (body.requestKey) {
        const existing = db
          .select()
          .from(schema.reports)
          .where(
            and(
              eq(schema.reports.gameId, body.gameId),
              eq(schema.reports.reporterId, input.reporterId),
              eq(schema.reports.requestKey, body.requestKey),
            ),
          )
          .get();
        if (existing)
          return {
            report: existing,
            signature: signatureRow(db, existing.signature)!,
            classification: { route: existing.route, reproduction: existing.reproduction, reason: 'duplicate' },
            duplicate: true,
          };
      }
      const platformSig = body.error ? signature({ error: body.error, gameId: body.gameId, scope: 'platform' }) : null;
      const seenInOtherGame =
        platformSig !== null &&
        db
          .select({ id: schema.reports.id })
          .from(schema.reports)
          .where(and(eq(schema.reports.platformSignature, platformSig), ne(schema.reports.gameId, body.gameId)))
          .get() !== undefined;
      const textSig = body.error ? null : textSignature(body);
      const textCount = textSig ? (signatureRow(db, textSig)?.count ?? 0) : 0;

      const classified = classify({ report: body, existing: { seenInOtherGame, wrongBehaviourCount: textCount } });
      const classification =
        body.skipRepair && classified.route === 'game_repair'
          ? { ...classified, route: 'stored' as const }
          : classified;
      const scope: SignatureScope = classification.route === 'platform' ? 'platform' : 'game';
      const sig =
        textSig ??
        (scope === 'platform' ? platformSig! : signature({ error: body.error!, gameId: body.gameId, scope }));

      db.insert(schema.reportSignatures)
        .values({
          signature: sig,
          scope,
          gameId: scope === 'game' ? body.gameId : null,
          count: 1,
          firstAt: at,
          lastAt: at,
          status: 'open',
        })
        .onConflictDoUpdate({
          target: schema.reportSignatures.signature,
          set: { count: sql`${schema.reportSignatures.count} + 1`, lastAt: at },
        })
        .run();

      const report: ReportRow = {
        id: `r_${randomUUID()}`,
        gameId: body.gameId,
        releaseId: body.releaseId ?? null,
        buildHash: body.buildHash,
        text: body.text ?? null,
        errorJson: body.error ? JSON.stringify(body.error) : null,
        screenshot: body.screenshot ?? null,
        requestKey: body.requestKey ?? null,
        signature: sig,
        platformSignature: platformSig,
        route: classification.route,
        reproduction: classification.reproduction,
        jobId: null,
        bundleKey: null,
        triageState: null,
        triageClaimedAt: null,
        triageSignature: null,
        triageJson: null,
        diagnosticsKey: null,
        reporterId: input.reporterId,
        createdAt: at,
      };
      db.insert(schema.reports).values(report).run();
      if (input.qaOrigin) {
        const verifiedBuild = db
          .select({ id: schema.builds.id })
          .from(schema.builds)
          .where(and(eq(schema.builds.gameId, report.gameId), eq(schema.builds.id, report.buildHash)))
          .get();
        const issue = qaIssue({
          reportId: report.id,
          gameId: report.gameId,
          ...(verifiedBuild ? { buildHash: verifiedBuild.id } : {}),
          ...(body.error ? { errorType: body.error.type } : {}),
          appOrigin: input.qaOrigin,
        });
        db.insert(schema.platformIssueQueue)
          .values({
            id: `qa_${report.id}`,
            title: issue.title,
            body: issue.body,
            labelsJson: JSON.stringify(issue.labels),
            status: 'pending',
            createdAt: at,
          })
          .run();
      }
      return { report, signature: signatureRow(db, sig)!, classification };
    })
    .immediate();
}

export function signatureRow(db: Db, sig: string): SignatureRow | undefined {
  return db.select().from(schema.reportSignatures).where(eq(schema.reportSignatures.signature, sig)).get();
}

export function findReport(db: Db, id: string): ReportRow {
  const row = db.select().from(schema.reports).where(eq(schema.reports.id, id)).get();
  if (!row) throw new HttpError(404, 'report_not_found');
  return row;
}

export function setReportJob(db: Db, reportId: string, sig: string, jobId: string): void {
  db.transaction((tx) => {
    tx.update(schema.reports).set({ jobId }).where(eq(schema.reports.id, reportId)).run();
    tx.update(schema.reportSignatures)
      .set({ openJobId: jobId })
      .where(eq(schema.reportSignatures.signature, sig))
      .run();
  });
}

export function setReportRoute(db: Db, reportId: string, route: ReportRoute): void {
  db.update(schema.reports).set({ route }).where(eq(schema.reports.id, reportId)).run();
}

export function setPlatformRef(db: Db, sig: string, ref: string): void {
  db.update(schema.reportSignatures).set({ platformRef: ref }).where(eq(schema.reportSignatures.signature, sig)).run();
}

// Compare-and-set: only the first upload for a report wins.
export function setBundleKey(db: Db, reportId: string, bundleKey: string): boolean {
  return (
    db
      .update(schema.reports)
      .set({ bundleKey })
      .where(and(eq(schema.reports.id, reportId), isNull(schema.reports.bundleKey)))
      .run().changes === 1
  );
}

export function claimTriage(
  deps: { db: Db; sqlite: Sqlite },
  input: { now: string; staleBefore: string },
): ReportRow | undefined {
  return deps.sqlite
    .transaction(() => {
      const row = deps.db
        .select()
        .from(schema.reports)
        .where(
          and(
            inArray(schema.reports.route, ['game_repair', 'editor_hint']),
            sql`${schema.reports.bundleKey} IS NOT NULL`,
            or(
              isNull(schema.reports.triageState),
              and(eq(schema.reports.triageState, 'processing'), lte(schema.reports.triageClaimedAt, input.staleBefore)),
            ),
          ),
        )
        .orderBy(asc(schema.reports.createdAt))
        .get();
      if (!row) return undefined;
      deps.db
        .update(schema.reports)
        .set({ triageState: 'processing', triageClaimedAt: input.now })
        .where(eq(schema.reports.id, row.id))
        .run();
      return { ...row, triageState: 'processing' as const, triageClaimedAt: input.now };
    })
    .immediate();
}

export function setDiagnosticsKey(db: Db, reportId: string, diagnosticsKey: string): boolean {
  return (
    db
      .update(schema.reports)
      .set({ diagnosticsKey })
      .where(and(eq(schema.reports.id, reportId), eq(schema.reports.triageState, 'processing')))
      .run().changes === 1
  );
}

const OPEN_REPAIR_STATES = ['queued', 'admitted', 'filed', 'running', 'paused_budget'] as const;

export function findOpenTriage(
  db: Db,
  signature: string,
  gameId: string,
  excludeReportId?: string,
): ReportRow | undefined {
  return db
    .select({ report: schema.reports })
    .from(schema.reports)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.reports.jobId))
    .where(
      and(
        eq(schema.reports.triageSignature, signature),
        eq(schema.reports.gameId, gameId),
        inArray(schema.reports.triageState, ['ready', 'deduped']),
        inArray(schema.jobs.state, OPEN_REPAIR_STATES),
        ...(excludeReportId ? [ne(schema.reports.id, excludeReportId)] : []),
      ),
    )
    .orderBy(asc(schema.reports.createdAt))
    .get()?.report;
}

export function storeTriage(
  db: Db,
  reportId: string,
  completion: CompleteTriage,
  state: 'ready' | 'stored' | 'deduped',
  result?: TriageResult,
): ReportRow {
  const current = findReport(db, reportId);
  if (current.triageState !== 'processing') return current;
  db.update(schema.reports)
    .set({
      triageState: state,
      triageClaimedAt: null,
      triageSignature: result?.signature ?? null,
      triageJson: JSON.stringify(completion),
      diagnosticsKey: result?.diagnosticsKey ?? current.diagnosticsKey,
    })
    .where(and(eq(schema.reports.id, reportId), eq(schema.reports.triageState, 'processing')))
    .run();
  return findReport(db, reportId);
}

const FILING = 'filing';

// Claims the right to file a platform issue for a signature, so concurrent reports file once.
export function claimPlatformFiling(db: Db, sig: string): boolean {
  return (
    db
      .update(schema.reportSignatures)
      .set({ platformRef: FILING })
      .where(and(eq(schema.reportSignatures.signature, sig), isNull(schema.reportSignatures.platformRef)))
      .run().changes === 1
  );
}

export function releasePlatformFiling(db: Db, sig: string): void {
  db.update(schema.reportSignatures)
    .set({ platformRef: null })
    .where(and(eq(schema.reportSignatures.signature, sig), eq(schema.reportSignatures.platformRef, FILING)))
    .run();
}

export function jobState(db: Db, jobId: string) {
  return db.select({ state: schema.jobs.state }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get()?.state;
}

export function listReports(db: Db, gameId: string, reporterId?: string) {
  return db
    .select({
      id: schema.reports.id,
      releaseId: schema.reports.releaseId,
      signature: schema.reports.signature,
      route: schema.reports.route,
      reproduction: schema.reports.reproduction,
      jobId: schema.reports.jobId,
      text: schema.reports.text,
      errorJson: schema.reports.errorJson,
      bundleKey: schema.reports.bundleKey,
      createdAt: schema.reports.createdAt,
    })
    .from(schema.reports)
    .where(and(eq(schema.reports.gameId, gameId), reporterId ? eq(schema.reports.reporterId, reporterId) : undefined))
    .orderBy(desc(schema.reports.createdAt))
    .limit(200)
    .all()
    .map((row) => ({
      reportId: row.id,
      releaseId: row.releaseId ?? undefined,
      signature: row.signature,
      route: row.route,
      reproduction: row.reproduction,
      jobId: row.jobId ?? undefined,
      text: row.text ?? undefined,
      error: row.errorJson ? (JSON.parse(row.errorJson) as unknown) : undefined,
      hasBundle: row.bundleKey !== null,
      createdAt: row.createdAt,
    }));
}

export function listPlatformQueue(db: Db) {
  return db
    .select()
    .from(schema.platformIssueQueue)
    .where(notLike(schema.platformIssueQueue.id, 'qa_%'))
    .orderBy(desc(schema.platformIssueQueue.createdAt))
    .limit(200)
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      labels: JSON.parse(row.labelsJson) as string[],
      status: row.status,
      ref: row.ref ?? undefined,
      createdAt: row.createdAt,
    }));
}
