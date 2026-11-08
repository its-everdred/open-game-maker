import { z } from 'zod';

import { Id, IsoTime } from './api.js';
import { ChatMedia, OptionPlayable } from './chat.js';

// The per-game Commands inbox (M3, A2a): one game's open aiur Commands in the shape the embeddable
// `<aiur-commands>` component consumes (aiur#7487). A Command is one open aiur decision; a job's Command is answered
// through the job's checkpoint route and a Command with no job — a registered game's, read from its own aiur instance —
// through the game's answer route. Both call aiur's canonical answer path.
export const CommandOption = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  label: z.string().trim().min(1).max(200),
  // Present when the option carries media (A1 rich Commands). OGM signs the same blob URLs the chat uses. `kind` is set
  // when the media names its type (an aiur Command's media does): a clip with no poster is still a clip.
  media: ChatMedia.extend({ kind: z.enum(['image', 'video', 'audio']).optional() }).optional(),
  // A sound that goes with a picture: a character card shows its portrait in `media` and plays its voice from here.
  audio: ChatMedia.optional(),
  // Present when the option is a slice of the game to play (#608); the deck runs it in the card instead of a still.
  playable: OptionPlayable.optional(),
});

// A review deck shows one card per option (A3), so a Command's option count is bounded by the deck, not by aiur's
// 2-5 native-question rule.
export const MAX_COMMAND_OPTIONS = 12;

// Marks a Command as a player-facing question (#595). Game Maker writes it into the decision's long context; the
// creator's inbox, menu count and review deck show only Commands that carry it (or a gm checkpoint marker). Everything
// else (engineering and operations questions) stays with the Executor. Until aiur exposes an audience field, this
// marker is how a Command says who it is for.
export const CREATOR_AUDIENCE_MARKER = '<!-- gm-audience:creator -->';

export const GameCommand = z.object({
  // Null when the Command belongs to no job: a game registered from a repository that already exists reads its
  // instance's open Commands, and its `checkpoint_id` is aiur's decision id.
  job_id: Id.nullable(),
  // The aiur ticket the Command belongs to; null until the job is linked to a ticket.
  ticket: z.string().nullable(),
  title: z.string().trim().min(1).max(200),
  // The decision's short topic (aiur's `short_summary`) when it has one: the line the menu's decision list shows.
  summary: z.string().trim().min(1).max(200).optional(),
  checkpoint_id: z.string(),
  decision_id: z.string().min(1),
  version: z.number().int().positive(),
  question: z.string().trim().min(1).max(8000),
  // 2-12: a review deck (A3) shows one card per option, so six voices or a 3x3 image mock must fit. aiur's own
  // decision contract has no upper bound; 2-5 is only the native-question bridge's rule.
  options: z.array(CommandOption).min(2).max(MAX_COMMAND_OPTIONS),
  recommend: z.string().optional(),
  blocking: z.boolean(),
  // How the Command's answer is taken. 'one' asks for a single pick, so a review's likes become the shortlist;
  // 'many' takes the likes and dislikes as the answer. Absent means 'one', which is what every older Command is.
  pick: z.enum(['one', 'many']).optional(),
  opened_at: IsoTime,
  // The Command's short number inside its game (#591), for the `/<slug>/review/<n>` link. Given the first time the
  // Command is listed and never reused.
  review_number: z.number().int().positive().optional(),
});

// GET /api/v1/games/:gameId/commands → the open Commands of every job the caller can edit in that game, plus the
// Commands its own aiur instance holds for it when no job owns them.
export const GameCommandsPage = z.object({ commands: z.array(GameCommand) });

// GET /api/v1/me/commands → the open player-facing Commands of every game the caller can edit, for the menu's decision
// inbox: blocking first, then the longest waiting. Each names its game so the deck answers through that game's route.
export const CreatorCommand = GameCommand.extend({
  game_id: Id,
  game_title: z.string().trim().min(1).max(200),
});
export const CreatorCommandsPage = z.object({ commands: z.array(CreatorCommand) });

export type CommandOption = z.infer<typeof CommandOption>;
export type GameCommand = z.infer<typeof GameCommand>;
export type GameCommandsPage = z.infer<typeof GameCommandsPage>;
export type CreatorCommand = z.infer<typeof CreatorCommand>;
export type CreatorCommandsPage = z.infer<typeof CreatorCommandsPage>;

export const commandsSchemas = {
  'commands.game-inbox.v1': GameCommandsPage,
  'commands.creator-inbox.v1': CreatorCommandsPage,
} satisfies Record<string, z.ZodType>;
