import { AiurHttpError } from '@ogm/aiur-client';
import { CompleteTriage, JobPlan, Reservation, type TriageResult } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, eq, lte } from 'drizzle-orm';

import { isDaemonLabel } from '@ogm/game-repo-template';

import { OutcomeUnknownError } from '../github/issues.js';
import { scopeTicketForJob } from '../scope/file.js';
import { PARENT_LABEL, PARENT_TICKET_KEY, parentIssueFor, type ParentIssue } from './parent.js';
import { renderIssue, renderRepairIssue, usdFromMicro } from './render.js';
import type { FileResult, IntakeAlert, IntakeDeps } from './types.js';

const DEFAULT_SWEEP_MS = 60_000;
const SPEND_CAP_RETRY_MS = 5_000;

export function createIntake(deps: IntakeDeps) {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sweepMs = deps.sweepMs ?? DEFAULT_SWEEP_MS;
  const inFlight = new Map<string, Promise<FileResult>>();
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function notify(event: IntakeAlert): Promise<void> {
    await deps.alert?.(event);
  }

  function fileJob(jobId: string): Promise<FileResult> {
    const current = inFlight.get(jobId);
    if (current) return current;
    const pending = performFileJob(jobId).finally(() => inFlight.delete(jobId));
    inFlight.set(jobId, pending);
    return pending;
  }

  async function performFileJob(jobId: string): Promise<FileResult> {
    const found = deps.db
      .select({ job: schema.jobs, game: schema.games })
      .from(schema.jobs)
      .innerJoin(schema.games, eq(schema.jobs.gameId, schema.games.id))
      .where(eq(schema.jobs.id, jobId))
      .get();
    if (!found) return { skipped: 'missing' };
    if (found.job.state !== 'admitted') return { skipped: `state:${found.job.state}` };
    const repairTriage = found.job.kind === 'repair' ? triageForRepair(deps.db, jobId) : undefined;
    if (found.job.kind === 'repair' && !repairTriage?.ticket) return { deferred: 'triage' };

    const repo =
      found.game.githubOwner && found.game.githubRepo
        ? `${found.game.githubOwner}/${found.game.githubRepo}`.toLowerCase()
        : null;
    if (!repo) return failPreflight(found.job, ['game repository is not provisioned']);
    // The daemon is keyed by the game's slug and its label prefix, so two games in one instance repo never share a
    // daemon or each other's labels.
    const gameSlug = found.game.slug;
    if (!gameSlug) return failPreflight(found.job, ['game slug is missing']);

    if (found.job.kind === 'feature') {
      if (!deps.shippedSkills.includes('gm-prototype')) {
        await notify({
          code: 'preflight_failed',
          jobId,
          reasons: ['deployed skill pack does not contain gm-prototype'],
        });
        return { deferred: 'aiur' };
      }
      try {
        if (!(await deps.issues.hasPrototypeSkill(repo, deps.coreRepo))) {
          await notify({ code: 'preflight_failed', jobId, reasons: ['game core does not yet contain gm-prototype'] });
          return { deferred: 'github' };
        }
      } catch (error) {
        await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
        return { deferred: 'github' };
      }
    }

    const fleetResult = await deps.fleet.ensureDaemon({ slug: gameSlug, repo }, fleetKind(found.job.kind));
    if (fleetResult.status === 'waiting_capacity') return { deferred: 'capacity' };
    if (fleetResult.status === 'stopped') return failPreflight(found.job, fleetResult.reasons);

    if (found.job.kind === 'new_game') {
      const parent = parentIssueFor(deps.db, found.job, found.game);
      if (parent === null) return failPreflight(found.job, ['new game request is missing its title']);
      return fileParent(repo, found.job, parent);
    }

    const plan = JobPlan.parse(JSON.parse(found.job.plan));
    let tickets: JobPlan['tickets'];
    try {
      tickets = dependencyOrder(plan.tickets);
    } catch (error) {
      return failPreflight(found.job, [message(error)]);
    }
    const scopeTicket = found.job.kind === 'scope' ? scopeTicketForJob(deps.db, jobId, gameSlug) : null;
    if (found.job.kind === 'scope' && (scopeTicket === null || tickets.length !== 1 || tickets[0]?.key !== 'scope')) {
      return failPreflight(found.job, ['scope job is missing its session or scope ticket']);
    }

    try {
      await deps.issues.ensureLabel(repo, `feature:gm-${jobId}`, '0e8a16', 'OGM job');
      await deps.issues.ensureLabel(repo, `${gameSlug}:todo`, '6f42c1', 'ready to be worked');
      if (found.job.kind === 'feature') {
        await deps.issues.ensureLabel(repo, 'phase:mock', 'bfd4f2', 'creator review mock phase');
        await deps.issues.ensureLabel(repo, 'model:low', 'ededed', 'low reasoning effort');
      }
    } catch (error) {
      await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
      return { deferred: 'github' };
    }

    const reservation = Reservation.parse(JSON.parse(found.job.reservation));
    const spendCap = usdFromMicro(reservation.amountMicroUsd);
    let aiur: Awaited<ReturnType<IntakeDeps['aiurForGame']>>;
    try {
      aiur = await deps.aiurForGame(gameSlug);
    } catch (error) {
      await notify({ code: 'spend_cap_failed', jobId, reasons: [message(error)] });
      return { deferred: 'aiur' };
    }
    const rows = new Map(
      deps.db
        .select()
        .from(schema.jobTickets)
        .where(eq(schema.jobTickets.jobId, jobId))
        .all()
        .map((row) => [row.key, row]),
    );
    const issueNumbers: number[] = [];

    // Create and durably record the complete job before making any ticket runnable.
    for (const ticket of tickets) {
      const blockedBy = ticket.dependsOn.map((key) => rows.get(key)!.issueNumber);
      const rendered =
        scopeTicket ??
        (repairTriage?.ticket
          ? renderRepairIssue({ jobId, complexity: found.job.complexity, ticket: repairTriage.ticket })
          : renderIssue({
              jobId,
              complexity: found.job.complexity,
              plan,
              ticket,
              blockedBy,
              shippedSkills: deps.shippedSkills,
            }));
      let row = rows.get(ticket.key);

      if (!row) {
        let issue;
        try {
          issue = await deps.issues.findByMarkers(repo, jobId, ticket.key);
          if (!issue) {
            try {
              issue = await deps.issues.create(repo, {
                ...rendered,
                labels:
                  found.job.kind === 'scope'
                    ? rendered.labels.filter((label) => !isDaemonLabel(label))
                    : rendered.labels,
              });
            } catch (error) {
              if (!(error instanceof OutcomeUnknownError)) throw error;
              issue = await deps.issues.findByMarkers(repo, jobId, ticket.key);
              if (!issue) {
                await notify({ code: 'github_failed', jobId, reasons: [error.message] });
                return { deferred: 'github' };
              }
            }
          }
        } catch (error) {
          await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
          return { deferred: 'github' };
        }
        deps.db
          .insert(schema.jobTickets)
          .values({ jobId, key: ticket.key, issueNumber: issue.number, repo, sig: rendered.sig })
          .run();
        row = deps.db
          .select()
          .from(schema.jobTickets)
          .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.key, ticket.key)))
          .get()!;
        rows.set(ticket.key, row);
      }
    }

    for (const ticket of tickets) {
      let row = rows.get(ticket.key)!;
      if (row.capSetAt === null) {
        try {
          await setSpendCap(aiur, row.issueNumber, spendCap, sleep);
        } catch (error) {
          if (error instanceof AiurHttpError && error.status === 409 && error.code === 'spend_cap_exhausted') {
            const at = now().toISOString();
            deps.db
              .update(schema.jobs)
              .set({ state: 'paused_budget', pausedReason: 'budget_exhausted', updatedAt: at })
              .where(eq(schema.jobs.id, jobId))
              .run();
            deps.onJobChanged?.({
              jobId,
              gameId: found.job.gameId,
              familyId: found.job.familyId,
              state: 'paused_budget',
            });
            return { deferred: 'aiur' };
          }
          await notify({ code: 'spend_cap_failed', jobId, reasons: [message(error)] });
          return { deferred: 'aiur' };
        }
        const capSetAt = now().toISOString();
        deps.db
          .update(schema.jobTickets)
          .set({ capSetAt })
          .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.key, ticket.key)))
          .run();
        row = { ...row, capSetAt };
        rows.set(ticket.key, row);
      }

      if (row.todoAt === null) {
        try {
          const todo = `${gameSlug}:todo`;
          const labels = await deps.issues.labels(repo, row.issueNumber);
          if (!labels.includes(todo)) await deps.issues.addLabel(repo, row.issueNumber, todo);
        } catch (error) {
          await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
          return { deferred: 'github' };
        }
        const todoAt = now().toISOString();
        deps.db
          .update(schema.jobTickets)
          .set({ todoAt, filedAt: todoAt })
          .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.key, ticket.key)))
          .run();
        row = { ...row, todoAt, filedAt: todoAt };
        rows.set(ticket.key, row);
      }
      issueNumbers.push(row.issueNumber);
    }

    try {
      await aiur.nudgeTodo(issueNumbers.map(String));
    } catch (error) {
      await notify({ code: 'nudge_failed', jobId, reasons: [message(error)] });
    }

    const updatedAt = now().toISOString();
    deps.db
      .update(schema.jobs)
      .set({
        state: 'filed',
        aiurRepo: repo,
        aiurIssueNumber: issueNumbers[0],
        aiurSpendCapMicroUsd: reservation.amountMicroUsd,
        updatedAt,
      })
      .where(eq(schema.jobs.id, jobId))
      .run();
    if (found.job.kind === 'scope') {
      deps.db
        .update(schema.scopeSessions)
        .set({ ticket: String(issueNumbers[0]), updatedAt })
        .where(eq(schema.scopeSessions.jobId, jobId))
        .run();
    }
    deps.onJobChanged?.({
      jobId,
      gameId: found.job.gameId,
      familyId: found.job.familyId,
      state: 'filed',
    });
    return { filed: true, issues: issueNumbers };
  }

  // A New Game request files one parent issue and hands it to the Executor. The parent carries no dispatch label and
  // gets no spend cap and no aiur nudge, so no worker claims it; the Executor reads it and creates the Build Order
  // children with gm-new-game-plan. The request's own obligation ends at filing, so the job completes and releases
  // its slot instead of holding the new_game slot for a build nobody in this system owns.
  async function fileParent(
    repo: string,
    job: typeof schema.jobs.$inferSelect,
    parent: ParentIssue,
  ): Promise<FileResult> {
    try {
      await deps.issues.ensureLabel(repo, PARENT_LABEL, '0e8a16', 'new game request for the Executor');
      await deps.issues.ensureLabel(repo, `feature:gm-${job.id}`, '0e8a16', 'OGM job');
    } catch (error) {
      await notify({ code: 'github_failed', jobId: job.id, reasons: [message(error)] });
      return { deferred: 'github' };
    }

    let row = deps.db
      .select()
      .from(schema.jobTickets)
      .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, PARENT_TICKET_KEY)))
      .get();
    if (!row) {
      let issue: { number: number } | null;
      try {
        issue = await deps.issues.findByMarkers(repo, job.id, PARENT_TICKET_KEY);
        if (!issue) {
          try {
            issue = await deps.issues.create(repo, { title: parent.title, body: parent.body, labels: parent.labels });
          } catch (error) {
            if (!(error instanceof OutcomeUnknownError)) throw error;
            issue = await deps.issues.findByMarkers(repo, job.id, PARENT_TICKET_KEY);
            if (!issue) {
              await notify({ code: 'github_failed', jobId: job.id, reasons: [error.message] });
              return { deferred: 'github' };
            }
          }
        }
      } catch (error) {
        await notify({ code: 'github_failed', jobId: job.id, reasons: [message(error)] });
        return { deferred: 'github' };
      }
      if (!issue) return { deferred: 'github' };
      deps.db
        .insert(schema.jobTickets)
        .values({ jobId: job.id, key: PARENT_TICKET_KEY, issueNumber: issue.number, repo, sig: parent.sig })
        .run();
      row = deps.db
        .select()
        .from(schema.jobTickets)
        .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, PARENT_TICKET_KEY)))
        .get()!;
    }

    const updatedAt = now().toISOString();
    deps.db
      .update(schema.jobs)
      .set({ state: 'filed', aiurRepo: repo, aiurIssueNumber: row.issueNumber, updatedAt })
      .where(eq(schema.jobs.id, job.id))
      .run();
    deps.onJobChanged?.({
      jobId: job.id,
      gameId: job.gameId,
      familyId: job.familyId,
      state: 'filed',
    });
    deps.completeJob?.(job.id);
    return { filed: true, issues: [row.issueNumber] };
  }

  async function failPreflight(
    job: typeof schema.jobs.$inferSelect,
    reasons: string[],
  ): Promise<{ failed: 'preflight'; reasons: string[] }> {
    deps.failJob(job.id);
    await notify({ code: 'preflight_failed', jobId: job.id, reasons });
    return { failed: 'preflight', reasons };
  }

  async function sweep(): Promise<void> {
    const cutoff = new Date(now().getTime() - sweepMs).toISOString();
    const admitted = deps.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.state, 'admitted'), lte(schema.jobs.updatedAt, cutoff)))
      .all();
    for (const { id } of admitted) {
      try {
        await fileJob(id);
      } catch (error) {
        await notify({ code: 'sweep_failed', jobId: id, reasons: [message(error)] });
      }
    }
  }

  function start(): void {
    if (timer) return;
    unsubscribe = deps.subscribeAdmitted?.((jobId) => {
      void fileJob(jobId).catch((error) =>
        notify({ code: 'sweep_failed', jobId, reasons: [message(error)] }).catch(() => undefined),
      );
    });
    void sweep();
    timer = setInterval(() => void sweep(), sweepMs);
    timer.unref();
  }

  function stop(): void {
    unsubscribe?.();
    unsubscribe = undefined;
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { fileJob, start, stop, sweep };
}

