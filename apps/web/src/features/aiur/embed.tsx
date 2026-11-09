import { createElement, useEffect, useRef, type ReactNode } from 'react';

import type { GameCommand } from '@ogm/contracts';

// aiur ships the embeddable Commands and conversation components as custom elements (aiur#7487, aiur#7488) so the
// dashboard and this app share one behaviour. The browser never calls aiur: the element gets OGM proxy URLs and a
// ticket set scoped to one game, and answers come back as `aiur-answer` events. Until that package is in the
// workspace the tags are unregistered and every surface renders its own markup, so this file is the only place that
// knows aiur exists.
export const AIUR_COMMANDS_TAG = 'aiur-commands';
export const AIUR_CONVERSATION_TAG = 'aiur-conversation';

// What an embedded surface may read and where it posts. Every URL is OGM's own proxy.
export type AiurEmbedScope = {
  game: string;
  tickets: string[];
  commands: string;
  conversation: string;
  stream: string;
};

// What the surface may offer. The component still probes what the host answers at runtime.
export type AiurEmbedFeatures = { voice: boolean; dictation: boolean; attachments: boolean };

export type AiurCommandAnswer = { job_id: string; command_id: string; option_id: string };

const ALL_FEATURES: AiurEmbedFeatures = { voice: true, dictation: true, attachments: true };

export function gameScope(gameId: string, tickets: string[]): AiurEmbedScope {
  const game = encodeURIComponent(gameId);
  return {
    game: gameId,
    tickets: [...new Set(tickets)],
    commands: `/api/v1/games/${game}/commands`,
    conversation: '',
    stream: '',
  };
}

export function jobScope(gameId: string, jobId: string, ticket: string | null): AiurEmbedScope {
  const job = encodeURIComponent(jobId);
  return {
    ...gameScope(gameId, ticket === null ? [] : [ticket]),
    conversation: `/api/v1/jobs/${job}/chat/messages`,
    stream: `/api/v1/jobs/${job}/chat`,
  };
}

export function features(): AiurEmbedFeatures {
  return ALL_FEATURES;
}

export function aiurElementRegistered(tag: string): boolean {
  return typeof window !== 'undefined' && window.customElements?.get(tag) !== undefined;
}

// The element gets objects, not attribute strings: rich Commands carry media and answer events carry ids.
function assign(label: string, ref: React.RefObject<HTMLElement | null>, properties: Record<string, unknown>) {
  const node = ref.current;
  if (node) Object.assign(node, { ...properties, label });
}

function listen<T>(ref: React.RefObject<HTMLElement | null>, name: string, handler: (detail: T) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const listener = (event: Event) => latest.current((event as CustomEvent<T>).detail);
    node.addEventListener(name, listener);
    return () => node.removeEventListener(name, listener);
  }, [name, ref]);
}

export function AiurCommands({
  scope,
  commands,
  onAnswer,
  children,
}: {
  scope: AiurEmbedScope;
  commands: readonly GameCommand[];
  onAnswer(answer: AiurCommandAnswer): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    assign(AIUR_COMMANDS_TAG, ref, { scope, commands, features: features() });
  }, [scope, commands]);
  listen<AiurCommandAnswer>(ref, 'aiur-answer', (detail) => onAnswer(detail));
  if (!aiurElementRegistered(AIUR_COMMANDS_TAG)) return <>{children}</>;
  return createElement(AIUR_COMMANDS_TAG, { ref, 'data-tickets': scope.tickets.join(' ') });
}

export function AiurConversation({
  scope,
  title,
  onAnswer,
  children,
}: {
  scope: AiurEmbedScope;
  title: string;
  onAnswer(answer: AiurCommandAnswer): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    assign(AIUR_CONVERSATION_TAG, ref, { scope, title, features: features() });
  }, [scope, title]);
  listen<AiurCommandAnswer>(ref, 'aiur-answer', (detail) => onAnswer(detail));
  if (!aiurElementRegistered(AIUR_CONVERSATION_TAG)) return <>{children}</>;
  return createElement(AIUR_CONVERSATION_TAG, { ref, 'data-tickets': scope.tickets.join(' ') });
}
