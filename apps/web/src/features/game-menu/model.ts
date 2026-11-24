import { JOB_STAGE_WORDS, type EnergyView, type Job } from '@ogm/contracts/browser';

import { isTerminal } from '../build-chat/jobs';
import { WINDOW_LABELS } from '../energy/api';
import type { WorkerBuild } from '../worker-builds/BuildTracker';
import { commandSource, type ReviewCommand, type ReviewTarget } from '../worker-builds/review-command';
import type { WorkerReview } from '../worker-builds/useWorkerReviews';

// What the edit menu lists (#1326): ready reviews first, then the game's work with its progress, then Energy.

export type ReviewCard =
  | { key: string; title: string; sub: string; image?: string; review: WorkerReview }
  | { key: string; title: string; sub: string; image?: string; command: ReviewCommand }
  | { key: string; title: string; sub: string; image?: string; target: ReviewTarget };

export type WorkState = 'wait' | 'work' | 'done';

export type WorkRow = {
  key: string;
  ticket?: string;
  title: string;
  percent: number | null;
  state: WorkState;
  last?: string;
  /** The app job that owns the ticket: its chat is the agent conversation. */
  jobId?: string;
  gameId: string;
};

export type EnergyCard = { key: string; name: string; usedPercent: number | null; resetsAt: string | null };

const RANK: Record<WorkState, number> = { wait: 0, work: 1, done: 2 };
/** A finished job stays in the list this long, so the creator sees it land. */
export const DONE_VISIBLE_MS = 5 * 60 * 1000;

function reviewTicket(review: WorkerReview): string {
  return review.kind === 'standalone-preview' ? review.preview.ticket : review.round.ticket;
}

function still(review: WorkerReview): string | undefined {
  if (review.kind === 'standalone-preview') return undefined;
  return review.round.media.find((media) => media.kind === 'still')?.url;
}

function commandImage(command: ReviewCommand): string | undefined {
  for (const option of command.options) {
    const media = option.media;
    if (!media) continue;
    if (media.poster) return media.poster;
    if (media.kind === undefined || media.kind === 'image') return media.url;
  }
  return undefined;
}

/** "#969 · 2 options" under a decision's title. */
export function decisionSub(command: { ticket: string | null; options: readonly unknown[] }): string {
  return [command.ticket ? `#${command.ticket}` : undefined, `${command.options.length} options`]
    .filter(Boolean)
    .join(' · ');
}

export function reviewCards(
  reviews: readonly WorkerReview[],
  commands: readonly ReviewCommand[],
  targets: readonly ReviewTarget[],
  workers: readonly WorkerBuild[],
): ReviewCard[] {
  const titleOf = (gameId: string, ticket: string) =>
    workers.find((worker) => worker.ticket === `${gameId}:${ticket}`)?.title;
  return [
    ...reviews.map((review): ReviewCard => {
      const ticket = reviewTicket(review);
      const title =
        titleOf(review.gameId, ticket) ??
        (review.kind === 'standalone-preview'
          ? (review.preview.title ?? `Build #${ticket}`)
          : review.round.question || `Build #${ticket}`);
      const sub =
        review.kind === 'standalone-preview' || review.round.category === 'gameplay' || review.round.sliceUrl
          ? `#${ticket} · play`
          : `#${ticket}`;
      const id = review.kind === 'standalone-preview' ? review.preview.buildId : review.round.id;
      return { key: `${review.gameId}:${review.kind}:${id}`, title, sub, image: still(review), review };
    }),
    ...commands.map((command): ReviewCard => ({
      key: `${commandSource(command)}:${command.decision_id}`,
      title: command.summary || command.title,
      sub: decisionSub(command),
      image: commandImage(command),
      command,
    })),
    ...targets.map((target): ReviewCard => ({
      key: `${'source' in target ? 'core' : target.gameId}:${target.ticket}`,
      title: target.title,
      sub: `#${target.ticket}`,
      target,
    })),
  ];
}

