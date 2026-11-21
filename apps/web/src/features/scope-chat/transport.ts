import type { AgreedScope, ScopeChoices } from '@ogm/contracts';

import { api } from '../../lib/api/client';
import { subscribeChat, type StreamedChatMessage } from '../build-chat/stream';

export type ScopeSessionResponse = {
  sessionId: string;
  status: 'open' | 'agreed' | 'abandoned' | 'promoted';
  chatJobId: string;
  choices?: ScopeChoices;
  scope?: AgreedScope;
};

export type ScopeTransport = {
  createSession(
    gameId: string,
    choices: ScopeChoices,
    allowAiGeneratedAssets?: boolean,
  ): Promise<{ sessionId: string; jobId: string }>;
  getSession(gameId: string, sessionId: string): Promise<ScopeSessionResponse>;
  abandonSession(gameId: string, sessionId: string): Promise<void>;
  postText(jobId: string, text: string, attachments?: string[]): Promise<StreamedChatMessage>;
  subscribe(jobId: string, onMessage: (message: StreamedChatMessage) => void): () => void;
};

export const scopeTransport: ScopeTransport = {
  createSession: (_gameId, choices, allowAiGeneratedAssets = true) =>
    api<{ draftId: string; jobId: string }>('/game-drafts', {
      method: 'POST',
      json: { choices, allowAiGeneratedAssets },
    }).then((draft) => ({ sessionId: draft.draftId, jobId: draft.jobId })),
  getSession: (gameId, sessionId) => api(`/game-drafts/${encodeURIComponent(sessionId)}`),
  abandonSession: (_gameId, sessionId) =>
    api(`/game-drafts/${encodeURIComponent(sessionId)}/abandon`, { method: 'POST' }).then(() => undefined),
  postText: (jobId, text, attachments) =>
    api(`/jobs/${encodeURIComponent(jobId)}/chat`, {
      method: 'POST',
      json: { ...(text ? { text } : {}), ...(attachments ? { attachments } : {}) },
    }),
  subscribe: (jobId, onMessage) => subscribeChat(jobId, 0, onMessage),
};
