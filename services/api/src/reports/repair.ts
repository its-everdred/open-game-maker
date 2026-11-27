import type { CreateJobAccepted, CreateJobRequest, JobPlan } from '@ogm/contracts';
import { schema } from '@ogm/db';
import type { Actor } from '@ogm/policy';
import { and, eq, like, ne, or } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { AdmissionRefused, admit, type AdmissionDeps } from '../jobs/admission.js';
import type { Reproduction } from './classify.js';
import { REPAIR_ATTEMPTS, REPAIR_COMPLEXITY } from './policy.js';

export type RepairInput = {
  gameId: string;
  ownerId: string;
  familyId: string;
  reportId: string;
  releaseId?: string | null;
  signature: string;
  reproduction: Reproduction;
  // The signature's earlier repair job, when it finished and the bug came back.
  previousJobId?: string | null;
};

export type RepairOutcome =
  | { jobId: string; pendingBudget?: undefined; attemptsExhausted?: undefined }
  | {
      jobId?: undefined;
      pendingBudget: true;
      attemptsExhausted?: undefined;
      resetsAt?: string;
      budgetReason?: 'weekly_user';
    }
  | { jobId?: undefined; pendingBudget?: undefined; attemptsExhausted: true };

// Redacted metadata only: no report text, no frames, no bundle key. The repair agent resolves
// the report id to its diagnostics through the platform, never through the issue body.
export function repairPlan(input: Pick<RepairInput, 'reportId' | 'releaseId' | 'signature' | 'reproduction'>): JobPlan {
  return {
    title: `Repair: ${input.signature.slice(0, 8)}`,
    summary: [
      `Release ${input.releaseId ?? 'draft'}.`,
      `Reproduction: ${input.reproduction}.`,
      `Signature ${input.signature}.`,
      `Report ${input.reportId}.`,
    ].join(' '),
    scope: {
      included: ['fix the reported bug', 'add a failing promise test that passes after the fix'],
      excluded: ['new features'],
    },
    tickets: [
      {
        key: 'repair',
        skills: ['gm-repair', 'gm-verify'],
        dependsOn: [],
        acceptanceCriteria: ['gm test green', 'promise test present', `at most ${REPAIR_ATTEMPTS} attempts`],
      },
    ],
  };
}

function ownerActor(deps: AdmissionDeps, input: RepairInput): Actor {
  const member = deps.db
    .select({ capability: schema.familyMembers.capability })
    .from(schema.familyMembers)
    .where(and(eq(schema.familyMembers.familyId, input.familyId), eq(schema.familyMembers.userId, input.ownerId)))
    .get();
  if (!member) throw new HttpError(409, 'owner_not_member');
  return { userId: input.ownerId, familyId: input.familyId, platformRole: 'none', capability: member.capability };
}

// Earlier repair jobs for this crash signature on this game, other than the one `key` names.
function earlierRepairs(deps: AdmissionDeps, input: RepairInput, key: string): number {
  const base = `repair:${input.signature}`;
  return deps.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.gameId, input.gameId),
        eq(schema.jobs.kind, 'repair'),
        or(eq(schema.jobs.idempotencyKey, base), like(schema.jobs.idempotencyKey, `${base}:after:%`)),
        ne(schema.jobs.idempotencyKey, key),
      ),
    )
    .all().length;
}

// The owner pays for repairs on their game, inside their own allowance; a refusal never spends.
// A signature gets at most REPAIR_ATTEMPTS repair jobs; after that the report is stored for the owner.
export async function admitRepair(deps: AdmissionDeps, input: RepairInput): Promise<RepairOutcome> {
  const idempotencyKey = input.previousJobId
    ? `repair:${input.signature}:after:${input.previousJobId}`
    : `repair:${input.signature}`;
  if (earlierRepairs(deps, input, idempotencyKey) >= REPAIR_ATTEMPTS) return { attemptsExhausted: true };
  const request: CreateJobRequest = {
    gameId: input.gameId,
    branchId: 'main',
    kind: 'repair',
    complexity: REPAIR_COMPLEXITY,
    plan: repairPlan(input),
    start: 'now',
    idempotencyKey,
  };
  let accepted: CreateJobAccepted;
  try {
    accepted = await admit(deps, request, ownerActor(deps, input));
  } catch (error) {
    if (error instanceof AdmissionRefused)
      return {
        pendingBudget: true,
        ...(error.body.error === 'energy_limit_reached' ? { resetsAt: error.body.resetsAt } : {}),
        ...(error.body.reason === 'weekly_user' ? { budgetReason: 'weekly_user' as const } : {}),
      };
    throw error;
  }
  return { jobId: accepted.jobId };
}
