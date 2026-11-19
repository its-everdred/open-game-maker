import { z } from 'zod';

import { DecisionMediaSchema } from './schemas.js';

// The operator↔Executor thread (aiur-team/aiur#8034, API in aiur#8046): one conversation between the instance's
// operator and its Executor. Reads come from the Executor's conversation journal; a send queues for the next session
// when no Executor is attached.

export const ExecutorThreadInfoSchema = z
  .object({
    conversation_id: z.string().nullish(),
    executor: z.object({ attached: z.boolean(), live: z.boolean() }).loose(),
    can_send: z.union([z.literal(true), z.object({ reason: z.string() }).loose()]),
  })
  .loose();

export const ExecutorThreadMessageSchema = z
  .object({
    id: z.string(),
    pos: z.number().int().nullish(),
    request_id: z.number().int().nullish(),
    role: z.enum(['operator', 'executor', 'system']),
    text: z.string(),
    // aiur's Commands media projection: an opaque `attachment_id`, never a path.
    attachments: z.array(DecisionMediaSchema).default([]),
    created_at: z.string().nullish(),
    delivery: z.enum(['queued', 'delivered', 'outcome_unknown']).nullish(),
  })
  .loose();

export const ExecutorThreadPageSchema = z
  .object({
    messages: z.array(ExecutorThreadMessageSchema),
    next_after: z.number().int().nonnegative(),
    queued: z.array(ExecutorThreadMessageSchema).default([]),
  })
  .loose();

export const ExecutorThreadUploadSchema = z
  .object({ upload_id: z.string(), kind: z.string(), mime_type: z.string(), byte_size: z.number().int() })
  .loose();

export const EXECUTOR_THREAD_ATTACHMENT_KINDS = ['image', 'audio', 'video', 'screenshot'] as const;

export type ExecutorThreadAttachment = {
  upload_id: string;
  kind: (typeof EXECUTOR_THREAD_ATTACHMENT_KINDS)[number];
  mime_type: string;
  caption?: string;
};

export type ExecutorThreadSend = {
  text: string;
  client_request_id: string;
  attachments?: ExecutorThreadAttachment[];
};

export type ExecutorThreadInfo = z.output<typeof ExecutorThreadInfoSchema>;
export type ExecutorThreadMessage = z.output<typeof ExecutorThreadMessageSchema>;
export type ExecutorThreadPage = z.output<typeof ExecutorThreadPageSchema>;
export type ExecutorThreadUpload = z.output<typeof ExecutorThreadUploadSchema>;
