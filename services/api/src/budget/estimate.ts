import type { Confidence, Estimate, JobKind, SizeClass } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, eq, gt } from 'drizzle-orm';

import type { AppEvents } from '../app/events.js';
import { HttpError } from '../app/errors.js';
import { sizeFor } from '../jobs/admission.js';
import { allowanceRemaining } from './allowance.js';
import { hasExplicitAllowance, type BudgetDefaults } from './settings.js';
import { weeklyJobs } from './weekly-jobs.js';

type RowKind = Exclude<JobKind, 'scope'>;
const SIZE_ORDER: readonly SizeClass[] = ['small', 'medium', 'large', 'huge'];
const MIN_SAMPLES = 5;

const words = (summary: string) => summary.trim().split(/\s+/).filter(Boolean).length;

// Deterministic size class: explicit complexity wins (admission's mapping); else keywords, then length.
export function classify(summary: string, kind: JobKind = 'feature', complexity?: number): SizeClass {
  if (complexity !== undefined) return sizeFor(kind, complexity);
  const text = summary.toLowerCase();
  const count = words(text);
  let size: SizeClass = 'small';
  if (/\bmultiplayer\b|\bnew (world|game)\b|\brewrite\b|\bwhole\b/.test(text)) size = 'huge';
  else if (/\bnew (enem|level|system|boss|mode)|\bcutscene|\binventor|\bdialog/.test(text) || count > 60)
    size = 'large';
  else if (/\b(add|new|another|more)\b/.test(text) || count > 20) size = 'medium';
  if (kind === 'new_game' && SIZE_ORDER.indexOf(size) < SIZE_ORDER.indexOf('large')) return 'large';
  return size;
}

export function confidenceFor(samples: number): Confidence {
  return samples >= 20 ? 'high' : samples >= MIN_SAMPLES ? 'medium' : 'low';
}

export function sizeClassRow(db: Db, kind: JobKind, sizeClass: SizeClass) {
  const rowKind: RowKind = kind === 'scope' ? 'feature' : kind;
  const row = db
    .select()
    .from(schema.sizeClasses)
    .where(and(eq(schema.sizeClasses.kind, rowKind), eq(schema.sizeClasses.sizeClass, sizeClass)))
    .get();
  if (!row) throw new Error(`missing size class ${rowKind}/${sizeClass}`);
  return row;
}

export type EstimateDeps = { db: Db; defaults: BudgetDefaults; now?: () => Date };

export function estimate(
  deps: EstimateDeps,
  input: { familyId: string; creatorId: string; gameId: string; summary: string; kind?: JobKind; complexity?: number },
): Estimate {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, input.gameId)).get();
  if (!game || game.familyId !== input.familyId) throw new HttpError(404, 'game_not_found');
  const kind = input.kind ?? 'feature';
  const sizeClass = classify(input.summary, kind, input.complexity);
  const row = sizeClassRow(deps.db, kind, sizeClass);
  const now = (deps.now ?? (() => new Date()))();
  const { remainingMicroUsd } = allowanceRemaining({
    db: deps.db,
    familyId: input.familyId,
    userId: input.creatorId,
    now,
    defaults: deps.defaults,
  });
  const weekly = weeklyJobs(deps.db, input.creatorId, now, deps.defaults.resetZone);
  const remaining = kind === 'new_game' || kind === 'scope' ? weekly.remaining.newGames : weekly.remaining.edits;
  return {
    sizeClass,
    rangeMicroUsd: [row.p50MicroUsd, row.p80MicroUsd],
    confidence: confidenceFor(row.samples),
    fits:
      remaining !== 0 &&
      ((!deps.defaults.defaultAllowanceConfigured && !hasExplicitAllowance(deps.db, input.familyId, input.creatorId)) ||
        row.p80MicroUsd <= remainingMicroUsd),
  };
}

// Nearest rank: p80 of five samples is the fourth, so one outlier does not become the price.
const percentile = (sorted: readonly number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

// Replaces a seed row only once a (kind, size class) has MIN_SAMPLES done jobs with real usage.
export function refineSizeClasses(db: Db): { updated: { kind: RowKind; sizeClass: SizeClass; samples: number }[] } {
  return db.transaction((tx) => {
    const usage = new Map<string, number[]>();
    for (const job of tx
      .select({ kind: schema.jobs.kind, reservation: schema.jobs.reservation, usage: schema.jobs.usageMicroUsd })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.state, 'done'), gt(schema.jobs.usageMicroUsd, 0)))
      .all()) {
      if (job.kind === 'scope') continue;
      const { sizeClass } = JSON.parse(job.reservation) as { sizeClass: SizeClass };
      const key = `${job.kind}/${sizeClass}`;
      const amounts = usage.get(key);
      if (amounts) amounts.push(job.usage);
      else usage.set(key, [job.usage]);
    }
    const updated: { kind: RowKind; sizeClass: SizeClass; samples: number }[] = [];
    for (const [key, amounts] of usage) {
      if (amounts.length < MIN_SAMPLES) continue;
      const [kind, sizeClass] = key.split('/') as [RowKind, SizeClass];
      const sorted = [...amounts].sort((a, b) => a - b);
      tx.update(schema.sizeClasses)
        .set({ p50MicroUsd: percentile(sorted, 0.5), p80MicroUsd: percentile(sorted, 0.8), samples: sorted.length })
        .where(and(eq(schema.sizeClasses.kind, kind), eq(schema.sizeClasses.sizeClass, sizeClass)))
        .run();
      updated.push({ kind, sizeClass, samples: sorted.length });
    }
    return { updated };
  });
}

const msUntilNext3am = (now: Date) => {
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
};

// Boot, nightly at 03:00 host time, and 60 s after the last terminal job.
export function startEstimateRefinement(deps: {
  db: Db;
  events: AppEvents;
  log: (line: Record<string, unknown>) => void;
}): () => void {
  const run = () => {
    try {
      const { updated } = refineSizeClasses(deps.db);
      if (updated.length > 0) deps.log({ event: 'size-classes-refined', updated });
    } catch (error) {
      deps.log({ event: 'size-classes-refine-error', stack: (error as Error).stack ?? String(error) });
    }
  };
  let nightly: NodeJS.Timeout;
  const schedule = () => {
    nightly = setTimeout(() => {
      run();
      schedule();
    }, msUntilNext3am(new Date()));
    nightly.unref();
  };
  let debounce: NodeJS.Timeout | undefined;
  const off = deps.events.on('job.changed', ({ state }) => {
    if (state !== 'done' && state !== 'failed' && state !== 'cancelled') return;
    clearTimeout(debounce);
    debounce = setTimeout(run, 60_000);
    debounce.unref();
  });
  run();
  schedule();
  return () => {
    off();
    clearTimeout(nightly);
    clearTimeout(debounce);
  };
}
