import { z } from 'zod';

import { Id, IsoTime } from './api.js';

// The conversation a browser opens: sent as {"v":1,"type":"start","target":VoiceTarget} on the voice socket.
export const VoiceTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scope'),
    game_id: z.string().min(1),
    session_id: z.string().min(1),
    creator_id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('build'),
    game_id: z.string().min(1),
    job_id: z.string().min(1),
    ticket: z.string().min(1),
    creator_id: z.string().min(1),
    // The aiur decision the creator started voice from (#597): the briefing puts it first and describes its cards.
    command_id: z.string().min(1).max(200).optional(),
  }),
]);
// POST /api/v1/voice/token { target } → a 300 s `vct1.<payload>.<mac>` token the voice host verifies.
export const VoiceTokenRequest = z.object({ target: VoiceTarget }).strict();
export const VoiceTokenResponse = z.object({
  token: z.string().regex(/^vct1\./),
  expires_at: IsoTime,
  url: z.string().url(),
});
// API → voice host: POST /internal/briefing, keyed "scope:<session_id>" or "build:<job_id>".
export const BriefingPush = z.object({
  target_key: z.string().regex(/^(scope|build):.+$/),
  observed_at: IsoTime,
  summary: z.string().optional(),
  current_task: z.string().optional(),
  next_steps: z.array(z.string()).optional(),
  waiting_on: z.string().optional(),
  questions: z.array(z.string()).optional(),
  extra: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
  sections: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  commands: z
    .array(
      z.object({
        id: z.string(),
        version: z.union([z.string(), z.number()]).optional(),
        question: z.string(),
        options: z.array(z.union([z.string(), z.object({ id: z.string(), label: z.string() }).strict()])).optional(),
      }),
    )
    .optional(),
});
// Voice host → API: POST /internal/voice/instruct once the creator confirms a draft.
export const InstructRequest = z.object({
  target: VoiceTarget,
  text: z.string().min(1).max(4000),
  idempotency_key: z.string().min(1),
  kind: z.enum(['instruct', 'ask']),
});
export const InstructResponse = z.object({
  delivery_id: z.string().min(1),
  status: z.enum(['delivered', 'queued_at_reset', 'needs_choice', 'failed']),
});

// Voice host → API: one final normalized turn from a two-way conversation.
// `turn_id` is provider-owned for agent turns and host-owned for final user turns.
export const VoiceTranscriptRequest = z
  .object({
    target: VoiceTarget,
    conversation_id: z.string().min(1).max(128),
    turn_id: z.string().min(1).max(128),
    actor: z.enum(['creator', 'agent']),
    text: z.string().trim().min(1).max(8000),
  })
  .strict();
export const VoiceTranscriptResponse = z.object({
  message_id: Id,
  inserted: z.boolean(),
});

// Voice host → API: one spoken answer to an open Aiur Command.
export const VoiceCommandAnswerRequest = z
  .object({
    target: VoiceTarget,
    command_id: z.string().min(1).max(200),
    choice: z.string().trim().min(1).max(4000),
    idempotency_key: z.string().min(1).max(200),
  })
  .strict();
export const VoiceCommandAnswerResponse = z.object({
  status: z.enum(['answered', 'stale', 'failed']),
});

export type VoiceTarget = z.infer<typeof VoiceTarget>;
export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequest>;
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;
export type BriefingPush = z.infer<typeof BriefingPush>;
export type InstructRequest = z.infer<typeof InstructRequest>;
export type InstructResponse = z.infer<typeof InstructResponse>;
export type VoiceTranscriptRequest = z.infer<typeof VoiceTranscriptRequest>;
export type VoiceTranscriptResponse = z.infer<typeof VoiceTranscriptResponse>;
export type VoiceCommandAnswerRequest = z.infer<typeof VoiceCommandAnswerRequest>;
export type VoiceCommandAnswerResponse = z.infer<typeof VoiceCommandAnswerResponse>;

export const voiceSchemas = {
  'voice.token.request.v1': VoiceTokenRequest,
  'voice.token.response.v1': VoiceTokenResponse,
  'voice.briefing.push.v1': BriefingPush,
  'voice.instruct.request.v1': InstructRequest,
  'voice.instruct.response.v1': InstructResponse,
  'voice.transcript.request.v1': VoiceTranscriptRequest,
  'voice.transcript.response.v1': VoiceTranscriptResponse,
  'voice.command-answer.request.v1': VoiceCommandAnswerRequest,
  'voice.command-answer.response.v1': VoiceCommandAnswerResponse,
} satisfies Record<string, z.ZodType>;
