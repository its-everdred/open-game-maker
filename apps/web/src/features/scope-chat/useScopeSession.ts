import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgreedScope, ScopeChoices } from '@ogm/contracts';

import { ApiError } from '../../lib/api/client';
import { reduceMessages, type StreamedChatMessage } from '../build-chat/stream';
import { scopeTransport, type ScopeTransport } from './transport';
import { energyRefusalText } from '../energy/api';

export type ScopeTurn = { id: string; who: 'you' | 'builder'; text: string };
export type ScopeStatus = 'connecting' | 'open' | 'agreed' | 'unavailable' | 'error';

export function useScopeSession(
  gameId: string,
  choices: ScopeChoices,
  transport: ScopeTransport = scopeTransport,
  allowAiGeneratedAssets = true,
) {
  const [sessionId, setSessionId] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const [scope, setScope] = useState<AgreedScope>();
  const [messages, setMessages] = useState<StreamedChatMessage[]>([]);
  const [status, setStatus] = useState<ScopeStatus>('connecting');
  const [error, setError] = useState('');
  const latestScope = useRef<string | undefined>(undefined);
  const retainDraft = useRef(false);
  const choicesKey = JSON.stringify(choices);

  useEffect(() => {
    let current = true;
    let refreshing = false;
    let stopStream: (() => void) | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let sessionIdForCleanup: string | undefined;

    const refresh = async (id: string) => {
      if (refreshing) return;
      refreshing = true;
      try {
        const session = await transport.getSession(gameId, id);
        if (!current) return;
        if ((session.status === 'agreed' || session.status === 'promoted') && session.scope) {
          const next = JSON.stringify(session.scope);
          if (latestScope.current === next) return;
          latestScope.current = next;
          setScope(session.scope);
          setStatus('agreed');
          setError('');
        } else if (session.status === 'abandoned') {
          setStatus('error');
          setError('This scope conversation was closed.');
        } else {
          setStatus('open');
          setError('');
        }
      } finally {
        refreshing = false;
      }
    };

    void transport
      .createSession(gameId, JSON.parse(choicesKey) as ScopeChoices, allowAiGeneratedAssets)
      .then(({ sessionId: createdSessionId, jobId: createdJobId }) => {
        if (!current) {
          void transport.abandonSession(gameId, createdSessionId).catch(() => undefined);
          return;
        }
        sessionIdForCleanup = createdSessionId;
        setSessionId(createdSessionId);
        setJobId(createdJobId);
        setStatus('open');
        stopStream = transport.subscribe(createdJobId, (message) => {
          if (current) setMessages((existing) => reduceMessages(existing, message));
        });
        void refresh(createdSessionId).catch(handleError);
        poll = setInterval(() => void refresh(createdSessionId).catch(handleError), 2_000);
      })
      .catch(handleError);

    function handleError(cause: unknown) {
      if (!current) return;
      if (
        cause instanceof ApiError &&
        cause.status === 402 &&
        cause.body &&
        typeof cause.body === 'object' &&
        'window' in cause.body &&
        cause.body.window === 'week' &&
        'resetsAt' in cause.body &&
        typeof cause.body.resetsAt === 'string'
      ) {
        setStatus('unavailable');
        setError(energyRefusalText('week', cause.body.resetsAt) ?? 'Energy is empty.');
      } else if (cause instanceof ApiError && (cause.status === 402 || cause.status === 404 || cause.status === 503)) {
        setStatus('unavailable');
        setError('The builder is unavailable right now. Try again later.');
      } else {
        setStatus('error');
        setError('The builder lost the conversation. Try again.');
      }
    }

    return () => {
      current = false;
      clearInterval(poll);
      stopStream?.();
      if (sessionIdForCleanup && !retainDraft.current) {
        void transport.abandonSession(gameId, sessionIdForCleanup).catch(() => undefined);
      }
    };
  }, [allowAiGeneratedAssets, choicesKey, gameId, transport]);

  const addMessage = useCallback(
    (message: StreamedChatMessage) => setMessages((existing) => reduceMessages(existing, message)),
    [],
  );
  const retain = useCallback(() => {
    retainDraft.current = true;
  }, []);

  const send = useCallback(
    async (text: string, attachments?: string[]) => {
      if (!jobId) return;
      addMessage(await (attachments ? transport.postText(jobId, text, attachments) : transport.postText(jobId, text)));
    },
    [addMessage, jobId, transport],
  );

  const turns: ScopeTurn[] = messages.flatMap((message) =>
    message.text && message.actor !== 'system'
      ? [
          {
            id: message.id,
            who: message.actor === 'creator' ? ('you' as const) : ('builder' as const),
            text: message.text,
          },
        ]
      : [],
  );

  return { sessionId, jobId, scope, turns, status, error, send, addMessage, retain };
}