function triageForRepair(db: IntakeDeps['db'], jobId: string): TriageResult | undefined {
  const row = db
    .select({ triageJson: schema.reports.triageJson })
    .from(schema.reports)
    .where(and(eq(schema.reports.jobId, jobId), eq(schema.reports.triageState, 'ready')))
    .get();
  if (!row?.triageJson) return undefined;
  const parsed = CompleteTriage.safeParse(JSON.parse(row.triageJson));
  return parsed.success && parsed.data.status === 'triaged' ? parsed.data.result : undefined;
}

async function setSpendCap(
  aiur: Awaited<ReturnType<IntakeDeps['aiurForGame']>>,
  issueNumber: number,
  amount: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await aiur.setSpendCap(String(issueNumber), amount);
      return;
    } catch (error) {
      if (
        !(error instanceof AiurHttpError) ||
        error.status !== 404 ||
        error.code !== 'ticket_not_found' ||
        attempt >= 2
      ) {
        throw error;
      }
      await sleep(SPEND_CAP_RETRY_MS);
    }
  }
}

function dependencyOrder(tickets: JobPlan['tickets']): JobPlan['tickets'] {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  if (byKey.size !== tickets.length) throw new Error('plan ticket keys must be unique');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: JobPlan['tickets'] = [];

  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`plan ticket dependency cycle at ${key}`);
    const ticket = byKey.get(key);
    if (!ticket) throw new Error(`unknown plan ticket dependency ${key}`);
    visiting.add(key);
    for (const dependency of ticket.dependsOn) visit(dependency);
    visiting.delete(key);
    visited.add(key);
    ordered.push(ticket);
  }

  for (const ticket of tickets) visit(ticket.key);
  return ordered;
}

function fleetKind(kind: 'new_game' | 'feature' | 'repair' | 'scope'): 'new_game' | 'feature' | 'repair' {
  return kind === 'scope' ? 'feature' : kind;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
