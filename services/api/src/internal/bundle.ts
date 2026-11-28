import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono, type Context } from 'hono';

import { JobBundle } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, eq, sql } from 'drizzle-orm';

import type { ApiBindings, AppDeps } from '../app/types.js';
import { getAttachment, jobAttachments, readBlob, workspacePath } from '../build-chat/attachments.js';
import { readEnergySnapshot } from '../energy/source.js';
import { readPreference } from '../energy/store.js';
import { playerView } from '../energy/view.js';
import { paidApisDuringGameplay } from '../gameplay/policy.js';
import { scopeSessions } from '../scope/store.js';
import { LEAKY } from './leaky.js';
import { verifyPreviewToken } from '../builds/preview-token.js';
import { plannerAnswers } from '../job-commands/planner-answers.js';
import { ticketJobResolver } from './ticket-job.js';

// Resolves an after_create hook's bearer to the one game repo whose daemon holds that secret, or null.
export type HookDaemonResolver = (secret: string, deps: AppDeps) => Promise<string | null>;
export type HookGameResolver = (secret: string, deps: AppDeps) => Promise<{ repo: string; slug: string } | null>;
export type HookIdentityResolver = HookGameResolver;
export type SkillTarball = { version: string; tgz: Buffer };
type TicketAccess = (
  token: string,
  workspaceHash: string,
  repo: string,
  ticket: string,
  deps: AppDeps,
) => Promise<string | null>;

// OGM-034 writes each daemon's secret to `~/.config/ogm/daemons/<slug>/hook-secret` (0600) and its env file names
// only that path; the secret itself never sits in the daemon's environment.
export function hookSecretFiles(home: string): HookDaemonResolver {
  const resolve = hookSecretGame(home);
  return async (secret, deps) => (await resolve(secret, deps))?.repo ?? null;
}

export function hookSecretGame(home: string): HookGameResolver {
  return async (secret, deps) => {
    const given = digest(secret);
    for (const row of await deps.db
      .select({ slug: schema.gameDaemons.slug, repo: schema.gameDaemons.repo })
      .from(schema.gameDaemons)) {
      const stored = await readFile(join(home, '.config/ogm/daemons', row.slug, 'hook-secret'), 'utf8').catch(
        () => undefined,
      );
      if (stored !== undefined && stored.trim() !== '' && timingSafeEqual(given, digest(stored.trim())))
        return { repo: row.repo, slug: row.slug };
    }
    return null;
  };
}

export function hookPreviewToken(home: string) {
  return async (
    token: string,
    deps: AppDeps,
  ): Promise<{ repo: string; slug: string; ticket: string; grant: string; game: string } | null> => {
    for (const row of await deps.db
      .select({ slug: schema.gameDaemons.slug, repo: schema.gameDaemons.repo })
      .from(schema.gameDaemons)) {
      const secret = await readFile(join(home, '.config/ogm/daemons', row.slug, 'hook-secret'), 'utf8').catch(
        () => undefined,
      );
      if (!secret?.trim()) continue;
      const claims = verifyPreviewToken(token, secret.trim());
      if (claims)
        return { repo: row.repo, slug: row.slug, ticket: claims.ticket, grant: claims.grant, game: claims.game };
    }
    return null;
  };
}

export const hookIdentityFiles = hookSecretGame;

/** A daemon secret alone cannot read another ticket's private data. */
export function managedTicketAccess(home: string): TicketAccess {
  const verify = hookPreviewToken(home);
  return async (token, workspaceHash, repo, ticket, deps) => {
    if (!/^[a-f0-9]{64}$/.test(workspaceHash)) return null;
    const identity = await verify(token, deps);
    if (!identity || identity.repo.toLowerCase() !== repo.toLowerCase() || identity.ticket !== ticket) return null;
    const file = join(home, '.config/ogm/daemons', identity.slug, 'preview-grants', `${workspaceHash}.json`);
    try {
      const grant = JSON.parse(await readFile(file, 'utf8')) as {
        ticket?: unknown;
        grant?: unknown;
        game?: unknown;
        expires?: unknown;
      };
      return grant.ticket === ticket &&
        grant.grant === identity.grant &&
        grant.game === identity.game &&
        typeof grant.expires === 'number' &&
        grant.expires > Date.now()
        ? identity.game
        : null;
    } catch {
      return null;
    }
  };
}

