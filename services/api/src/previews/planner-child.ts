import { JobPlan } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { readRoles } from '@ogm/game-repo-template';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { admit } from '../jobs/admission.js';

const Child = z
  .object({
    key: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
    role: z.string(),
    decisions: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/)).max(100),
    complexity: z.number().int().min(1).max(5),
    plan: JobPlan,
  })
  .strict();

/** Submit one child through normal job admission and budget accounting, with an atomic per-game limit. */
export async function admitPlannerChild(deps: AppDeps, parentId: string, raw: unknown) {
  const parsed = Child.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'invalid_planner_child');
  const input = parsed.data;
  if (
    !readRoles().some((role) => role.label === input.role) ||
    input.plan.tickets.length !== 1 ||
    input.plan.tickets[0]!.dependsOn.length !== 0
  )
    throw new HttpError(400, 'invalid_planner_child');
  const parent = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, parentId)).get();
  if (!parent) throw new HttpError(404, 'new_game_request_not_found');
  const member = deps.db
    .select()
    .from(schema.familyMembers)
    .where(and(eq(schema.familyMembers.familyId, parent.familyId), eq(schema.familyMembers.userId, parent.creatorId)))
    .get();
  if (!member) throw new HttpError(403, 'invalid_planner_child');
  const storedPlan = JSON.parse(parent.plan) as { _plannerTicketLimit?: unknown };
  const storedLimit = storedPlan._plannerTicketLimit;
  const limit =
    typeof storedLimit === 'number' && Number.isSafeInteger(storedLimit) && storedLimit > 0
      ? storedLimit
      : (deps.config.plannerTicketLimit ?? 1);
  const ticket = input.plan.tickets[0]!;
  const plan = {
    ...input.plan,
    tickets: [
      {
        ...ticket,
        skills: [
          ...ticket.skills.filter((skill) => !skill.startsWith('role:') && !skill.startsWith('decision:')),
          input.role,
          ...input.decisions.map((id) => `decision:${id}`),
        ],
      },
    ],
  };
  return admit(
    {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: {
        dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
        defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
        resetZone: deps.config.resetZoneDefault,
      },
      plannerChild: { parentJobId: parentId, limit },
    },
    {
      gameId: parent.gameId,
      branchId: 'main',
      kind: 'feature',
      complexity: input.complexity,
      plan,
      start: 'now',
      idempotencyKey: `planner:${parentId}:${input.key}`,
    },
    { userId: parent.creatorId, familyId: parent.familyId, platformRole: 'none', capability: member.capability },
  );
}

export function plannerChildStatus(deps: AppDeps, parentId: string, key: string) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(key)) throw new HttpError(400, 'invalid_planner_child');
  const parent = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, parentId)).get();
  const child = deps.db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.idempotencyKey, `planner:${parentId}:${key}`),
        eq(schema.jobs.creatorId, parent?.creatorId ?? ''),
        eq(schema.jobs.gameId, parent?.gameId ?? ''),
      ),
    )
    .get();
  if (!child) throw new HttpError(404, 'planner_child_not_found');
  return { jobId: child.id, state: child.state, issueNumber: child.aiurIssueNumber };
}
