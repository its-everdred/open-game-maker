import { AiurHttpError, type AiurClient, type Decision } from '@ogm/aiur-client';
import { GameCommand, playablesFromMarker } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import type { MediaSigner } from '../build-chat/store.js';
import { isForCreator, isTextOnly } from '../job-commands/correlate.js';
import { optionMediaFromAiur, type ResolvedOptionMedia } from './aiur-media.js';
import { gameTicketFilter, hasOpenGameTickets } from './scope.js';
import type { GameRow } from '../games/games.js';
import { isQaGame } from '../qa/state.js';
import { daemonRowForGame } from '../jobs/daemons.js';
import { join } from 'node:path';

// A game registered from a repository that already exists has its aiur tickets and no jobs, so its open Commands are
// not in any job's Commands: they are read from the instance's own Decision API, whose scoped grant already limits
// them to this game. A Command read here has no job, so its decision id is the Command id the game's answer route
// takes, and the embeddable `<aiur-commands>` component renders it exactly as it renders a job's.
//
// A decision aiur has answered, dismissed or called moot is not an open Command and is left out, as the job
// Commands leave it out. An open or deferred decision is still waiting on the creator. A Command whose options
// fall outside the inbox contract (fewer than two, more than five, or an option id aiur would not accept) is dropped
// rather than failing the whole inbox. A decision not marked for the creator (an engineering or operations question) is
// the Executor's and is never listed here (#595).
const OPEN = new Set(['open', 'deferred']);

function isOpen(decision: Decision): boolean {
  if (decision.answer !== null && decision.answer !== undefined) return false;
  return OPEN.has(decision.decision_status);
}

function clip(text: string): string {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

// The decision's short topic (aiur's `short_summary`), the line the menu's decision list shows.
export function summaryOf(decision: Decision): string | undefined {
  const summary = decision.context?.short_summary?.trim() ?? '';
  return summary === '' ? undefined : clip(summary);
}

function recommendOf(decision: Decision): string | undefined {
  const id = decision.recommendation?.option_id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

// `media` is each option's resolved media by option id (see `aiur-media.ts`); without it the options are text only. An
// option the context's playable marker names (`gm command request --playable`, #639) is a slice of the game to play.
export function toGameCommand(
  decision: Decision,
  media: ReadonlyMap<string, ResolvedOptionMedia> = new Map(),
): GameCommand | null {
  const recommend = recommendOf(decision);
  const summary = summaryOf(decision);
  const playables = playablesFromMarker(decision.context?.long_context_markdown);
  const command = GameCommand.safeParse({
    job_id: null,
    ticket: decision.ticket.identifier,
    title: summary ?? clip(decision.question),
    ...(summary === undefined ? {} : { summary }),
    // Aiur's decision is the Command itself: one Command, one decision id, one version to answer against.
    command_id: decision.decision_id,
    decision_id: decision.decision_id,
    version: decision.version,
    question: decision.question,
    options: decision.options.map(({ id, label }) => {
      const playable = playables.get(id);
      return { id, label, ...media.get(id), ...(playable === undefined ? {} : { playable }) };
    }),
    ...(recommend === undefined ? {} : { recommend }),
    blocking: decision.blocking,
    opened_at: decision.created_at,
    ...(isTextOnly(decision) ? { text_only: true } : {}),
  });
  return command.success ? command.data : null;
}

// The menu reads every game's instance at once, so one that hangs must not stall the others: past this wait the game
// is treated as unreachable for this read.
export const AIUR_LIST_TIMEOUT_MS = 5_000;

class AiurListTimeout extends Error {
  override name = 'AiurListTimeout';
}

// The timer also aborts the request, so a wedged instance does not keep one open socket per menu poll.
async function withinListTimeout<T>(start: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiurListTimeout());
    }, AIUR_LIST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([start(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The game's own open Commands. A game whose daemon row is missing or whose instance cannot be reached has none:
// the inbox still lists its jobs' Commands, and the failure is logged rather than failing the whole page.
export async function gameCommandsFromAiur(
  deps: AppDeps,
  game: GameRow,
  jobTickets: ReadonlySet<string>,
  sign: MediaSigner,
  onUnavailable?: () => void,
  linkedDecisions: ReadonlyMap<string, { version: number; ticket: string | null }> = new Map(),
): Promise<GameCommand[]> {
  // An unlinked game has no daemon. The QA game deliberately uses its synthetic daemon without a repository.
  if (!game.githubOwner && !game.githubRepo && !isQaGame(deps.db, game.id)) return [];
  let client: AiurClient;
  let decisions: Decision[];
  try {
    const reader = await deps.aiurClientForGame(game.id);
    client = reader;
    decisions = await withinListTimeout((signal) => reader.decisions({}, signal));
  } catch (error) {
    if (error instanceof HttpError && error.code === 'daemon_not_found') {
      const hasTickets = await hasOpenGameTickets(deps, game).catch(() => true);
      if (!hasTickets) return [];
    }
    onUnavailable?.();
    if (error instanceof HttpError) return [];
    if (error instanceof AiurHttpError) {
      deps.log({ event: 'game_commands_unavailable', gameId: game.id, status: error.status });
      return [];
    }
    deps.log({ event: 'game_commands_unavailable', gameId: game.id, error: (error as Error).name });
    return [];
  }
  // A job's Command stays in build chat; an exact ticket, id and version match may supply its Aiur media.
  // Other engineering or operations decisions stay with the Executor. Drop unusable Commands before copying media.
  const linked = (decision: Decision) =>
    linkedDecisions.get(decision.decision_id)?.version === decision.version &&
    linkedDecisions.get(decision.decision_id)?.ticket === decision.ticket.identifier;
  const candidates = decisions.filter(
    (decision) =>
      (!jobTickets.has(decision.ticket.identifier) || linked(decision)) &&
      isOpen(decision) &&
      (isForCreator(decision) || linked(decision)) &&
      toGameCommand(decision) !== null,
  );
  if (!candidates.length) return [];
  let allowed: (ticket: string) => boolean;
  try {
    allowed = await gameTicketFilter(deps, game);
  } catch {
    onUnavailable?.();
    return [];
  }
  const open = candidates.filter(
    (decision) =>
      (!jobTickets.has(decision.ticket.identifier) || linked(decision)) &&
      allowed(decision.ticket.identifier) &&
      isOpen(decision) &&
      (isForCreator(decision) || linked(decision)) &&
      toGameCommand(decision) !== null,
  );
  const daemon = daemonRowForGame(deps.db, game.id);
  const workspaceRoot =
    daemon &&
    game.githubOwner &&
    game.githubRepo &&
    daemon.repo.toLowerCase() === `${game.githubOwner}/${game.githubRepo}`.toLowerCase()
      ? join(daemon.checkoutPath, 'workspaces')
      : undefined;
  const commands = await Promise.all(
    open.map(async (decision) =>
      toGameCommand(
        decision,
        await optionMediaFromAiur(
          deps,
          client,
          decision,
          sign,
          game.githubOwner && game.githubRepo
            ? {
                owner: game.githubOwner,
                name: game.githubRepo,
                ticket: decision.ticket.identifier,
                ...(workspaceRoot ? { workspaceRoot } : {}),
              }
            : undefined,
        ),
      ),
    ),
  );
  return commands.filter((command) => command !== null);
}
