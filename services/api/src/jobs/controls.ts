import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { AiurConfigError, AiurHttpError, AiurUnavailableError, type AiurClient } from '@ogm/aiur-client';
import { JOB_STAGE_WORDS } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize, type Action } from '@ogm/policy';
import { and, eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import type { IssueStateWriter } from '../app/registry.js';
import { parseBody } from '../app/validate.js';
import { daemonRowForGame } from './daemons.js';
import { findJob, findJobRow, type JobRow } from './repo.js';
import { markTerminal } from './spend-cap.js';

const messageBody = z
  .object({
    text: z.string().min(1).max(4_000),
    messageId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  })
  .strict();
const decideBody = z
  .object({
    commandId: z.string().min(1).max(200),
    option: z.string().min(1).max(200).optional(),
    response: z.string().min(1).max(4_000).optional(),
  })
  .strict()
  .refine(({ option, response }) => (option === undefined) !== (response === undefined), {
    message: 'exactly one of option or response is required',
  });

export type ControlsServices = {
  daemonFor: (deps: AppDeps, gameId: string) => Promise<AiurClient | null>;
  issues: (deps: AppDeps) => IssueStateWriter | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

// A job's daemon is its game's daemon, so the game id on the job row is the lookup key.
export async function storedDaemonFor(deps: AppDeps, gameId: string): Promise<AiurClient | null> {
  const daemon = daemonRowForGame(deps.db, gameId);
  return daemon ? deps.aiurClientForGame(gameId) : null;
}

function defaults(deps: AppDeps) {
  return {
    dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
    resetZone: deps.config.resetZoneDefault,
  };
}

// The job's row and its game's row: the game carries the daemon's key (its slug) and the label prefix controls use.
function loadAuthorized(
  c: Context<ApiBindings>,
  action: Action,
): { row: JobRow; game: typeof schema.games.$inferSelect } {
  const principal = requirePrincipal(c, ['user']);
  const deps = c.get('deps');
  const id = c.req.param('id');
  if (!id) throw new HttpError(404, 'job_not_found');
  const row = findJobRow(deps.db, id);
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, row.gameId)).get();
  if (!game) throw new HttpError(404, 'game_not_found');
  requireAuthorization(
    authorize(actorFromPrincipal(principal), action, {
      gameId: game.id,
      familyId: game.familyId,
      ownerId: game.ownerId,
    }),
  );
  return { row, game };
}

function ticket(row: JobRow): { repo: string; issue: number } {
  if (row.aiurRepo === null || row.aiurIssueNumber === null) throw new HttpError(409, 'job_not_filed');
  return { repo: row.aiurRepo, issue: row.aiurIssueNumber };
}

function active(row: JobRow): void {
  if (!['filed', 'running', 'paused_budget'].includes(row.state)) throw new HttpError(409, 'job_not_active');
}

function cancelled(deps: AppDeps, row: JobRow, now: () => Date) {
  const job =
    row.state === 'cancelled'
      ? findJob(deps.db, row.id)
      : markTerminal(
          { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults: defaults(deps), now },
          row.id,
          'cancelled',
          row.aiurIssueNumber === null ? {} : { deferRelease: true },
        );
  return { ...job, stage: 'cancelled' as const, stageText: JOB_STAGE_WORDS.cancelled };
}

function controlError(error: unknown): never {
  if (error instanceof AiurHttpError) {
    if (error.status === 409) throw new HttpError(409, error.code);
    if (error.status >= 500) throw new HttpError(503, 'daemon_unavailable');
    throw new HttpError(502, 'aiur_control_failed');
  }
  if (error instanceof AiurUnavailableError) throw new HttpError(503, 'daemon_unavailable');
  throw error;
}

async function requireDaemon(services: ControlsServices, deps: AppDeps, gameId: string): Promise<AiurClient> {
  const client = await services.daemonFor(deps, gameId);
  if (client === null) throw new HttpError(503, 'daemon_unavailable');
  return client;
}

