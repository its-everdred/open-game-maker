import { z } from 'zod';

// Aiur currently files the supplied text on the tracker's issue. Callers must not send private diagnostics here.
export type AgentConversationStart = {
  text: string;
  owner: string;
  client_request_id: string;
  path?: string;
  skills?: string[];
  complexity?: 1 | 2 | 3 | 4 | 5;
  title?: string;
};

export const AgentConversationSchema = z.object({
  conversation_id: z.string().min(1),
  ticket: z.string().regex(/^[1-9][0-9]*$/),
  url: z.string().nullable(),
  created: z.boolean(),
  thread: z.string(),
  messages: z.string(),
});

export type AgentConversation = z.output<typeof AgentConversationSchema>;
