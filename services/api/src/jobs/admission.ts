import { randomUUID } from 'node:crypto';

import type {
  AllowanceExceeded,
  CreateJobAccepted,
  CreateJobRequest,
  JobKind,
  Reservation,
  SizeClass,
} from '@ogm/contracts';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { authorize, type Actor } from '@ogm/policy';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';

import { requireAuthorization } from '../accounts/families.js';
import { allowanceRemaining, familyDayTotal, platformRemaining } from '../budget/allowance.js';
import { reserve } from '../budget/ledger.js';
import { weeklyJobs } from '../budget/weekly-jobs.js';
import { dayKey, nextReset } from '../budget/reset.js';
import {
  getBudgetSettings,
  hasExplicitAllowance,
  hasExplicitPlatformCap,
  type BudgetDefaults,
} from '../budget/settings.js';
import { HttpError } from '../app/errors.js';
import { insertChatRow } from '../build-chat/store.js';
import { energySource } from '../energy/source.js';
import { energyBlock } from '../energy/view.js';
import type { AppEvents } from '../app/events.js';
import { acceptedFor } from './repo.js';
import { creatorHoldsSlot } from './creator-slot.js';
import { SLOT_STATES } from './state.js';

export class AdmissionRefused extends Error {
  constructor(readonly body: AllowanceExceeded) {
    super(body.error);
    this.name = 'AdmissionRefused';
  }
}

export type AdmissionDeps = {
  db: Db;
  sqlite: Sqlite;
  events: AppEvents;
  defaults: BudgetDefaults;
  now?: () => Date;
  qaEnergyProbe?: boolean;
};

const SIZE_BY_COMPLEXITY: Record<number, SizeClass> = { 1: 'small', 2: 'medium', 3: 'large', 4: 'huge', 5: 'huge' };
export function sizeFor(kind: JobKind, complexity: number): SizeClass {
  if (kind === 'scope') return 'small';
  const size = SIZE_BY_COMPLEXITY[complexity] ?? 'huge';
  if (kind === 'new_game' && (size === 'small' || size === 'medium')) return 'large';
  return size;
}

function reservationFor(db: Db, kind: JobKind, complexity: number): Reservation {
  const sizeClass = sizeFor(kind, complexity);
  const lookupKind = kind === 'scope' ? 'feature' : kind;
  const row = db
    .select()
    .from(schema.sizeClasses)
    .where(and(eq(schema.sizeClasses.kind, lookupKind), eq(schema.sizeClasses.sizeClass, sizeClass)))
    .get();
  if (!row) throw new Error(`missing size class ${lookupKind}/${sizeClass}`);
  return {
    amountMicroUsd: row.p80MicroUsd,
    sizeClass,
    confidence: row.samples >= 20 ? 'high' : row.samples >= 5 ? 'medium' : 'low',
  };
}

function refusal(
  error: AllowanceExceeded['error'],
  remainingMicroUsd: number,
  resetsAt: string,
  offers: AllowanceExceeded['offers'] = ['trim', 'split', 'queue', 'ask_admin'],
  window?: AllowanceExceeded['window'],
  reason?: AllowanceExceeded['reason'],
): never {
  throw new AdmissionRefused({
    error,
    remainingMicroUsd,
    resetsAt,
    offers,
    ...(window ? { window } : {}),
    ...(reason ? { reason } : {}),
  });
}