export function createControlsRoutes(services: ControlsServices): Hono<ApiBindings> {
  const sleep = services.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = services.now ?? (() => new Date());

  return new Hono<ApiBindings>()
    .post('/:id/cancel', async (c) => {
      const { row, game } = loadAuthorized(c, 'job.cancel');
      const deps = c.get('deps');
      if (row.state === 'cancelled') return c.json(cancelled(deps, row, now));
      if (row.state === 'done' || row.state === 'failed') throw new HttpError(409, 'job_not_active');
      if (row.aiurRepo === null || row.aiurIssueNumber === null) {
        if (row.state !== 'queued' && row.state !== 'admitted') throw new HttpError(409, 'job_not_filed');
        return c.json(cancelled(deps, row, now));
      }

      const filed = ticket(row);
      const client = await services.daemonFor(deps, row.gameId);
      const labelFallback = async () => {
        try {
          const issues = services.issues(deps);
          if (issues === null) throw new Error('issue state writer unavailable');
          await issues.setStateLabel(filed.repo, filed.issue, 'cancelled', game.slug ?? 'agent');
        } catch (error) {
          deps.log({
            event: 'admin-alert',
            code: 'cancel_fallback_failed',
            jobId: row.id,
            error: (error as Error).name,
          });
          throw new HttpError(503, 'cancel_fallback_failed');
        }
        return c.json(cancelled(deps, row, now));
      };
      if (client === null) return labelFallback();

      let status = 'still_running';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await client.cancel(String(filed.issue));
          status = result.process.status;
          if (status === 'exited') return c.json(cancelled(deps, row, now));
        } catch (error) {
          if (error instanceof AiurHttpError && error.status === 409 && error.code === 'agent_not_running') {
            return labelFallback();
          }
          if (
            error instanceof AiurHttpError &&
            error.status === 409 &&
            (error.code === 'still_running' || error.code === 'kill_failed')
          ) {
            status = error.code; // retry like a non-exited 200
          } else controlError(error);
        }
        if (attempt < 2) await sleep(5_000);
      }

      deps.log({ event: 'admin-alert', code: 'cancel_unconfirmed', jobId: row.id, status });
      throw new HttpError(503, 'cancel_unconfirmed', undefined, { status });
    })
    .post('/:id/pause', async (c) => {
      const { row } = loadAuthorized(c, 'job.edit');
      active(row);
      if (row.state === 'paused_budget') throw new HttpError(409, 'job_budget_paused');
      const deps = c.get('deps');
      const filed = ticket(row);
      const client = await requireDaemon(services, deps, row.gameId);
      try {
        await client.pause(String(filed.issue));
      } catch (error) {
        controlError(error);
      }
      deps.db
        .update(schema.jobs)
        .set({ pausedReason: 'admin', updatedAt: now().toISOString() })
        .where(eq(schema.jobs.id, row.id))
        .run();
      return c.json({ ...findJob(deps.db, row.id), stage: 'paused' as const, stageText: JOB_STAGE_WORDS.paused });
    })
    .post('/:id/resume', async (c) => {
      const { row } = loadAuthorized(c, 'job.edit');
      active(row);
      if (row.state === 'paused_budget') throw new HttpError(409, 'job_budget_paused');
      const deps = c.get('deps');
      const filed = ticket(row);
      const client = await requireDaemon(services, deps, row.gameId);
      try {
        await client.resume(String(filed.issue));
      } catch (error) {
        controlError(error);
      }
      deps.db
        .update(schema.jobs)
        .set({ pausedReason: null, updatedAt: now().toISOString() })
        .where(eq(schema.jobs.id, row.id))
        .run();
      return c.json(findJob(deps.db, row.id));
    })
    .post('/:id/message', async (c) => {
      const { row } = loadAuthorized(c, 'job.edit');
      active(row);
      const body = await parseBody(c, messageBody);
      const deps = c.get('deps');
      const filed = ticket(row);
      const client = await requireDaemon(services, deps, row.gameId);
      try {
        return c.json(await client.message(String(filed.issue), body.text, body.messageId), 202);
      } catch (error) {
        controlError(error);
      }
    })
    .post('/:id/decide', async (c) => {
      const { row } = loadAuthorized(c, 'job.edit');
      active(row);
      const body = await parseBody(c, decideBody);
      const deps = c.get('deps');
      const command = deps.db
        .select()
        .from(schema.commands)
        .where(and(eq(schema.commands.decisionId, body.commandId), eq(schema.commands.jobId, row.id)))
        .get();
      if (!command) throw new HttpError(404, 'command_not_found');
      if (command.status !== 'open') throw new HttpError(409, 'command_not_open');
      // A job that was never filed has no daemon ticket to decide on; `ticket` throws 409 as on the other routes.
      ticket(row);
      const client = await requireDaemon(services, deps, row.gameId);

      try {
        await client.decide(command.decisionId, {
          ...(body.option === undefined ? { response: body.response! } : { option: body.option }),
          expected_version: command.version,
          idempotency_key: `${command.decisionId}:${command.version}`,
          rationale: 'Creator answered the command',
          confidence: 100,
          alternatives_considered: [],
          reversibility_belief: 'reversible',
        });
      } catch (error) {
        if (error instanceof AiurConfigError) {
          deps.log({ event: 'admin-alert', code: 'commands_unavailable', jobId: row.id });
          throw new HttpError(503, 'commands_unavailable');
        }
        controlError(error);
      }

      deps.db
        .update(schema.commands)
        .set({ status: 'answered', answeredAt: now().toISOString() })
        .where(and(eq(schema.commands.decisionId, command.decisionId), eq(schema.commands.status, 'open')))
        .run();
      return c.json({ commandId: command.decisionId, status: 'answered' as const });
    });
}
