import { authorize } from '@ogm/policy';

import { GameCommand, type CreatorCommandsPage, type GameCommandsPage, type Principal } from '@ogm/contracts';

import { actorFromPrincipal } from '../accounts/families.js';
import type { AppDeps } from '../app/types.js';
import { getChatRow, listCommands, parseCommand, toMessage, type MediaSigner } from '../build-chat/store.js';
import { hasGameGrant, listGames, type GameRow } from '../games/games.js';
import { listJobs } from '../jobs/repo.js';
import { reviewNumbers } from '../reviews/numbers.js';
import { gameCommandsFromAiur } from './aiur.js';
import { withPhases } from './advance.js';
import { reviewMediaUrl } from '../blobs/review-url.js';
import { isCreatorCommand } from './audience.js';

type UserPrincipal = Extract<Principal, { kind: 'user' }>;

async function optionMedia(deps: AppDeps, jobId: string, mediaId: string, sign: MediaSigner) {
  const row = getChatRow(deps.sqlite, mediaId);
  if (row === null || row.jobId !== jobId) return undefined;
  return (await toMessage(row, sign)).media;
}

// Resolve all creator Commands, including incomplete reviews that need the media-repair action.
async function resolveGameCommands(deps: AppDeps, game: GameRow, onUnavailable?: () => void): Promise<GameCommand[]> {
  const sign: MediaSigner = (hash) => reviewMediaUrl(deps.blobStore, deps.config.appOrigin, hash);
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

  // A linked job Command keeps its local identity and presentation; matching Aiur media fills its option details.
  const listed = new Map(
    commands.map((command) => [command.decision_id, { version: command.version, ticket: command.ticket }]),
  );
  for (const command of await gameCommandsFromAiur(deps, game, jobTickets, sign, onUnavailable, listed)) {
    const index = commands.findIndex(
      (item) =>
        item.decision_id === command.decision_id && item.version === command.version && item.ticket === command.ticket,
    );
    if (index < 0) {
      if (!listed.has(command.decision_id)) commands.push(command);
    } else {
      const local = commands[index]!;
      commands[index] = {
        ...local,
        options: local.options.map((option) => {
          const remote = command.options.find((candidate) => candidate.id === option.id);
          const remoteSound =
            option.media && remote?.media?.kind === 'audio' && option.media.url !== remote.media.url
              ? remote.media
              : undefined;
          return {
            ...remote,
            ...option,
            ...(remoteSound && !option.audio && !remote?.audio ? { audio: remoteSound } : {}),
          };
        }),
      };
    }
  }

  return withPhases(
    deps,
    game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined,
    commands,
  );
}

// A creator Command is a review card only when every option has media or is playable. Product questions use the
// explicit text-only marker; a partially media-backed Command is omitted instead of falling back to plain text.
function reviewableCommands(commands: GameCommand[]): GameCommand[] {
  return commands.filter(
    (command) =>
      command.text_only === true ||
      command.options.every(
        (option) =>
          option.media !== undefined ||
          option.audio !== undefined ||
          (option.audioClips?.length ?? 0) > 0 ||
          option.playable !== undefined,
      ),
  );
}

function numberedReviewableCommands(deps: AppDeps, gameId: string, commands: GameCommand[]): GameCommand[] {
  const reviewable = reviewableCommands(commands);
  const oldestFirst = [...reviewable].sort((left, right) => left.opened_at.localeCompare(right.opened_at));
  const numbers = reviewNumbers(
    deps.db,
    gameId,
    oldestFirst.map((command) => command.decision_id),
  );
  return reviewable
    .sort((left, right) => right.opened_at.localeCompare(left.opened_at))
    .map((command) => ({ ...command, review_number: numbers.get(command.decision_id)! }));
}

function missingMediaReviewCommands(game: GameRow, commands: GameCommand[]) {
  return commands
    .filter((command) => command.ticket !== null && !reviewableCommands([command]).length)
    .map((command) => ({ game_id: game.id, decision_id: command.decision_id }));
}

