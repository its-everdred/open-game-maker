import {
  CompleteTriage,
  PromiseArtifact,
  TriageResult,
  type CompleteTriage as CompleteTriageValue,
} from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { markTerminal } from '../jobs/spend-cap.js';
import { findOpenTriage, findReport, setDiagnosticsKey, storeTriage } from './store.js';

export const DIAGNOSTICS_MAX_BYTES = 200 * 1024;

export const Diagnostics = z.strictObject({
  warning: z.string().min(1).max(240),
  replayPath: z.string().min(1).max(500).optional(),
  errors: z.array(z.unknown()).max(1_000).optional(),
  probes: z
    .strictObject({ before: z.record(z.string(), z.unknown()), after: z.record(z.string(), z.unknown()) })
    .optional(),
  finalState: z.unknown().optional(),
  creatorText: z.string().max(4_100).optional(),
  screenshotKey: z.string().max(200).optional(),
  promise: PromiseArtifact.optional(),
});

function lifecycle(deps: AppDeps) {
  return {
    db: deps.db,
    sqlite: deps.sqlite,
    events: deps.events,
    defaults: {
      dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
      creatorJobLimit: deps.config.creatorJobLimit,
      defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
      resetZone: deps.config.resetZoneDefault,
    },
  };
}

function cancelProvisional(deps: AppDeps, jobId: string | null): void {
  if (!jobId) return;
  const job = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (job && !['done', 'failed', 'cancelled'].includes(job.state)) markTerminal(lifecycle(deps), jobId, 'cancelled');
}

function existingCompletion(row: ReturnType<typeof findReport>): CompleteTriageValue | undefined {
  if (!row.triageJson) return undefined;
  const parsed = CompleteTriage.safeParse(JSON.parse(row.triageJson));
  return parsed.success ? parsed.data : undefined;
}

export async function storeDiagnostics(deps: AppDeps, reportId: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > DIAGNOSTICS_MAX_BYTES) throw new HttpError(413, 'diagnostics_too_large');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  const parsed = Diagnostics.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'invalid_request', undefined, parsed.error.issues);
  const report = findReport(deps.db, reportId);
  if (report.triageState !== 'processing') throw new HttpError(409, 'triage_not_processing');
  const { hash } = await deps.blobStore.put(bytes, 'application/json');
  if (!setDiagnosticsKey(deps.db, reportId, hash)) throw new HttpError(409, 'triage_not_processing');
  return hash;
}

export function completeTriage(deps: AppDeps, reportId: string, input: CompleteTriageValue): CompleteTriageValue {
  const completion = CompleteTriage.parse(input);
  const outcome = deps.sqlite
    .transaction((): { value: CompleteTriageValue; cancelJobId?: string; notifyJobId?: string } => {
      const report = findReport(deps.db, reportId);
      if (report.triageState !== 'processing') {
        const existing = existingCompletion(report);
        if (existing) return { value: existing };
        throw new HttpError(409, 'triage_not_processing');
      }

      if (completion.status === 'stored') {
        storeTriage(deps.db, report.id, completion, 'stored');
        return { value: completion, ...(report.jobId ? { cancelJobId: report.jobId } : {}) };
      }

      const result = TriageResult.parse(completion.result);
      if (result.reportId !== report.id) throw new HttpError(409, 'triage_report_mismatch');
      if (report.route === 'editor_hint') {
        if (!result.editorHint || result.ticket || result.promise) throw new HttpError(400, 'invalid_editor_hint');
        storeTriage(deps.db, report.id, completion, 'stored', result);
        return { value: completion, ...(report.jobId ? { cancelJobId: report.jobId } : {}) };
      }
      if (result.replay.class !== 'reproduces_with_error') {
        storeTriage(deps.db, report.id, completion, 'stored', result);
        return { value: completion, ...(report.jobId ? { cancelJobId: report.jobId } : {}) };
      }
      if (!result.signature || !result.diagnosticsKey || result.diagnosticsKey !== report.diagnosticsKey) {
        throw new HttpError(400, 'incomplete_reproduction');
      }

      const equivalent = findOpenTriage(deps.db, result.signature, report.gameId, report.id);
      if (equivalent?.jobId) {
        const deduped = TriageResult.parse({
          ...result,
          ticket: undefined,
          promise: undefined,
          dedupedInto: equivalent.jobId,
        });
        const authoritative = { status: 'triaged' as const, result: deduped };
        storeTriage(deps.db, report.id, authoritative, 'deduped', deduped);
        deps.db.update(schema.reports).set({ jobId: equivalent.jobId }).where(eq(schema.reports.id, report.id)).run();
        return {
          value: authoritative,
          ...(report.jobId && report.jobId !== equivalent.jobId ? { cancelJobId: report.jobId } : {}),
        };
      }

      if (!result.ticket || !result.promise) throw new HttpError(400, 'incomplete_reproduction');
      const readyResult = result.dedupedInto ? TriageResult.parse({ ...result, dedupedInto: undefined }) : result;
      const readyCompletion = { status: 'triaged' as const, result: readyResult };
      storeTriage(deps.db, report.id, readyCompletion, 'ready', readyResult);
      return { value: readyCompletion, ...(report.jobId ? { notifyJobId: report.jobId } : {}) };
    })
    .immediate();

  cancelProvisional(deps, outcome.cancelJobId ?? null);
  if (outcome.notifyJobId) {
    const job = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, outcome.notifyJobId)).get();
    if (job?.state === 'admitted') {
      deps.events.emit('job.changed', {
        jobId: job.id,
        gameId: job.gameId,
        familyId: job.familyId,
        state: job.state,
      });
    }
  }
  return outcome.value;
}
