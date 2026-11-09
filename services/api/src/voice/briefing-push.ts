import type { BriefingPush, VoiceTarget } from '@ogm/contracts';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { and, asc, eq } from 'drizzle-orm';

import type { AppEvents } from '../app/events.js';
import { sizeClassRow } from '../budget/estimate.js';
import { getBudgetSettings, type BudgetDefaults } from '../budget/settings.js';
import { budgetStatus } from '../budget/status.js';
import { toUnits } from '../budget/units.js';
import { parseCommandOptions } from '../job-commands/options.js';
import { decisionFocus } from './decision-focus.js';

export type { VoiceTarget } from '@ogm/contracts';

export type Briefing = BriefingPush & {
  target_key: string;
  summary: string;
  current_task: string;
  next_steps: string[];
  waiting_on?: string;
  questions: string[];
  extra: { title: string; text: string }[];
  sections: { id: 'budget' | 'progress' | 'estimate'; text: string }[];
  observed_at: string;
};

// `sqlite` reads the build chat's Command rows, which carry each option's media; without it an open decision is
// still named first, only without its cards' media.
export type BriefingDeps = { db: Db; sqlite?: Sqlite; defaults: BudgetDefaults; now?: () => Date };

export type PushDeps = BriefingDeps & {
  url: string;
  secret: string;
  log: (line: Record<string, unknown>) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const SIZES = ['small', 'medium', 'large', 'huge'] as const;
const PAUSED = 'Build paused at its reservation: ask an admin to raise it, or trim';

export const targetKey = (target: VoiceTarget) =>
  `${target.kind}:${target.kind === 'scope' ? target.session_id : target.job_id}`;

export function localTime(at: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(new Date(at))
      .toLowerCase();
  } catch {
    return localTime(at, 'UTC');
  }
}

function unitLabel(label: string, upper: number): string {
  return upper <= 1 && label.endsWith('s') ? label.slice(0, -1) : label;
}

function range(lower: number, upper: number): string {
  return lower === upper ? String(lower) : `${lower}–${upper}`;
}

function budgetText(
  deps: BriefingDeps,
  familyId: string,
  userId: string,
  now: Date,
): { remaining: string; sizes: string } {
  const settings = getBudgetSettings(deps.db, familyId, deps.defaults);
  const status = budgetStatus(deps, { familyId, userId, now });
  const units = (microUsd: number) => toUnits(microUsd, settings).units;
  const rows = Object.fromEntries(SIZES.map((size) => [size, sizeClassRow(deps.db, 'feature', size)])) as Record<
    (typeof SIZES)[number],
    ReturnType<typeof sizeClassRow>
  >;
  const small = [units(rows.small.p50MicroUsd), units(rows.small.p80MicroUsd)] as const;
  const medium = [units(rows.medium.p50MicroUsd), units(rows.medium.p80MicroUsd)] as const;
  const large = [units(rows.large.p50MicroUsd), units(rows.large.p80MicroUsd)] as const;
  const huge = units(rows.huge.p50MicroUsd);
  const remainingUnits = units(status.remainingMicroUsd);
  const remaining =
    `Remaining today: ${remainingUnits.toFixed(1)} ${unitLabel(settings.unitLabel, remainingUnits)} ` +
    `(${status.remainingPercent}%). Resets at ${localTime(status.resetsAt, settings.resetZone)}. ` +
    `Free slots: ${status.freeSlots.new_game} new game${status.freeSlots.new_game === 1 ? '' : 's'}, ` +
    `${status.freeSlots.edit} edit${status.freeSlots.edit === 1 ? '' : 's'}. ` +
    `Queued: ${status.queued.length === 0 ? 'none' : status.queued.length}.`;
  const sizes =
    `Rough sizes: small ≈ ${range(...small)} ${unitLabel(settings.unitLabel, small[1])}, ` +
    `medium ≈ ${range(...medium)}, large ≈ ${range(...large)}, huge ≈ ${huge}+ (low confidence).`;
  return { remaining, sizes };
}