export async function admit(deps: AdmissionDeps, request: CreateJobRequest, actor: Actor): Promise<CreateJobAccepted> {
  const now = (deps.now ?? (() => new Date()))();
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, request.gameId)).get();
  if (!game) throw new HttpError(404, 'game_not_found');
  requireAuthorization(
    authorize(actor, 'job.create', { gameId: game.id, familyId: game.familyId, ownerId: game.ownerId }),
  );
  if (request.branchId !== 'main') throw new HttpError(409, 'branch_not_main');

  const outcome = deps.sqlite
    .transaction(() => {
      if (request.idempotencyKey) {
        const existing = deps.db
          .select()
          .from(schema.jobs)
          .where(and(eq(schema.jobs.creatorId, actor.userId), eq(schema.jobs.idempotencyKey, request.idempotencyKey)))
          .get();
        if (existing)
          return {
            created: false,
            response: acceptedFor(deps.db, existing, now),
            samePlan: JSON.parse(existing.plan).summary === request.plan.summary,
          };
      }

      const settings = getBudgetSettings(deps.db, game.familyId, deps.defaults);
      const reservation = reservationFor(deps.db, request.kind, request.complexity);
      const resetAt = nextReset(now, settings.resetZone);
      const resetsAt = resetAt.toISOString();
      const targetAt = request.start === 'at_reset' ? resetAt : now;
      {
        for (const at of [now, targetAt]) {
          const weekly = weeklyJobs(deps.db, actor.userId, at, deps.defaults.resetZone);
          const remaining =
            request.kind === 'new_game' || request.kind === 'scope'
              ? weekly.remaining.newGames
              : weekly.remaining.edits;
          if (remaining === 0)
            refusal('energy_limit_reached', 0, weekly.resetsAt, ['ask_admin'], 'week', 'weekly_user');
        }
      }
      const allowance = allowanceRemaining({
        db: deps.db,
        familyId: game.familyId,
        userId: actor.userId,
        now: targetAt,
        defaults: deps.defaults,
      });
      if (
        (deps.defaults.defaultAllowanceConfigured || hasExplicitAllowance(deps.db, game.familyId, actor.userId)) &&
        reservation.amountMicroUsd > allowance.remainingMicroUsd
      ) {
        refusal(
          'allowance_exceeded',
          allowance.remainingMicroUsd,
          resetsAt,
          request.start === 'at_reset' ? ['trim', 'split'] : undefined,
        );
      }
      const platformLeft = platformRemaining(deps.db, game.familyId, targetAt, deps.defaults);
      if (
        (deps.defaults.defaultAllowanceConfigured || hasExplicitPlatformCap(deps.db, game.familyId)) &&
        familyDayTotal(deps.db, game.familyId, targetAt, deps.defaults) + reservation.amountMicroUsd >
          settings.platformCapMicroUsd
      ) {
        refusal('platform_cap_reached', platformLeft, resetsAt);
      }
      // The instance's Energy ceilings overlap: the build must fit every window an admin set (#598).
      const energy = energySource({ db: deps.db, zone: deps.defaults.resetZone });
      const block = energyBlock(energy.snapshot(targetAt), reservation.amountMicroUsd);
      if (block) {
        // Queue only when the build would fit at the next reset, the moment a queued build starts.
        const fitsAtReset =
          request.start !== 'at_reset' && energyBlock(energy.snapshot(resetAt), reservation.amountMicroUsd) === null;
        // The 402 reaches players, who never see dollars: the window and its reset say what they need.
        refusal(
          'energy_limit_reached',
          0,
          block.resetsAt,
          fitsAtReset ? ['queue', 'ask_admin'] : ['ask_admin'],
          block.window,
        );
      }

      if (deps.qaEnergyProbe) throw new HttpError(409, 'qa_energy_probe_fenced');

      const slot = request.kind === 'new_game' ? 'new_game' : 'edit';
      const held = deps.db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.familyId, game.familyId),
            eq(schema.jobs.slot, slot),
            inArray(schema.jobs.state, SLOT_STATES),
            isNull(schema.jobs.releasedAt),
          ),
        )
        .all().length;
      // A just-freed slot belongs to the creator's older ready request in this same family and slot.
      const earlierReady = deps.db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.creatorId, actor.userId),
            eq(schema.jobs.familyId, game.familyId),
            eq(schema.jobs.slot, slot),
            eq(schema.jobs.state, 'queued'),
            or(eq(schema.jobs.start, 'now'), lte(schema.jobs.startAt, now.toISOString())),
          ),
        )
        .get();
      const state =
        request.start === 'at_reset' ||
        held >= settings.slots[slot] ||
        Boolean(earlierReady) ||
        creatorHoldsSlot(deps.db, actor.userId, deps.defaults.creatorJobLimit ?? 1)
          ? 'queued'
          : 'admitted';
      const at = now.toISOString();
      const id = `j_${randomUUID()}`;
      deps.db
        .insert(schema.jobs)
        .values({
          id,
          gameId: game.id,
          branchId: request.branchId,
          familyId: game.familyId,
          creatorId: actor.userId,
          kind: request.kind,
          complexity: request.complexity,
          state,
          start: request.start,
          startAt: request.start === 'at_reset' ? resetsAt : null,
          slot,
          plan: JSON.stringify(request.plan),
          reservation: JSON.stringify(reservation),
          hardCapMicroUsd: Math.round(reservation.amountMicroUsd * settings.hardCapMultiplier),
          idempotencyKey: request.idempotencyKey ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .run();
      // The typed edit chat's first message becomes the job (its plan and its ticket body), so it is also the
      // conversation's first message: stored with the job, already delivered by the ticket (#1270). A voice edit's
      // opening turn is stored in full by the voice transcript, so it gets no row here.
      if (request.idempotencyKey?.startsWith('edit:')) {
        insertChatRow(deps.sqlite, {
          jobId: id,
          at,
          actor: 'creator',
          kind: 'text',
          text: request.plan.summary,
          mirrorState: 'sent',
        });
      }
      reserve({
        db: deps.db,
        jobId: id,
        at: now,
        zone: settings.resetZone,
        forDay: dayKey(targetAt, settings.resetZone),
      });
      return {
        created: true,
        response: acceptedFor(deps.db, deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!, now),
      };
    })
    .immediate();

  if (outcome.created) {
    deps.events.emit('job.changed', {
      jobId: outcome.response.jobId,
      gameId: game.id,
      familyId: game.familyId,
      state: outcome.response.state,
    });
  }
  return { ...outcome.response, ...(outcome.created ? {} : { reused: true, samePlan: outcome.samePlan }) };
}
