import { AiurHttpError, type AiurClient, type Decision } from '@ogm/aiur-client';
import { GameCommand, type CommandOption } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import type { MediaSigner } from '../build-chat/store.js';
import { isForCreator } from '../checkpoints/correlate.js';
import { optionMediaFromAiur } from './aiur-media.js';

// A game registered from a repository that already exists has its aiur tickets and no jobs, so its open Commands are
// not in any job's checkpoints: they are read from the instance's own Decision API, whose scoped grant already limits
// them to this game. A Command read here has no job, so its decision id is the checkpoint id the game's answer route
// takes, and the embeddable `<aiur-commands>` component renders it exactly as it renders a job's.
//
// A decision aiur has answered, dismissed or called moot is not an open Command and is left out, as the job
// checkpoints leave it out. An open or deferred decision is still waiting on the creator. A Command whose options
// fall outside the inbox contract (fewer than two, more than five, or an option id aiur would not accept) is dropped
// rather than failing the whole inbox. A decision not marked for the creator (an engineering or operations question) is
// the Executor's and is never listed here (#595).
const OPEN = new Set(['open', 'deferred']);

function isOpen(decision: Decision): boolean {
  if (decision.answer !== null && decision.answer !== undefined) return false;
  return OPEN.has(decision.decision_status);
}

function titleOf(decision: Decision): string {
  const summary = decision.context?.short_summary?.trim() ?? '';
  const title = summary === '' ? decision.question : summary;
  return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}

function recommendOf(decision: Decision): string | undefined {
  const id = decision.recommendation?.option_id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

// `media` is each option's resolved media by option id (see `aiur-media.ts`); without it the options are text only.
export function toGameCommand(
  decision: Decision,
  media: ReadonlyMap<string, NonNullable<CommandOption['media']>> = new Map(),
): GameCommand | null {
  const recommend = recommendOf(decision);
  const command = GameCommand.safeParse({
    job_id: null,
    ticket: decision.ticket.identifier,
    title: titleOf(decision),
    // Aiur's decision is the checkpoint: one Command, one decision id, one version to answer against.
    checkpoint_id: decision.decision_id,
    decision_id: decision.decision_id,
    version: decision.version,
    question: decision.question,
    options: decision.options.map(({ id, label }) => {
      const optionMedia = media.get(id);
      return optionMedia === undefined ? { id, label } : { id, label, media: optionMedia };
    }),
    ...(recommend === undefined ? {} : { recommend }),
    blocking: decision.blocking,
    opened_at: decision.created_at,
  });
  return command.success ? command.data : null;
}

// The game's own open Commands. A game whose daemon row is missing or whose instance cannot be reached has none:
// the inbox still lists its jobs' Commands, and the failure is logged rather than failing the whole page.
export async function gameCommandsFromAiur(
  deps: AppDeps,
  gameId: string,
  jobTickets: ReadonlySet<string>,
  sign: MediaSigner,
): Promise<GameCommand[]> {
  let client: AiurClient;
  let decisions: Decision[];
  try {
    client = await deps.aiurClientForGame(gameId);
    decisions = await client.decisions();
  } catch (error) {
    if (error instanceof HttpError) return [];
    if (error instanceof AiurHttpError) {
      deps.log({ event: 'game_commands_unavailable', gameId, status: error.status });
      return [];
    }
    deps.log({ event: 'game_commands_unavailable', gameId, error: (error as Error).name });
    return [];
  }
  // A job's Command is already in its checkpoint, so the game's own read leaves those to the job. A Command the inbox
  // would drop anyway is dropped before its media is copied.
  const open = decisions.filter(
    (decision) =>
      !jobTickets.has(decision.ticket.identifier) &&
      isOpen(decision) &&
      isForCreator(decision) &&
      toGameCommand(decision) !== null,
  );
  const commands = await Promise.all(
    open.map(async (decision) => toGameCommand(decision, await optionMediaFromAiur(deps, client, decision, sign))),
  );
  return commands.filter((command) => command !== null);
}