export function bundleRoutes(opts: {
  daemonForSecret: HookDaemonResolver;
  skills: () => SkillTarball;
  ticketAccess?: TicketAccess;
}) {
  async function daemonRepo(c: Context<ApiBindings>): Promise<string | null> {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    return match ? opts.daemonForSecret(match[1], c.get('deps')) : null;
  }

  // The job a daemon's ticket belongs to, only when that daemon's repo owns it.
  async function ticketJob(c: Context<ApiBindings>, repo: string) {
    const deps = c.get('deps');
    const identifier = c.req.param('identifier') ?? '';
    const game = opts.ticketAccess
      ? await opts.ticketAccess(
          c.req.header('x-ogm-preview-token') ?? '',
          c.req.header('x-ogm-workspace') ?? '',
          repo,
          identifier,
          deps,
        )
      : null;
    if (opts.ticketAccess && !game) return null;
    const resolver = deps.registry.ticketJobResolver ?? (opts.ticketAccess ? ticketJobResolver(deps.db) : null);
    const job = resolver ? await resolver(repo, identifier) : null;
    if (!job || job.repo.toLowerCase() !== repo.toLowerCase()) return null;
    if (game) {
      const row = deps.db
        .select({ slug: schema.games.slug })
        .from(schema.games)
        .where(eq(schema.games.id, job.gameId))
        .get();
      if (row?.slug !== game) return null;
    }
    return job;
  }

  return (
    new Hono<ApiBindings>()
      .get('/jobs/by-ticket/:identifier/planner-guard', async (c) => {
        const repo = await daemonRepo(c);
        if (!repo) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const identifier = c.req.param('identifier');
        if (!/^[1-9][0-9]{0,15}$/.test(identifier) || !Number.isSafeInteger(Number(identifier)))
          return c.json({ plannerChild: false });
        const db = c.get('deps').db;
        const row = db
          .select({ key: schema.jobs.idempotencyKey })
          .from(schema.jobTickets)
          .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobTickets.jobId))
          .where(
            and(
              sql`lower(${schema.jobTickets.repo}) = lower(${repo})`,
              eq(schema.jobTickets.issueNumber, Number(identifier)),
            ),
          )
          .get();
        const direct =
          row ??
          db
            .select({ key: schema.jobs.idempotencyKey })
            .from(schema.jobs)
            .where(
              and(
                sql`lower(${schema.jobs.aiurRepo}) = lower(${repo})`,
                eq(schema.jobs.aiurIssueNumber, Number(identifier)),
              ),
            )
            .get();
        return c.json({ plannerChild: direct?.key?.startsWith('planner:') ?? false });
      })
      .get('/jobs/by-ticket/:identifier/bundle', async (c) => {
        const repo = await daemonRepo(c);
        if (!repo) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const deps = c.get('deps');
        const job = await ticketJob(c, repo);
        if (!job) return c.json({ error: { code: 'not_found' } }, 404);

        const stored = deps.db
          .select({ plan: schema.jobs.plan, key: schema.jobs.idempotencyKey, state: schema.jobs.state })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, job.jobId))
          .get();
        const isPlannerChild = (stored?.key ?? '').startsWith('planner:');
        if (isPlannerChild && !['admitted', 'filed', 'running', 'paused_budget'].includes(stored!.state))
          return c.json({ error: { code: 'planner_child_not_admitted' } }, 409);
        const plannerBase = isPlannerChild
          ? (JSON.parse(stored!.plan) as { _plannerBase?: unknown })._plannerBase
          : undefined;
        if (isPlannerChild && !plannerBase) return c.json({ error: { code: 'planner_base_missing' } }, 409);
        const { version } = opts.skills();
        const attachments = jobAttachments(deps.sqlite, job.jobId).map((row) => ({
          kind: row.kind,
          // A creator's file name is free text; one shaped like an address or token must not refuse the whole bundle.
          name: LEAKY.test(row.name) ? row.id : row.name,
          blob: row.id,
          bytes: row.bytes,
          message_id: row.messageId!,
          path: workspacePath(row),
        }));
        const creatorId = deps.db
          .select({ creatorId: schema.jobs.creatorId })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, job.jobId))
          .get()?.creatorId;
        const energy = playerView(
          await readEnergySnapshot(
            {
              db: deps.db,
              zone: deps.config.resetZoneDefault,
              readings: deps.registry.energyReadings,
              netlifyLog: deps.registry.energyNetlifyLog,
            },
            new Date(),
          ),
          creatorId === undefined ? 'balanced' : readPreference(deps.db, creatorId),
        );
        const scopeSessionId = job.kind === 'scope' ? scopeSessions.getByJob(deps.db, job.jobId)?.id : undefined;
        const allowAiGeneratedAssets =
          deps.db
            .select({ allow: schema.games.allowAiGeneratedAssets })
            .from(schema.games)
            .where(eq(schema.games.id, job.gameId))
            .get()?.allow ?? true;
        const bundle = JobBundle.parse({
          v: 1,
          jobId: job.jobId,
          gameId: job.gameId,
          repo: job.repo,
          kind: job.kind,
          ...(scopeSessionId === undefined ? {} : { scope_session_id: scopeSessionId }),
          skillPackVersion: version,
          skillPackUrl: new URL(`/internal/skills/${encodeURIComponent(version)}.tgz`, c.req.url).href,
          gameContext: {
            ...job.game,
            allowAiGeneratedAssets,
            paidApisDuringGameplay: paidApisDuringGameplay(deps.db),
            branch: 'main',
            lockfilePath: 'assets.lock.json',
          },
          ...(job.kind === 'repair' && job.diagnostics ? { diagnostics: job.diagnostics } : {}),
          ...(attachments.length === 0 ? {} : { attachments }),
          ...(plannerBase === undefined ? {} : { plannerBase }),
          energy,
        });
        if (LEAKY.test(JSON.stringify(bundle))) {
          deps.log({ event: 'bundle_refused', jobId: job.jobId, reason: 'secret- or email-shaped value' });
          return c.json({ error: { code: 'internal' } }, 500);
        }
        return c.json(bundle);
      })
      // Current answers are private to the authenticated game daemon and refreshed before a child runs.
      .get('/jobs/by-ticket/:identifier/planner-answers', async (c) => {
        const repo = await daemonRepo(c);
        if (!repo) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const deps = c.get('deps');
        const job = await ticketJob(c, repo);
        if (!job) return c.json({ error: { code: 'not_found' } }, 404);
        const row = deps.db
          .select({ key: schema.jobs.idempotencyKey })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, job.jobId))
          .get();
        if (!row?.key?.startsWith('planner:')) return c.json({ error: { code: 'not_found' } }, 404);
        return c.json({ answers: plannerAnswers(deps.db, deps.sqlite, job) });
      })
      // A file the creator attached to this job's chat, for the after_create hook to place in the workspace.
      .get('/jobs/by-ticket/:identifier/attachments/:id', async (c) => {
        const repo = await daemonRepo(c);
        if (!repo) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const deps = c.get('deps');
        const job = await ticketJob(c, repo);
        const row = job ? getAttachment(deps.sqlite, c.req.param('id')) : null;
        if (!job || row?.jobId !== job.jobId || row.messageId === null) {
          return c.json({ error: { code: 'not_found' } }, 404);
        }
        const bytes = await readBlob(deps.blobStore, row.blobHash);
        if (!bytes) return c.json({ error: { code: 'not_found' } }, 404);
        return c.body(new Uint8Array(bytes), 200, { 'content-type': row.mime });
      })
      // The live gameplay policy, for `gm policy` in any daemon workspace (the bundle holds it as of the job's start).
      .get('/games/:id/ai-assets', async (c) => {
        const repo = await daemonRepo(c);
        if (!repo) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const game = c
          .get('deps')
          .db.select({
            allow: schema.games.allowAiGeneratedAssets,
            owner: schema.games.githubOwner,
            repo: schema.games.githubRepo,
          })
          .from(schema.games)
          .where(eq(schema.games.id, c.req.param('id')))
          .get();
        if (!game?.owner || !game.repo || `${game.owner}/${game.repo}`.toLowerCase() !== repo.toLowerCase())
          return c.json({ error: { code: 'not_found' } }, 404);
        return c.json({ allowAiGeneratedAssets: game.allow });
      })
      .get('/gameplay', async (c) => {
        if (!(await daemonRepo(c))) return c.json({ error: { code: 'unauthenticated' } }, 401);
        return c.json({ paidApisDuringGameplay: paidApisDuringGameplay(c.get('deps').db) });
      })
      .get('/skills/:file', async (c) => {
        if (!(await daemonRepo(c))) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const { version, tgz } = opts.skills();
        if (c.req.param('file') !== `${version}.tgz`) return c.json({ error: { code: 'not_found' } }, 404);
        return c.body(new Uint8Array(tgz), 200, { 'content-type': 'application/gzip' });
      })
  );
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