export function jobFor(db: Db, target: VoiceTarget) {
  if (target.kind === 'build') return db.select().from(schema.jobs).where(eq(schema.jobs.id, target.job_id)).get();

  const session = db
    .select()
    .from(schema.scopeSessions)
    .where(
      and(
        eq(schema.scopeSessions.id, target.session_id),
        eq(schema.scopeSessions.gameId, target.game_id),
        eq(schema.scopeSessions.creatorId, target.creator_id),
      ),
    )
    .get();
  return session ? db.select().from(schema.jobs).where(eq(schema.jobs.id, session.jobId)).get() : undefined;
}

export async function buildBriefing(deps: BriefingDeps, target: VoiceTarget): Promise<Briefing> {
  const now = (deps.now ?? (() => new Date()))();
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, target.game_id)).get();
  const familyId =
    game?.familyId ??
    (target.kind === 'scope'
      ? deps.db
          .select({ familyId: schema.familyMembers.familyId })
          .from(schema.familyMembers)
          .where(eq(schema.familyMembers.userId, target.creator_id))
          .get()?.familyId
      : undefined);
  if (!familyId) throw new Error(`unknown game ${target.game_id}`);
  const job = jobFor(deps.db, target);
  const stage = job
    ? (deps.db.select().from(schema.jobProjections).where(eq(schema.jobProjections.jobId, job.id)).get()?.stageText ??
      job.state)
    : null;
  const commandRows = job
    ? deps.db
        .select({
          id: schema.commands.decisionId,
          version: schema.commands.version,
          question: schema.commands.question,
          options: schema.commands.options,
        })
        .from(schema.commands)
        .where(and(eq(schema.commands.jobId, job.id), eq(schema.commands.status, 'open')))
        .orderBy(asc(schema.commands.openedAt))
        .all()
    : [];
  // Voice started from a decision (#597) puts that decision first and tells the agent what its cards are.
  const focusId = target.kind === 'build' ? target.command_id : undefined;
  const ordered = [
    ...commandRows.filter(({ id }) => id === focusId),
    ...commandRows.filter(({ id }) => id !== focusId),
  ];
  const questions = ordered.map(({ question }) => question);
  const commands = ordered.flatMap(({ id, version, question, options }) => {
    const parsed = parseCommandOptions(options);
    return parsed === null ? [] : [{ id, version, question, options: parsed.map(({ id, label }) => ({ id, label })) }];
  });
  const focused = job && focusId !== undefined ? commands.find(({ id }) => id === focusId) : undefined;
  const focus = job && focused ? decisionFocus(deps.sqlite, job.id, focused) : undefined;
  let budget: { remaining: string; sizes: string } | undefined;
  try {
    budget = budgetText(deps, familyId, target.creator_id, now);
  } catch {
    // A missing budget source is not permission to guess. Progress still reaches the host, which adds a gap.
  }
  const paused = job?.state === 'paused_budget';
  const waitingOn = pendingWaitingOn(target) ?? (paused ? PAUSED : undefined);
  const budgetSummary = budget ? `${paused ? 'Build paused at its reservation. ' : ''}${budget.remaining}` : undefined;
  const progress = stage ?? (target.kind === 'scope' ? 'Agreeing the scope' : 'No build running.');
  const sections: Briefing['sections'] = [{ id: 'progress', text: progress }];
  if (budgetSummary && budget) {
    sections.unshift({ id: 'budget', text: `${budgetSummary}\n${budget.sizes}` });
    sections.push({ id: 'estimate', text: budget.sizes });
  }
  return {
    target_key: targetKey(target),
    summary:
      target.kind === 'build' && job
        ? (JSON.parse(job.plan) as { title: string }).title
        : (game?.title ?? 'a new game'),
    current_task: target.kind === 'scope' ? 'Agreeing the scope' : (stage ?? 'No build running'),
    next_steps: target.kind === 'scope' ? ['Confirm the plan', 'Start the build or queue it for the reset'] : [],
    ...(waitingOn ? { waiting_on: waitingOn } : {}),
    questions,
    commands,
    extra: [...(focus ? [focus] : []), ...(budgetSummary ? [{ title: 'Budget', text: budgetSummary }] : [])],
    sections,
    observed_at: now.toISOString(),
  };
}

