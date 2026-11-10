import { authorize } from '@ogm/policy';

import { GameCommand, type CreatorCommandsPage, type Principal } from '@ogm/contracts';

import { actorFromPrincipal } from '../accounts/families.js';
import type { AppDeps } from '../app/types.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { getChatRow, listCommands, parseCommand, toMessage, type MediaSigner } from '../build-chat/store.js';
import { hasGameGrant, listGames, type GameRow } from '../games/games.js';
import { listJobs } from '../jobs/repo.js';
import { reviewNumbers } from '../reviews/numbers.js';
import { gameCommandsFromAiur } from './aiur.js';
import { isCreatorCommand } from './audience.js';

type UserPrincipal = Extract<Principal, { kind: 'user' }>;

async function optionMedia(deps: AppDeps, jobId: string, mediaId: string, sign: MediaSigner) {
  const row = getChatRow(deps.sqlite, mediaId);
  if (row === null || row.jobId !== jobId) return undefined;
  return (await toMessage(row, sign)).media;
}

// One game's open player-facing Commands, newest first: its jobs' correlated Commands, plus the Commands its own aiur
// instance holds when no job owns them. Each keeps the short review number it got the first time it was listed.
export async function listGameCommands(deps: AppDeps, game: GameRow): Promise<GameCommand[]> {
  const { sign } = getChatRuntime(deps);
  const commands: GameCommand[] = [];
  const jobs = listJobs(deps.db, game.id);
  const jobTickets = new Set(
    jobs.flatMap((job) => (job.aiurIssueNumber === null ? [] : [String(job.aiurIssueNumber)])),
  );

  for (const job of jobs) {
    for (const row of listCommands(deps.sqlite, job.id)) {
      const stored = parseCommand(row);
      // A Command is answerable only once aiur's decision is correlated (decision id and version known).
      if (!stored || stored.status !== 'open') continue;
      if (stored.decision_id === '' || stored.version === undefined) continue;
      if (!isCreatorCommand(stored)) continue;
      const options = await Promise.all(
        stored.options.map(async (option) => {
          const media =
            option.media_id === undefined ? undefined : await optionMedia(deps, job.id, option.media_id, sign);
          return {
            id: option.id,
            label: option.label,
            ...(media === undefined ? {} : { media }),
            ...(option.aiGenerated === true ? { aiGenerated: true } : {}),
            ...(option.playable === undefined ? {} : { playable: option.playable }),
          };
        }),
      );
      // One malformed Command row is left out of the inbox rather than failing every Command in the game.
      const command = GameCommand.safeParse({
        job_id: job.id,
        ticket: job.aiurIssueNumber === null ? null : String(job.aiurIssueNumber),
        // A Command's own topic titles it; an older Command without one falls back to the job's title.
        title: stored.topic ?? job.plan.title,
        ...(stored.summary === undefined ? {} : { summary: stored.summary }),
        command_id: stored.command_id ?? row.id,
        decision_id: stored.decision_id,
        version: stored.version,
        question: stored.question,
        options,
        ...(stored.recommend === undefined ? {} : { recommend: stored.recommend }),
        blocking: stored.blocking ?? false,
        // How the Command's answer is taken: a review deck's 'one' asks for a single pick from its likes.
        pick: stored.pick ?? 'one',
        opened_at: row.at,
        ...(stored.text_only ? { text_only: true } : {}),
      });
      if (command.success) commands.push(command.data);
    }
  }

  // A registered game's Commands belong to no job. A decision already listed from a job's Command stays the
  // job's, so one Command never appears twice.
  const listed = new Set(commands.map((command) => command.decision_id));
  for (const command of await gameCommandsFromAiur(deps, game.id, jobTickets, sign)) {
    if (!listed.has(command.decision_id)) commands.push(command);
  }

  // Each Command keeps the short number it got the first time it was listed; new ones are numbered oldest first.
  const oldestFirst = [...commands].sort((left, right) => left.opened_at.localeCompare(right.opened_at));
  const numbers = reviewNumbers(
    deps.db,
    game.id,
    oldestFirst.map((command) => command.decision_id),
  );
  return commands
    .sort((left, right) => right.opened_at.localeCompare(left.opened_at))
    .map((command) => ({ ...command, review_number: numbers.get(command.decision_id)! }));
}

// How many queued product questions open a voice session when `OGM_VOICE_QUESTIONS_AT` is not set.
export const DEFAULT_VOICE_QUESTIONS_AT = 5;

// Product questions are asked in a voice session only when voice is configured; without it they are listed one by one
// like any decision, so they always have a way to be answered.
function voiceConfigured(deps: AppDeps): boolean {
  return Boolean(deps.config.voiceTokenSecret && deps.config.voiceWsUrl);
}

// The decisions shown one by one: a product question (#612) waits in its game's queue for a voice session instead.
export function shownOneByOne<T extends GameCommand>(deps: AppDeps, commands: T[]): T[] {
  if (!voiceConfigured(deps)) return commands;
  return commands.filter((command) => command.text_only !== true);
}

// A game's queued product questions, oldest first: the order a voice session asks them in.
export async function listProductQuestions(deps: AppDeps, game: GameRow): Promise<GameCommand[]> {
  return (await listGameCommands(deps, game))
    .filter((command) => command.text_only === true)
    .sort((left, right) => left.opened_at.localeCompare(right.opened_at));
}

// The menu's decision inbox: every game the caller may edit, in priority order. A Command that blocks its build comes
// first, then the one that has waited longest. Product questions are not listed one by one: a game with at least the
// threshold of them queued gets one voice-session entry instead (never pushed or opened on its own, #596).
export async function listCreatorCommands(deps: AppDeps, principal: UserPrincipal): Promise<CreatorCommandsPage> {
  const actor = actorFromPrincipal(principal);
  const games = listGames(deps.db, principal.familyId, principal.userId).filter(
    (game) =>
      authorize(actor, 'game.edit', {
        familyId: game.familyId,
        ownerId: game.ownerId,
        visibility: game.visibility,
        granted: hasGameGrant(deps.db, game.id, principal.userId),
      }).ok,
  );
  // One game that fails to list is left out of this read, so it never hides the other games' decisions.
  const perGame = await Promise.all(
    games.map(async (game) => {
      try {
        return (await listGameCommands(deps, game)).map((command) => ({
          ...command,
          game_id: game.id,
          game_title: game.title.slice(0, 200),
        }));
      } catch (error) {
        deps.log({ event: 'creator_commands_game_failed', gameId: game.id, error: (error as Error).name });
        return [];
      }
    }),
  );
  const threshold = deps.config.voiceQuestionsAt ?? DEFAULT_VOICE_QUESTIONS_AT;
  const questionSessions = !voiceConfigured(deps)
    ? []
    : games.flatMap((game, index) => {
        const count = perGame[index]!.filter((command) => command.text_only === true).length;
        return count >= threshold ? [{ game_id: game.id, game_title: game.title.slice(0, 200), count }] : [];
      });
  const commands = shownOneByOne(deps, perGame.flat()).sort(
    (left, right) => Number(right.blocking) - Number(left.blocking) || left.opened_at.localeCompare(right.opened_at),
  );
  return { commands, question_sessions: questionSessions };
}