/**
 * The game's tickets with their progress: aiur's workers, then app jobs no worker shows yet. A ticket waits on the
 * creator while a decision of its is open or its job asks something; a job that finished in the last few minutes
 * shows as done.
 */
export function workRows(
  gameId: string,
  workers: readonly WorkerBuild[],
  jobs: readonly Job[],
  waiting: ReadonlySet<string>,
  now = Date.now(),
): WorkRow[] {
  const gameJobs = jobs.filter((job) => job.gameId === gameId);
  const jobFor = (ticket: string) => gameJobs.find((job) => String(job.aiurIssueNumber) === ticket);
  const rows: WorkRow[] = [];
  const shown = new Set<string>();
  for (const worker of workers) {
    const separator = worker.ticket.lastIndexOf(':');
    const owner = worker.ticket.slice(0, separator);
    if (separator < 0 || owner !== gameId) continue;
    const ticket = worker.ticket.slice(separator + 1);
    const job = jobFor(ticket);
    if (job) shown.add(job.id);
    // A ticket waiting for review is a Review card; its job must not come back as a row below either.
    if (worker.state === 'human-review') continue;
    rows.push({
      key: worker.ticket,
      ticket,
      title: worker.title,
      percent: worker.percent,
      state: waiting.has(ticket) || (job?.openRequestCount ?? 0) > 0 ? 'wait' : 'work',
      last: worker.last ?? (job && jobLast(job)),
      jobId: job?.id,
      gameId,
    });
  }
  for (const job of gameJobs) {
    if (shown.has(job.id)) continue;
    const finished = isTerminal(job.state);
    if (finished) {
      const at = Date.parse(job.terminalAt ?? job.updatedAt);
      if (job.state !== 'done' || !Number.isFinite(at) || now - at > DONE_VISIBLE_MS) continue;
    }
    const ticket = job.aiurIssueNumber === null ? undefined : String(job.aiurIssueNumber);
    rows.push({
      key: `job:${job.id}`,
      ticket,
      title: job.plan.title,
      percent: finished ? 100 : (job.progressPercent ?? null),
      state: finished
        ? 'done'
        : (ticket !== undefined && waiting.has(ticket)) || (job.openRequestCount ?? 0) > 0
          ? 'wait'
          : 'work',
      last: jobLast(job),
      jobId: job.id,
      gameId,
    });
  }
  return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || (b.percent ?? -1) - (a.percent ?? -1));
}

// The job's own words, else the words for its stage ("Waiting for a free slot").
function jobLast(job: Job): string | undefined {
  return job.stageText ?? (job.stage ? JOB_STAGE_WORDS[job.stage] : undefined);
}

/** Provider readings (Claude, Codex, …) when the API has them, else the day/week/month windows. */
export function energyCards(view: EnergyView | undefined): EnergyCard[] {
  if (!view) return [];
  /* Bundles written before #1217 carry no sources, and the client doesn't parse the response. */
  const sources = view.sources ?? [];
  if (sources.length > 0)
    return sources.map((source) => ({
      key: source.id,
      name: source.label,
      usedPercent: source.stale ? null : source.usedPercent,
      resetsAt: source.resetsAt,
    }));
  return (view.windows ?? []).map((window) => ({
    key: window.window,
    name: WINDOW_LABELS[window.window],
    usedPercent: window.usedPercent,
    resetsAt: window.resetsAt,
  }));
}

/** "Resets Thu 09:00" within a week, else "Resets 3 Dec". */
export function resetText(resetsAt: string | null, now = Date.now()): string | undefined {
  if (!resetsAt) return undefined;
  const at = new Date(resetsAt);
  if (!Number.isFinite(at.getTime())) return undefined;
  const soon = at.getTime() - now < 6 * 24 * 3_600_000;
  return soon
    ? `Resets ${at.toLocaleDateString(undefined, { weekday: 'short' })} ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : `Resets ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
