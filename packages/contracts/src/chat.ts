import { z } from 'zod';

import { Id, IsoTime } from './api.js';
import { CommandReview } from './review.js';

// Build chat (D-BUILD-CHAT), transcribed from T06 §4. Agent rows carry the writer's ULID; rows the API mints carry `m_<uuid>`.
export const Ulid = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
export const ChatMessageId = z.union([Id, Ulid]);
export const ChatActor = z.enum(['creator', 'agent', 'system']);
export const ChatKind = z.enum(['text', 'image', 'clip', 'command', 'progress']);

export const ChatMedia = z.object({
  url: z.string().url(),
  poster: z.string().url().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative().optional(),
});

// What a presented option was built from: the packs and assets it used, its generator, and when it was built. The
// game's feedback ledger (#567) reads it to fail an option that repeats a rejection. `aspect` is the design area the
// option answers; a ledger rule whose scope matches it (or whose scope is "options") applies to the option.
export const OptionAspect = z.enum(['characters', 'look', 'options', 'scene', 'hud', 'other']);
export const OptionProvenance = z
  .object({
    packs: z.array(z.string().trim().min(1).max(200)).default([]),
    assets: z.array(z.string().trim().min(1).max(200)).default([]),
    generator: z.string().trim().min(1).max(200),
    built_at: IsoTime,
    aspect: OptionAspect.optional(),
    kind: z.enum(['stand-in', 'render', 'screenshot', 'clip', 'mockup']).optional(),
    view: z.enum(['player', 'off-camera', 'other']).optional(),
  })
  .strict();

// A playable option (#608): instead of a picture of the gameplay, the card runs a short slice of the game itself. The
// deck plays the game's build on `branch` from the games host with `scenario` appended to the game's URL (for example
// `scenario=sandbox&speed=slow`), for `seconds`, then pauses for a verdict. `lead_in` names a short scripted move the
// game plays first so the situation is ready (it reaches the game as `lead_in=<name>`). The scenario is a bare query of
// plain keys and values: no URL, no host, and none of the parameters the host itself sets.
export const PLAYABLE_RESERVED_PARAMS = ['build', 'protocol', 'tier', 'lead_in'] as const;
export const DEFAULT_PLAYABLE_SECONDS = 8;
const SCENARIO_PAIR = /^[A-Za-z0-9_.-]{1,32}=[A-Za-z0-9_.~-]{0,64}$/;
export const PlayableScenario = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .refine((scenario) => scenario.split('&').every((pair) => SCENARIO_PAIR.test(pair)), {
    message: 'scenario must be key=value pairs joined by &, with plain keys and values',
  })
  .refine(
    (scenario) =>
      scenario
        .split('&')
        .every((pair) => !(PLAYABLE_RESERVED_PARAMS as readonly string[]).includes(pair.slice(0, pair.indexOf('=')))),
    { message: `scenario must not set ${PLAYABLE_RESERVED_PARAMS.join(', ')}` },
  );