// One game's reviewable Commands, newest first, with stable numbers assigned only to cards shown in the inbox.
export async function listGameCommands(
  deps: AppDeps,
  game: GameRow,
  onUnavailable?: () => void,
): Promise<GameCommand[]> {
  return numberedReviewableCommands(deps, game.id, await resolveGameCommands(deps, game, onUnavailable));
}

// Notifications also cover incomplete Commands so creators can open the inbox and repair missing review media.
export async function listGameCommandRefs(
  deps: AppDeps,
  game: GameRow,
): Promise<Pick<GameCommand, 'decision_id' | 'version' | 'ticket'>[]> {
  return (await resolveGameCommands(deps, game)).map(({ decision_id, version, ticket }) => ({
    decision_id,
    version,
    ticket,
  }));
}

export async function listGameCommandPage(
  deps: AppDeps,
  game: GameRow,
  principal: Principal,
  onUnavailable?: () => void,
): Promise<GameCommandsPage> {
  const resolved = await resolveGameCommands(deps, game, onUnavailable);
  const commands = shownOneByOne(deps, numberedReviewableCommands(deps, game.id, resolved));
  const missingMediaCommands =
    principal.kind === 'user' && game.ownerId === principal.userId ? missingMediaReviewCommands(game, resolved) : [];
  return { commands, missing_media_commands: missingMediaCommands };
}

// Find a Command regardless of card completeness, for repair and answer-ledger ownership checks.
export async function findGameCommand(
  deps: AppDeps,
  game: GameRow,
  decisionId: string,
): Promise<GameCommand | undefined> {
  return (await resolveGameCommands(deps, game)).find((command) => command.decision_id === decisionId);
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
export async function listCreatorCommands(
  deps: AppDeps,
  principal: UserPrincipal,
  includeQuestions = false,
): Promise<CreatorCommandsPage & { unavailable?: boolean }> {
  let unavailable = false;
  const actor = actorFromPrincipal(principal);
  const games = listGames(deps.db, principal.familyId, principal.userId).filter(
    (game) =>
      authorize(actor, 'game.edit', {
        familyId: game.familyId,
        ownerId: game.ownerId,
        visibility: game.visibility,
        releaseState: game.releaseState,
        granted: hasGameGrant(deps.db, game.id, principal.userId),
      }).ok,
  );
  // One game that fails to list is left out of this read, so it never hides the other games' decisions.
  const perGame = await Promise.all(
    games.map(async (game) => {
      try {
        const resolved = await resolveGameCommands(deps, game, () => {
          unavailable = true;
        });
        const commands = numberedReviewableCommands(deps, game.id, resolved).map((command) => ({
          ...command,
          game_id: game.id,
          game_title: game.title.slice(0, 200),
        }));
        const missingMediaCommands =
          includeQuestions && game.ownerId === principal.userId ? missingMediaReviewCommands(game, resolved) : [];
        return { commands, missingMediaCommands };
      } catch (error) {
        unavailable = true;
        deps.log({ event: 'creator_commands_game_failed', gameId: game.id, error: (error as Error).name });
        return { commands: [], missingMediaCommands: [] };
      }
    }),
  );
  const threshold = deps.config.voiceQuestionsAt ?? DEFAULT_VOICE_QUESTIONS_AT;
  const questionSessions = !voiceConfigured(deps)
    ? []
    : games.flatMap((game, index) => {
        const count = perGame[index]!.commands.filter((command) => command.text_only === true).length;
        return count >= threshold ? [{ game_id: game.id, game_title: game.title.slice(0, 200), count }] : [];
      });
  const allCommands = perGame.flatMap(({ commands: items }) => items);
  const commands = (includeQuestions ? allCommands : shownOneByOne(deps, allCommands)).sort(
    (left, right) => Number(right.blocking) - Number(left.blocking) || left.opened_at.localeCompare(right.opened_at),
  );
  const missingMediaCommands = perGame.flatMap(({ missingMediaCommands: items }) => items);
  return {
    commands,
    question_sessions: questionSessions,
    ...(includeQuestions ? { missing_media_commands: missingMediaCommands } : {}),
    ...(unavailable ? { unavailable: true } : {}),
  };
}
