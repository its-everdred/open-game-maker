import { AiurHttpError } from '@ogm/aiur-client';
import { CompleteTriage, JobPlan, Reservation, type TriageResult } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, eq, exists, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { isDaemonLabel } from '@ogm/game-repo-template';

import { OutcomeUnknownError } from '../github/issues.js';
import { scopeTicketForJob } from '../scope/file.js';
import { PARENT_LABEL, PARENT_TICKET_KEY, parentIssueFor, type ParentIssue } from './parent.js';
import { PLANNER_TICKET_KEY, plannerIssue } from './planner-issue.js';
import { withJobDispatchLock } from './job-lock.js';
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
    if (current)
      return current.then((result) => {
        const job = deps.db
          .select({ state: schema.jobs.state })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, jobId))
          .get();
        return job?.state === 'admitted' ? fileJob(jobId) : result;
      });
    const key = deps.db
      .select({ key: schema.jobs.idempotencyKey })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .get()?.key;
    const parent = /^planner:(j_[A-Za-z0-9-]+):[A-Za-z0-9_-]{1,60}$/.exec(key ?? '')?.[1];
    const dispatch = () => withJobDispatchLock(jobId, () => performFileJob(jobId));
    const pending = (parent && parent !== jobId ? withJobDispatchLock(parent, dispatch) : dispatch()).finally(() =>
      inFlight.delete(jobId),
    );
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
    const plannerChild = (found.job.idempotencyKey ?? '').startsWith('planner:');
    const queuedPlannerChild = found.job.state === 'queued' && plannerChild;
    if (found.job.state !== 'admitted' && !queuedPlannerChild) {
      const pendingPlanner =
        found.job.kind === 'new_game' && found.job.state === 'filed'
          ? deps.db
              .select()
              .from(schema.jobTickets)
              .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.key, PLANNER_TICKET_KEY)))
              .get()
          : undefined;
      if (!pendingPlanner || pendingPlanner.todoAt !== null) return { skipped: `state:${found.job.state}` };
    }
    const repairTriage = found.job.kind === 'repair' ? triageForRepair(deps.db, jobId) : undefined;
    if (found.job.kind === 'repair' && !repairTriage?.ticket) return { deferred: 'triage' };

    if (plannerChild) {
      const parentMatch = /^planner:(j_[A-Za-z0-9-]+):[A-Za-z0-9_-]{1,60}$/.exec(found.job.idempotencyKey ?? '');
      const parent = parentMatch
        ? deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, parentMatch[1]!)).get()
        : undefined;
      const projection = parentMatch
        ? deps.db
            .select({ lifecycle: schema.jobProjections.lifecycle })
            .from(schema.jobProjections)
            .where(eq(schema.jobProjections.jobId, parentMatch[1]!))
            .get()
        : undefined;
      if (
        !parent ||
        parent.state === 'failed' ||
        parent.state === 'cancelled' ||
        projection?.lifecycle === 'cancelled'
      ) {
        const plan = JobPlan.parse(JSON.parse(found.job.plan));
        const ticket = plan.tickets[0];
        if (!ticket) return failPreflight(found.job, ['planner child has no ticket']);
        const recorded = deps.db
          .select()
          .from(schema.jobTickets)
          .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.key, ticket.key)))
          .get();
        const parentTicket = parentMatch
          ? (deps.db
              .select()
              .from(schema.jobTickets)
              .where(and(eq(schema.jobTickets.jobId, parentMatch[1]!), eq(schema.jobTickets.key, PLANNER_TICKET_KEY)))
              .get() ??
            deps.db
              .select()
              .from(schema.jobTickets)
              .where(and(eq(schema.jobTickets.jobId, parentMatch[1]!), eq(schema.jobTickets.key, PARENT_TICKET_KEY)))
              .get())
          : undefined;
        const cleanupRepo = recorded?.repo ?? found.job.aiurRepo ?? parentTicket?.repo;
        if (!cleanupRepo) return { deferred: 'github' };
        try {
          const issue = recorded ?? (await deps.issues.findByMarkers(cleanupRepo, jobId, ticket.key));
          if (issue) {
            if (!deps.issues.close) throw new Error('issue closer unavailable');
            await deps.issues.close(
              'repo' in issue ? issue.repo : cleanupRepo,
              'issueNumber' in issue ? issue.issueNumber : issue.number,
            );
          }
        } catch (error) {
          await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
          return { deferred: 'github' };
        }
        if ((parent?.state === 'cancelled' || projection?.lifecycle === 'cancelled') && deps.cancelJob)
          deps.cancelJob(jobId);
        else deps.failJob(jobId);
        return { skipped: 'parent_terminal' };
      }
      if (queuedPlannerChild && found.job.aiurIssueNumber !== null) {
        const staged = deps.db
          .select({ todoAt: schema.jobTickets.todoAt })
          .from(schema.jobTickets)
          .where(eq(schema.jobTickets.jobId, jobId))
          .get();
        if (staged?.todoAt) return { skipped: 'staged' };
      }
    }

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
    // A game sharing its repository's registered daemon is worked by that daemon, which reads its own label prefix.
    const daemonSlug = fleetResult.daemon.slug;
    const todo = `${fleetResult.labelPrefix ?? gameSlug}:todo`;

    if (found.job.kind === 'new_game') {
      if (!deps.shippedSkills.includes('gm-new-game-plan')) {
        await notify({
          code: 'preflight_failed',
          jobId,
          reasons: ['deployed skill pack does not contain gm-new-game-plan'],
        });
        return { deferred: 'aiur' };
      }
      const parent = parentIssueFor(deps.db, found.job, found.game);
      if (parent === null) return failPreflight(found.job, ['new game request is missing its title']);
      return fileParent(repo, found.job, parent, gameSlug, daemonSlug, todo);
    }

    const plan = JobPlan.parse(JSON.parse(found.job.plan));
    const parentMatch = /^planner:(j_[A-Za-z0-9-]+):[A-Za-z0-9_-]{1,60}$/.exec(found.job.idempotencyKey ?? '');
    const parentRow = parentMatch
      ? deps.db
          .select()
          .from(schema.jobTickets)
          .where(and(eq(schema.jobTickets.jobId, parentMatch[1]!), eq(schema.jobTickets.key, PARENT_TICKET_KEY)))
          .get()
      : undefined;
    const role = plan.tickets[0]?.skills.find((skill) => skill.startsWith('role:'));
    if (parentMatch && (!parentRow || !role))
      return failPreflight(found.job, ['planner child is missing its parent or role']);
    if (parentRow && parentRow.repo.toLowerCase() !== repo) {
      await notify({ code: 'preflight_failed', jobId, reasons: ['planner parent and game repository differ'] });
      return { deferred: 'github' };
    }
    const planner =
      parentRow && role
        ? {
            parent: parentRow.issueNumber,
            gameSlug,
            role,
            decisions: plan.tickets[0]!.skills.filter((skill) => skill.startsWith('decision:')).map((skill) =>
              skill.slice(9),
            ),
          }
        : undefined;
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
      await deps.issues.ensureLabel(repo, todo, '6f42c1', 'ready to be worked');
      if (found.job.kind === 'feature') {
        await deps.issues.ensureLabel(repo, 'phase:mock', 'bfd4f2', 'creator review mock phase');
        await deps.issues.ensureLabel(repo, 'model:low', 'ededed', 'low reasoning effort');
      }
      if (planner)
        for (const label of [`game:${gameSlug}`, planner.role, 'priority:1', 'ogm:planner-child'])
          await deps.issues.ensureLabel(repo, label);
    } catch (error) {
      await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
      return { deferred: 'github' };
    }

    const reservation = Reservation.parse(JSON.parse(found.job.reservation));
    const spendCap = usdFromMicro(reservation.amountMicroUsd);
    let aiur: Awaited<ReturnType<IntakeDeps['aiurForGame']>>;
    try {
      aiur = await deps.aiurForGame(daemonSlug);
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
              planner,
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
            if (queuedPlannerChild) {
              await notify({ code: 'spend_cap_failed', jobId, reasons: [message(error)] });
              return { deferred: 'aiur' };
            }
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

      if (queuedPlannerChild) {
        try {
          if (!parentRow || !deps.issues.blockBy) throw new Error('planner gate unavailable');
          await deps.issues.blockBy(repo, row.issueNumber, parentRow.issueNumber);
          if (row.todoAt === null) {
            const labels = await deps.issues.labels(repo, row.issueNumber);
            const statePrefix = todo.slice(0, -'todo'.length);
            if (labels.some((label) => label.startsWith(statePrefix) && label !== todo))
              throw new Error('planner child state changed before queueing');
            if (!labels.includes(todo)) await deps.issues.addLabel(repo, row.issueNumber, todo);
            const todoAt = now().toISOString();
            deps.db
              .update(schema.jobTickets)
              .set({ todoAt, filedAt: todoAt })
              .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.key, ticket.key)))
              .run();
          }
        } catch (error) {
          await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
          return { deferred: 'github' };
        }
        const updatedAt = now().toISOString();
        deps.db
          .update(schema.jobs)
          .set({
            aiurRepo: repo,
            aiurIssueNumber: row.issueNumber,
            aiurSpendCapMicroUsd: reservation.amountMicroUsd,
            updatedAt,
          })
          .where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.state, ['queued', 'admitted'])))
          .run();
        return { filed: true, issues: [row.issueNumber] };
      }

      if (planner) {
        try {
          if (!deps.issues.unblockBy) throw new Error('planner gate unavailable');
          await deps.issues.unblockBy(repo, row.issueNumber, planner.parent);
        } catch (error) {
          await notify({ code: 'github_failed', jobId, reasons: [message(error)] });
          return { deferred: 'github' };
        }
      }

      if (row.todoAt === null) {
        try {
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
    const filedUpdate = deps.db
      .update(schema.jobs)
      .set({
        state: 'filed',
        aiurRepo: repo,
        aiurIssueNumber: issueNumbers[0],
        aiurSpendCapMicroUsd: reservation.amountMicroUsd,
        updatedAt,
      })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.state, 'admitted')))
      .run();
    if (filedUpdate.changes === 0) return { filed: true, issues: issueNumbers };
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

  // The parent remains a planning record; a separate capped planner ticket is the job's active worker.
  async function fileParent(
    repo: string,
    job: typeof schema.jobs.$inferSelect,
    parent: ParentIssue,
    gameSlug: string,
    daemonSlug: string,
    todo: string,
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

    // Pin the policy before creating the issue, so retries and later config changes keep the same bound.
    const storedPlan = JSON.parse(job.plan) as Record<string, unknown>;
    const storedLimit = storedPlan._plannerTicketLimit;
    const ticketLimit =
      typeof storedLimit === 'number' && Number.isSafeInteger(storedLimit) && storedLimit > 0
        ? storedLimit
        : (deps.plannerTicketLimit ?? 1);
    if (storedLimit !== ticketLimit) {
      deps.db
        .update(schema.jobs)
        .set({ plan: JSON.stringify({ ...storedPlan, _plannerTicketLimit: ticketLimit }) })
        .where(eq(schema.jobs.id, job.id))
        .run();
    }
    const rendered = plannerIssue({
      jobId: job.id,
      parentNumber: row.issueNumber,
      gameSlug,
      ticketLimit,
    });
    let planner = deps.db
      .select()
      .from(schema.jobTickets)
      .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, PLANNER_TICKET_KEY)))
      .get();
    try {
      for (const label of [...rendered.labels, todo]) await deps.issues.ensureLabel(repo, label);
      if (!planner) {
        let issue = await deps.issues.findByMarkers(repo, job.id, PLANNER_TICKET_KEY);
        if (!issue) {
          try {
            const created = await deps.issues.create(repo, {
              title: rendered.title,
              body: rendered.body,
              labels: rendered.labels,
            });
            issue = { ...created, labels: rendered.labels };
          } catch (error) {
            if (!(error instanceof OutcomeUnknownError)) throw error;
            issue = await deps.issues.findByMarkers(repo, job.id, PLANNER_TICKET_KEY);
            if (!issue) throw error;
          }
        }
        deps.db
          .insert(schema.jobTickets)
          .values({
            jobId: job.id,
            key: PLANNER_TICKET_KEY,
            issueNumber: issue.number,
            repo,
            sig: rendered.sig,
          })
          .run();
        planner = deps.db
          .select()
          .from(schema.jobTickets)
          .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, PLANNER_TICKET_KEY)))
          .get()!;
      }
    } catch (error) {
      await notify({ code: 'github_failed', jobId: job.id, reasons: [message(error)] });
      return { deferred: 'github' };
    }
    let aiur: Awaited<ReturnType<IntakeDeps['aiurForGame']>>;
    try {
      aiur = await deps.aiurForGame(daemonSlug);
      if (planner.capSetAt === null) {
        const reservation = Reservation.parse(JSON.parse(job.reservation));
        await setSpendCap(aiur, planner.issueNumber, usdFromMicro(reservation.amountMicroUsd), sleep);
        deps.db
          .update(schema.jobTickets)
          .set({ capSetAt: now().toISOString() })
          .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, PLANNER_TICKET_KEY)))
          .run();
      }
    } catch (error) {
      await notify({ code: 'spend_cap_failed', jobId: job.id, reasons: [message(error)] });
      return { deferred: 'aiur' };
    }
    // Make the planner visible to the lifecycle and chat before its dispatch label can wake a worker.
    const updatedAt = now().toISOString();
    const reservation = Reservation.parse(JSON.parse(job.reservation));
    const transitioned = deps.db
      .update(schema.jobs)
      .set({
        state: 'filed',
        aiurRepo: repo,
        aiurIssueNumber: planner.issueNumber,
        aiurSpendCapMicroUsd: reservation.amountMicroUsd,
        updatedAt,
      })
      .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.state, 'admitted')))
      .run();
    if (transitioned.changes === 0) {
      const current = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
      if (current?.state !== 'filed' || current.aiurIssueNumber !== planner.issueNumber)
        return { skipped: `state:${current?.state ?? 'missing'}` };
    }
    deps.onJobChanged?.({ jobId: job.id, gameId: job.gameId, familyId: job.familyId, state: 'filed' });
    try {
      if (planner.todoAt === null) {
        const labels = await deps.issues.labels(repo, planner.issueNumber);
        if (!labels.includes(todo)) await deps.issues.addLabel(repo, planner.issueNumber, todo);
        deps.db
          .update(schema.jobTickets)
          .set({ todoAt: now().toISOString(), filedAt: now().toISOString() })
          .where(and(eq(schema.jobTickets.jobId, job.id), eq(schema.jobTickets.key, PLANNER_TICKET_KEY)))
          .run();
      }
    } catch (error) {
      await notify({ code: 'github_failed', jobId: job.id, reasons: [message(error)] });
      return { deferred: 'github' };
    }
    try {
      await aiur.nudgeTodo([String(planner.issueNumber)]);
    } catch (error) {
      await notify({ code: 'nudge_failed', jobId: job.id, reasons: [message(error)] });
    }
    return { filed: true, issues: [row.issueNumber, planner.issueNumber] };
  }

  async function failPreflight(job: typeof schema.jobs.$inferSelect, reasons: string[]): Promise<FileResult> {
    await notify({ code: 'preflight_failed', jobId: job.id, reasons });
    if ((job.idempotencyKey ?? '').startsWith('planner:')) return { deferred: 'aiur' };
    deps.failJob(job.id);
    return { failed: 'preflight', reasons };
  }

  async function sweep(): Promise<void> {
    const cutoff = new Date(now().getTime() - sweepMs).toISOString();
    const admitted = deps.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          lte(schema.jobs.updatedAt, cutoff),
          or(
            eq(schema.jobs.state, 'admitted'),
            and(eq(schema.jobs.state, 'queued'), sql`substr(${schema.jobs.idempotencyKey}, 1, 8) = 'planner:'`),
            and(
              eq(schema.jobs.state, 'filed'),
              eq(schema.jobs.kind, 'new_game'),
              exists(
                deps.db
                  .select({ id: schema.jobTickets.issueNumber })
                  .from(schema.jobTickets)
                  .where(
                    and(
                      eq(schema.jobTickets.jobId, schema.jobs.id),
                      eq(schema.jobTickets.key, PLANNER_TICKET_KEY),
                      isNull(schema.jobTickets.todoAt),
                    ),
                  ),
              ),
            ),
          ),
        ),
      )
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