export const OptionPlayable = z
  .object({
    scenario: PlayableScenario,
    seconds: z.number().int().min(2).max(30).default(DEFAULT_PLAYABLE_SECONDS),
    lead_in: z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .optional(),
    branch: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();

// aiur keeps only text on a Command's options and refuses a `playable` media kind, so a Command raised without a build
// job (from the host or an aiur workspace, #639) carries its options' slices in its context as a hidden marker:
// `<!-- gm-playable:{"<option id>":<OptionPlayable>,...} -->`. A scenario cannot hold `>`, so the JSON never ends the
// comment early.
const PLAYABLE_MARKER = /<!-- gm-playable:(.+?) -->/;
const PlayableMarker = z.record(z.string(), OptionPlayable);

export function playableMarker(playables: ReadonlyMap<string, OptionPlayable>): string {
  return `<!-- gm-playable:${JSON.stringify(Object.fromEntries(playables))} -->`;
}

// The slices a marker names, by option id; a missing or malformed marker names none.
export function playablesFromMarker(text: string | null | undefined): Map<string, OptionPlayable> {
  const match = typeof text === 'string' ? PLAYABLE_MARKER.exec(text) : null;
  if (match === null) return new Map();
  try {
    const parsed = PlayableMarker.safeParse(JSON.parse(match[1] as string) as unknown);
    return parsed.success ? new Map(Object.entries(parsed.data)) : new Map();
  } catch {
    return new Map();
  }
}

export const ChatCommandOption = z.object({
  id: z.string(),
  label: z.string(),
  media_id: z.string().optional(),
  provenance: OptionProvenance.optional(),
  playable: OptionPlayable.optional(),
});

// `decision_id` is "" until OGM-082 correlates it; `media_id` names a BuildChatMessage.id in the same job.
// `pick` says how the answer is taken: 'one' asks for a single pick (a review's likes become the shortlist), 'many'
// takes the likes and dislikes as the answer. Absent means 'one', which is what every older Command is.
export const ChatCommand = z.object({
  decision_id: z.string(),
  question: z.string(),
  options: z
    .array(ChatCommandOption)
    // A review deck (A3) needs room for six voices or a 3x3 image mock. No floor: a stored Command from an older
    // daemon may carry a single option, and dropping it would lose the Command.
    .max(12),
  recommend: z.string().optional(),
  blocking: z.boolean().optional(),
  pick: z.enum(['one', 'many']).optional(),
  // The Command's 2-5 word topic (`gm decide --topic`), its title in the inbox and modal. Older Commands have none.
  topic: z.string().optional(),
  status: z.enum(['open', 'answered', 'moot']),
  option_id: z.string().optional(),
  // A review deck's answer: the likes and dislikes the creator chose, with their words on a dislike (A3).
  review: CommandReview.optional(),
});

// Files a creator attaches to a chat message (#222). Images keep #214's 10 MiB cap and are re-encoded to WebP on upload;
// text files are UTF-8 and capped at 64 KB. Upload each with POST /api/v1/jobs/:jobId/chat/attachments, then name the
// returned ids in the message's `attachments`.
export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_TEXT_ATTACHMENT_BYTES = 64 * 1024;
export const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const TEXT_ATTACHMENT_TYPES = ['text/plain', 'text/markdown', 'application/json'] as const;
export const ChatAttachmentKind = z.enum(['image', 'text']);
export const ChatAttachment = z
  .object({
    id: Id,
    kind: ChatAttachmentKind,
    name: z.string().min(1).max(200),
    mime: z.enum(['image/webp', ...TEXT_ATTACHMENT_TYPES]),
    bytes: z.number().int().positive().max(MAX_IMAGE_ATTACHMENT_BYTES),
  })
  .strict();

export const BuildChatMessage = z.object({
  id: ChatMessageId,
  job_id: Id,
  at: IsoTime,
  actor: ChatActor,
  kind: ChatKind,
  text: z.string().optional(),
  media: ChatMedia.optional(),
  command: ChatCommand.optional(),
  attachments: z.array(ChatAttachment).max(MAX_CHAT_ATTACHMENTS).optional(),
  aiur: z
    .object({ ticket: z.string(), event_id: z.number().int().optional(), topic: z.string().optional() })
    .optional(),
});

// One line of `<workspace>/.gm/outbox/*.jsonl`, written inside the no-network sandbox and shipped by the API's relay.
// Known types: chat.post (this context), command.request (OGM-082), scope.agreed (OGM-088), narration.render (OGM-087).
export const AgentOutboxLine = z.object({
  v: z.literal(1),
  id: Ulid,
  job_id: Id,
  at: IsoTime,
  type: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  payload: z.record(z.string(), z.unknown()),
});

export const CommandRequestPayload = z
  .object({
    command_id: z.string().regex(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    question: z.string().trim().min(1).max(8000),
    options: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
          label: z.string().trim().min(1).max(200),
          media_id: ChatMessageId.optional(),
          provenance: OptionProvenance.optional(),
          playable: OptionPlayable.optional(),
        }),
      )
      .min(2)
      .max(12),
    recommend: z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .optional(),
    blocking: z.boolean(),
    // 'many' opens a review deck whose answer is the likes and dislikes, not one card. Absent means 'one'.
    pick: z.enum(['one', 'many']).optional(),
    // The 2-5 word topic `gm decide` requires; the inbox titles the Command with it.
    topic: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const ids = payload.options.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'option ids must be unique' });
    if (payload.recommend !== undefined && !ids.includes(payload.recommend)) {
      ctx.addIssue({ code: 'custom', path: ['recommend'], message: 'recommend must name an option' });
    }
  });

