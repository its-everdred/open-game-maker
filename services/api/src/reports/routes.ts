import { Hono } from 'hono';
import { z } from 'zod';

import {
  CreateReport,
  CompleteTriage,
  Id,
  IsoTime,
  type CreateReportResponse,
  type IssueWriter,
  type ReportError,
  type ReportRoute,
} from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize, type Actor } from '@ogm/policy';
import { countDistinct, eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { findGame, hasGameGrant } from '../games/games.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { readBoundedBody } from '../app/read-body.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { StoredIssueWriter } from './issue-writer.js';
import { PLATFORM_ISSUE_LABELS, REPORTS_PER_USER_PER_HOUR } from './policy.js';
import { admitRepair } from './repair.js';
import { frameKey, normaliseMessage } from './signature.js';
import {
  claimPlatformFiling,
  claimTriage,
  findOpenTriage,
  findReport,
  jobState,
  listPlatformQueue,
  listReports,
  recordReport,
  releasePlatformFiling,
  setBundleKey,
  setPlatformRef,
  setReportJob,
  setReportRoute,
  type Intake,
} from './store.js';
import { completeTriage, DIAGNOSTICS_MAX_BYTES, storeDiagnostics } from './triage.js';

const BUNDLE_TYPES = new Set(['application/octet-stream', 'application/json', 'application/gzip']);
const BUNDLE_URL_TTL_MS = 5 * 60 * 1000;

type ReportsContext = { perUser: ReturnType<typeof createRateLimiter>; issueWriter: IssueWriter };
const contexts = new WeakMap<AppDeps, ReportsContext>();

export function setup(deps: AppDeps): void {
  contexts.set(deps, {
    perUser: createRateLimiter(REPORTS_PER_USER_PER_HOUR),
    issueWriter: new StoredIssueWriter(deps.db),
  });
}

function context(deps: AppDeps): ReportsContext {
  const found = contexts.get(deps);
  if (!found) throw new Error('reports routes used before setup');
  return found;
}

function requireViewer(actor: Actor, game: { familyId: string; ownerId: string }): void {
  if (game.ownerId === actor.userId && game.familyId === actor.familyId) return;
  requireAuthorization(authorize(actor, 'report.view', { familyId: game.familyId }));
}

// Only redacted, normalised error metadata; never the reporter's text or bundle.
function platformIssue(deps: AppDeps, intake: Intake, error: ReportError) {
  const games =
    deps.db
      .select({ n: countDistinct(schema.reports.gameId) })
      .from(schema.reports)
      .where(eq(schema.reports.platformSignature, intake.signature.signature))
      .get()?.n ?? 1;
  return {
    title: `Platform ${error.type}: ${intake.signature.signature.slice(0, 8)}`,
    body: [
      `Signature ${intake.signature.signature}`,
      `Type ${error.type}`,
      `Message ${normaliseMessage(error.message)}`,
      `Frames ${error.frames.slice(0, 3).map(frameKey).join(', ')}`,
      `Games affected ${games}`,
    ].join('\n'),
    labels: [...PLATFORM_ISSUE_LABELS],
  };
}

const LIVE_JOB_STATES = new Set(['queued', 'admitted', 'filed', 'running', 'paused_budget']);

// Attach to the signature's live repair; re-admit only when an earlier repair finished and the bug came back.
// A failed or cancelled repair is left for the owner: the report is stored and nothing is spent.
async function routeRepair(
  deps: AppDeps,
  { report, signature: sig }: Intake,
  game: { id: string; ownerId: string; familyId: string },
): Promise<{ route?: ReportRoute; jobId?: string; pendingBudget?: true }> {
  const previousJobId = sig.openJobId;
  const previousState = previousJobId ? jobState(deps.db, previousJobId) : undefined;
  if (previousJobId && previousState && LIVE_JOB_STATES.has(previousState)) {
    setReportJob(deps.db, report.id, sig.signature, previousJobId);
    return { jobId: previousJobId };
  }
  if (previousState !== undefined && previousState !== 'done') {
    setReportRoute(deps.db, report.id, 'stored');
    return { route: 'stored' };
  }

  let outcome;
  try {
    outcome = await admitRepair(
      {
        db: deps.db,
        sqlite: deps.sqlite,
        events: deps.events,
        defaults: {
          dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
          creatorJobLimit: deps.config.creatorJobLimit,
          resetZone: deps.config.resetZoneDefault,
        },
      },
      {
        gameId: game.id,
        ownerId: game.ownerId,
        familyId: game.familyId,
        reportId: report.id,
        releaseId: report.releaseId,
        signature: sig.signature,
        reproduction: report.reproduction,
        previousJobId,
      },
    );
  } catch (error) {
    deps.log({ event: 'report-repair-admission-failed', reportId: report.id, error: String(error) });
    throw new HttpError(502, 'repair_admission_failed', undefined, { reportId: report.id });
  }
  if (outcome.jobId) {
    setReportJob(deps.db, report.id, sig.signature, outcome.jobId);
    return { jobId: outcome.jobId };
  }
  setReportRoute(deps.db, report.id, 'stored');
  if (outcome.attemptsExhausted) {
    deps.log({ event: 'report-repair-attempts-exhausted', reportId: report.id, signature: sig.signature });
    return { route: 'stored' };
  }
  return { route: 'stored', pendingBudget: true };
}

const listQuery = z.object({ gameId: Id }).strict();
const claimBody = z.strictObject({ now: IsoTime, staleBefore: IsoTime });
const dedupeQuery = z.strictObject({ signature: z.string().regex(/^[0-9a-f]{64}$/), exclude: Id });

function requireRepairService(c: Parameters<typeof requirePrincipal>[0]): void {
  const principal = requirePrincipal(c, ['service']);
  if (principal.service !== 'repair') throw new HttpError(403, 'forbidden');
}

const routes = new Hono<ApiBindings>()
  .post('/', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const actor = actorFromPrincipal(principal);
    if (!context(deps).perUser(actor.userId)) throw new HttpError(429, 'rate_limited');
    const body = await parseBody(c, CreateReport);
    const game = findGame(deps.db, body.gameId);
    const resource = {
      gameId: game.id,
      familyId: game.familyId,
      ownerId: game.ownerId,
      visibility: game.visibility,
      granted: hasGameGrant(deps.db, game.id, actor.userId),
    };
    requireAuthorization(authorize(actor, 'game.play', resource));
    requireAuthorization(authorize(actor, 'report.file', resource));

    // A client-supplied bundleKey is ignored: bundles arrive through POST /:id/bundle only.
    const intake = recordReport(deps, {
      body: { ...body, bundleKey: undefined },
      reporterId: actor.userId,
      now: new Date(),
    });
    const { report, signature: sig } = intake;
    const response: CreateReportResponse & { pendingBudget?: true } = {
      reportId: report.id,
      signature: sig.signature,
      route: report.route,
    };

    if (report.route === 'game_repair') {
      Object.assign(response, await routeRepair(deps, intake, game));
    } else if (report.route === 'platform' && body.error && claimPlatformFiling(deps.db, sig.signature)) {
      try {
        const { ref } = await context(deps).issueWriter.file(platformIssue(deps, intake, body.error));
        setPlatformRef(deps.db, sig.signature, ref);
      } catch (error) {
        // Release the claim so the next matching report files again.
        releasePlatformFiling(deps.db, sig.signature);
        deps.log({ event: 'report-platform-issue-failed', reportId: report.id, error: String(error) });
      }
    }

    return c.json(response, 201);
  })
  .get('/', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const { gameId } = parseQuery(c, listQuery);
    requireViewer(actorFromPrincipal(principal), findGame(deps.db, gameId));
    return c.json({ reports: listReports(deps.db, gameId) });
  })
  .get('/platform-queue', (c) => {
    const principal = requirePrincipal(c, ['user']);
    requireAuthorization(authorize(actorFromPrincipal(principal), 'report.view'));
    return c.json({ issues: listPlatformQueue(c.get('deps').db) });
  })
  .post('/triage/claim', async (c) => {
    requireRepairService(c);
    const deps = c.get('deps');
    const body = await parseBody(c, claimBody);
    if (body.staleBefore > body.now) throw new HttpError(400, 'invalid_stale_before');
    const report = claimTriage(deps, body);
    if (!report) return c.json({ report: null });
    const { url } = await deps.blobStore.signedGet(
      report.bundleKey as Parameters<AppDeps['blobStore']['signedGet']>[0],
      new Date(Date.parse(body.now) + BUNDLE_URL_TTL_MS),
    );
    return c.json({
      reportId: report.id,
      gameId: report.gameId,
      ...(report.releaseId ? { releaseId: report.releaseId } : {}),
      buildHash: report.buildHash,
      route: report.route,
      ...(report.jobId ? { jobId: report.jobId } : {}),
      ...(report.text ? { text: report.text } : {}),
      ...(report.errorJson ? { error: JSON.parse(report.errorJson) as ReportError } : {}),
      bundleUrl: url,
    });
  })
  .get('/triage/dedupe', (c) => {
    requireRepairService(c);
    const query = parseQuery(c, dedupeQuery);
    const deps = c.get('deps');
    const source = findReport(deps.db, query.exclude);
    const report = findOpenTriage(deps.db, query.signature, source.gameId, source.id);
    return c.json({ jobId: report?.jobId ?? null });
  })
  .post('/triage/:id/diagnostics', async (c) => {
    requireRepairService(c);
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > DIAGNOSTICS_MAX_BYTES) throw new HttpError(413, 'diagnostics_too_large');
    const bytes = await readBoundedBody(c.req.raw, DIAGNOSTICS_MAX_BYTES, 'bundle_too_large');
    const diagnosticsKey = await storeDiagnostics(c.get('deps'), c.req.param('id'), bytes);
    return c.json({ diagnosticsKey }, 201);
  })
  .post('/triage/:id/complete', async (c) => {
    requireRepairService(c);
    const completion = await parseBody(c, CompleteTriage);
    return c.json(completeTriage(c.get('deps'), c.req.param('id'), completion));
  })
  .post('/:id/bundle', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const report = findReport(deps.db, c.req.param('id'));
    if (report.reporterId !== principal.userId) throw new HttpError(403, 'not_reporter');
    if (report.bundleKey !== null) throw new HttpError(409, 'bundle_exists');
    const contentType = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!BUNDLE_TYPES.has(contentType)) throw new HttpError(415, 'unsupported_bundle_type');
    const max = deps.config.reportBundleMaxBytes;
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > max) throw new HttpError(413, 'bundle_too_large');
    const bytes = await readBoundedBody(c.req.raw, max, 'bundle_too_large');
    if (bytes.byteLength === 0) throw new HttpError(400, 'empty_bundle');

    try {
      const { hash } = await deps.blobStore.put(bytes, contentType);
      if (!setBundleKey(deps.db, report.id, hash)) throw new HttpError(409, 'bundle_exists');
      return c.json({ reportId: report.id, bundleKey: hash }, 201);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      deps.log({ event: 'report-bundle-store-failed', reportId: report.id, error: String(error) });
      return c.json({ reportId: report.id }, 201);
    }
  })
  .get('/:id/bundle', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const report = findReport(deps.db, c.req.param('id'));
    const game = findGame(deps.db, report.gameId);
    requireAuthorization(authorize(actorFromPrincipal(principal), 'report.view', { familyId: game.familyId }));
    if (report.bundleKey === null) throw new HttpError(404, 'bundle_not_found');
    const { url } = await deps.blobStore.signedGet(
      report.bundleKey as Parameters<AppDeps['blobStore']['signedGet']>[0],
      new Date(Date.now() + BUNDLE_URL_TTL_MS),
    );
    return c.redirect(url, 302);
  });

export default routes;