const lastFailureLog = new Map<string, number>();

// Best effort: never rejects, gives up at the timeout, logs a failing target at most once a minute.
export async function pushBriefing(deps: PushDeps, target: VoiceTarget): Promise<void> {
  const key = targetKey(target);
  try {
    const briefing = await buildBriefing(deps, target);
    const response = await (deps.fetch ?? fetch)(`${deps.url.replace(/\/$/, '')}/internal/briefing`, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(briefing),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 300),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`voice host answered ${response.status}`);
  } catch (error) {
    const at = Date.now();
    if (at - (lastFailureLog.get(key) ?? -Infinity) < 60_000) return;
    lastFailureLog.set(key, at);
    deps.log({ event: 'briefing-push-failed', target_key: key, error: (error as Error).message });
  }
}

const targets = new Map<string, { target: VoiceTarget; expiresAt: number }>();
const pending = new Map<string, { text: string; expiresAt: number }>();
let pusher: {
  deps: PushDeps;
  debounceMs: number;
  timers: Map<string, NodeJS.Timeout>;
} | null = null;

function pendingWaitingOn(target: VoiceTarget): string | undefined {
  const key = targetKey(target);
  const entry = pending.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    pending.delete(key);
    return undefined;
  }
  return entry.text;
}

export function setVoiceWaitingOn(target: VoiceTarget, text: string, ttlMs = 10 * 60_000): void {
  pending.set(targetKey(target), { text, expiresAt: Date.now() + ttlMs });
  if (pusher) void pushBriefing(pusher.deps, target);
}

export function clearVoiceWaitingOn(target: VoiceTarget): void {
  pending.delete(targetKey(target));
}

export function activeTargetFor(creatorId: string): VoiceTarget | null {
  const entry = targets.get(creatorId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    targets.delete(creatorId);
    return null;
  }
  return entry.target;
}

function schedulePush(creatorId: string): void {
  const active = pusher;
  if (!active || !activeTargetFor(creatorId)) return;
  clearTimeout(active.timers.get(creatorId));
  const timer = setTimeout(() => {
    active.timers.delete(creatorId);
    const target = activeTargetFor(creatorId);
    if (target) void pushBriefing(active.deps, target);
  }, active.debounceMs);
  timer.unref();
  active.timers.set(creatorId, timer);
}

// OGM-085 calls this after minting a voice token; the newest target per creator wins and is pushed at once.
export function registerVoiceTarget(target: VoiceTarget, ttlSec = 1800): void {
  targets.set(target.creator_id, { target, expiresAt: Date.now() + ttlSec * 1000 });
  if (pusher) void pushBriefing(pusher.deps, target);
}

export function startBriefingPush(
  deps: PushDeps & { events: AppEvents; debounceMs?: number; intervalMs?: number },
): () => void {
  const timers = new Map<string, NodeJS.Timeout>();
  const interval = setInterval(() => {
    for (const creatorId of targets.keys()) {
      const target = activeTargetFor(creatorId);
      if (target) void pushBriefing(deps, target);
    }
  }, deps.intervalMs ?? 30_000);
  interval.unref();
  pusher = { deps, debounceMs: deps.debounceMs ?? 500, timers };
  const offBudget = deps.events.on('budget.changed', ({ userId }) => schedulePush(userId));
  const offJob = deps.events.on('job.changed', ({ jobId }) => {
    const job = deps.db
      .select({ creatorId: schema.jobs.creatorId })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .get();
    if (job) schedulePush(job.creatorId);
  });
  return () => {
    offBudget();
    offJob();
    clearInterval(interval);
    for (const timer of timers.values()) clearTimeout(timer);
    pusher = null;
    targets.clear();
    pending.clear();
    lastFailureLog.clear();
  };
}