// `file` and `poster` are workspace-relative paths inside `.gm/outbox/media/`.
export const ChatPostPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(8000) }),
  z.object({
    kind: z.enum(['image', 'clip']),
    text: z.string().max(8000).optional(),
    file: z.string().min(1).max(512),
    poster: z.string().min(1).max(512).optional(),
  }),
]);

// POST /api/v1/jobs/:jobId/chat. aiur caps an operator message at 8,000 characters.
// `text` may be left out only when the message carries attachments.
export const ChatPostBody = z
  .object({
    text: z.string().regex(/\S/).trim().min(1).max(8000).optional(),
    attachments: z.array(Id).min(1).max(MAX_CHAT_ATTACHMENTS).optional(),
  })
  .strict()
  .refine((body) => body.text !== undefined || body.attachments !== undefined, {
    message: 'text or attachments is required',
    path: ['text'],
  })
  .refine((body) => new Set(body.attachments ?? []).size === (body.attachments?.length ?? 0), {
    message: 'attachment ids must be unique',
    path: ['attachments'],
  });

// GET /api/v1/jobs/:jobId/chat/messages?since=<seq> → rows with seq > since, oldest first; pass `last_seq` back as `since`.
// SSE: GET /api/v1/jobs/:jobId/chat?since=<seq> → "id: <seq>\nevent: message\ndata: <BuildChatMessage JSON>"; Last-Event-ID resumes.
export const ChatSinceQuery = z.object({ since: z.coerce.number().int().nonnegative().default(0) });
export const ChatMessagesPage = z.object({
  messages: z.array(BuildChatMessage),
  last_seq: z.number().int().nonnegative(),
});

export type BuildChatMessage = z.infer<typeof BuildChatMessage>;
export type ChatMedia = z.infer<typeof ChatMedia>;
export type ChatCommand = z.infer<typeof ChatCommand>;
export type ChatCommandOption = z.infer<typeof ChatCommandOption>;
export type OptionAspect = z.infer<typeof OptionAspect>;
export type OptionProvenance = z.infer<typeof OptionProvenance>;
export type OptionPlayable = z.infer<typeof OptionPlayable>;
export type ChatAttachment = z.infer<typeof ChatAttachment>;
export type AgentOutboxLine = z.infer<typeof AgentOutboxLine>;
export type CommandRequestPayload = z.infer<typeof CommandRequestPayload>;
export type ChatPostPayload = z.infer<typeof ChatPostPayload>;
export type ChatPostBody = z.infer<typeof ChatPostBody>;
export type ChatMessagesPage = z.infer<typeof ChatMessagesPage>;

export const chatSchemas = {
  'chat.message.v1': BuildChatMessage,
  'chat.outbox-line.v1': AgentOutboxLine,
  'chat.command-request-payload.v1': CommandRequestPayload,
  'chat.option-provenance.v1': OptionProvenance,
  'chat.option-playable.v1': OptionPlayable,
  'chat.post-payload.v1': ChatPostPayload,
  'chat.post.v1': ChatPostBody,
  'chat.messages.v1': ChatMessagesPage,
  'chat.attachment.v1': ChatAttachment,
} satisfies Record<string, z.ZodType>;
