import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { api, ApiError } from '../../lib/api/client';

// The creator's conversation with the Executor, through the API's owner-only proxy of aiur's thread
// (aiur-team/aiur#8034). The thread is one conversation for the whole instance, so it lives in one store that the
// menu's badge and the open thread share.

export type ThreadMedia = { id: string; kind: 'image' | 'audio' | 'video'; mime: string | null; url: string };
export type ThreadMessage = {
  id: string;
  pos?: number | null;
  request_id?: number | null;
  role: 'operator' | 'executor' | 'system';
  text: string;
  attachments: ThreadMedia[];
  created_at?: string | null;
  delivery?: 'queued' | 'delivered' | 'outcome_unknown' | null;
  // A message this device sent that aiur has not listed yet.
  local?: 'sending' | 'sent';
};
type Page = { messages: ThreadMessage[]; next_after: number; queued: ThreadMessage[] };
export type ThreadContext = { game_id?: string; screen?: string };
export type ThreadAttachment = {
  upload_id: string;
  kind: 'image' | 'audio' | 'video' | 'screenshot';
  mime_type: string;
};

const PAGE_LIMIT = 100;
export const OPEN_POLL_MS = 3_000;
export const CLOSED_POLL_MS = 30_000;
const SEEN_KEY = 'ogm:executor-thread:seen';

type ThreadStore = {
  owner: string | undefined;
  journal: ThreadMessage[];
  queued: ThreadMessage[];
  local: ThreadMessage[];
  after: number;
  loaded: boolean;
  open: boolean;
  setOpen(open: boolean): void;
};

export const useThreadStore = create<ThreadStore>()((set) => ({
  owner: undefined,
  journal: [],
  queued: [],
  local: [],
  after: 0,
  loaded: false,
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openThread(): void {
  useThreadStore.getState().setOpen(true);
}

export function closeThread(): void {
  useThreadStore.getState().setOpen(false);
}

// Whether this creator may use the thread at all: the API answers 403 for anyone but the instance owner, and 503 when
// the instance has no core daemon. A 502 is the owner with the daemon briefly unreachable, so the thread stays offered.
// Asked once per creator per page load.
const access = new Map<string, Promise<boolean>>();

export function useThreadAccess(creatorId: string | undefined): boolean {
  const [allowed, setAllowed] = useState<{ creatorId: string; ok: boolean }>();
  useEffect(() => {
    if (!creatorId) return;
    let current = true;
    let check = access.get(creatorId);
    if (!check) {
      check = api('/me/executor/thread').then(
        () => true,
        (error: unknown) => error instanceof ApiError && error.status === 502,
      );
      access.set(creatorId, check);
    }
    void check.then((ok) => {
      if (current) setAllowed({ creatorId, ok });
    });
    return () => {
      current = false;
    };
  }, [creatorId]);
  return creatorId !== undefined && allowed?.creatorId === creatorId && allowed.ok;
}

// The store holds one creator's thread; another account signed in on this device starts empty.
function own(creatorId: string): void {
  if (useThreadStore.getState().owner !== creatorId)
    useThreadStore.setState({ owner: creatorId, journal: [], queued: [], local: [], after: 0, loaded: false });
}

// Reads every page after the last position seen. A page shorter than the limit is the end.
export async function pull(creatorId: string): Promise<void> {
  const store = useThreadStore;
  own(creatorId);
  for (;;) {
    const after = store.getState().after;
    const page = await api<Page>(`/me/executor/thread/messages?after=${after}`);
    if (store.getState().owner !== creatorId) return;
    store.setState((state) => ({
      journal: merge(state.journal, page.messages),
      queued: page.queued,
      local: state.local.filter((message) => !listed(message, page)),
      after: Math.max(state.after, page.next_after),
      loaded: true,
    }));
    if (page.messages.length < PAGE_LIMIT || page.next_after <= after) break;
  }
}

function merge(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => (left.pos ?? 0) - (right.pos ?? 0));
}

// A sent message is listed once aiur reports it, queued or delivered, under the request id the send returned.
function listed(message: ThreadMessage, page: Page): boolean {
  if (message.request_id == null) return false;
  return [...page.messages, ...page.queued].some(
    (item) =>
      item.request_id === message.request_id ||
      /* A journal entry aiur lists without its request id still matches by what was written. */
      (message.local === 'sent' &&
        item.request_id == null &&
        item.role === 'operator' &&
        shownText(item) === message.text),
  );
}

// Polls the thread for the signed-in owner: often while it is open, rarely otherwise (enough for the badge).
export function useThreadPolling(creatorId: string | undefined, enabled: boolean): void {
  const open = useThreadStore((state) => state.open);
  useEffect(() => {
    if (!creatorId || !enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await pull(creatorId);
      } catch {
        // The next tick tries again; the thread keeps what it has.
      }
      if (!stopped) timer = setTimeout(() => void tick(), open ? OPEN_POLL_MS : CLOSED_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [creatorId, enabled, open]);
}

// What the thread shows: aiur's journal in order, then operator messages still queued for a session, then this
// device's sends aiur has not listed yet.
export function threadMessages(state: Pick<ThreadStore, 'journal' | 'queued' | 'local'>): ThreadMessage[] {
  const delivered = new Set(state.journal.map((message) => message.request_id).filter((id) => id != null));
  const queued = state.queued.filter((message) => message.request_id == null || !delivered.has(message.request_id));
  const pending = new Set(queued.map((message) => message.request_id));
  const local = state.local.filter(
    (message) => message.request_id == null || (!delivered.has(message.request_id) && !pending.has(message.request_id)),
  );
  return [...state.journal, ...queued, ...local];
}

function seenKey(creatorId: string): string {
  return `${SEEN_KEY}:${creatorId}`;
}

function readSeen(creatorId: string): number | null {
  try {
    const raw = localStorage.getItem(seenKey(creatorId));
    return raw === null ? null : Number(raw) || 0;
  } catch {
    return null;
  }
}

export function markSeen(creatorId: string, pos: number): void {
  try {
    if ((readSeen(creatorId) ?? -1) < pos) localStorage.setItem(seenKey(creatorId), String(pos));
  } catch {
    // Private mode: the badge resets with the page.
  }
}

function latestExecutorPos(journal: ThreadMessage[]): number {
  return journal.reduce(
    (latest, message) => (message.role === 'executor' ? Math.max(latest, message.pos ?? 0) : latest),
    0,
  );
}

// Executor replies the owner has not opened the thread to see. A device's first load counts nothing: the history
// before it is not news. While the thread is open everything is seen.
export function useUnreadReplies(creatorId: string | undefined): number {
  const { journal, loaded, open, owner } = useThreadStore();
  const latest = latestExecutorPos(journal);
  const ready = creatorId !== undefined && loaded && owner === creatorId;
  useEffect(() => {
    if (!ready) return;
    if (open || readSeen(creatorId) === null) markSeen(creatorId, latest);
  }, [creatorId, latest, open, ready]);
  if (!ready || open) return 0;
  const seen = readSeen(creatorId) ?? latest;
  return journal.filter((message) => message.role === 'executor' && (message.pos ?? 0) > seen).length;
}

export async function uploadThreadFile(file: File, type: string): Promise<{ upload_id: string }> {
  return api<{ upload_id: string }>('/me/executor/thread/uploads', {
    method: 'POST',
    headers: { 'content-type': type, 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });
}

// Sends one message. The id is per message, so a retry of a lost response is the same message to aiur.
export async function sendThreadMessage(
  creatorId: string,
  text: string,
  context: ThreadContext,
  attachments: ThreadAttachment[],
  clientRequestId: string = crypto.randomUUID(),
): Promise<void> {
  const local: ThreadMessage = {
    id: `local-${clientRequestId}`,
    role: 'operator',
    text,
    attachments: [],
    created_at: new Date().toISOString(),
    local: 'sending',
  };
  own(creatorId);
  useThreadStore.setState((state) => ({ local: [...state.local, local] }));
  try {
    const { message } = await api<{ message: ThreadMessage }>('/me/executor/thread/messages', {
      method: 'POST',
      json: {
        text,
        client_request_id: clientRequestId,
        context,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    });
    useThreadStore.setState((state) => ({
      local: state.local.map((item) =>
        item.id === local.id
          ? { ...item, request_id: message.request_id, delivery: message.delivery, local: 'sent' }
          : item,
      ),
    }));
  } catch (error) {
    useThreadStore.setState((state) => ({ local: state.local.filter((item) => item.id !== local.id) }));
    throw error;
  }
  void pull(creatorId).catch(() => undefined);
}

// The note a send carries about where the creator was is for the Executor; the thread shows only what they wrote.
export function shownText(message: ThreadMessage): string {
  return message.role === 'operator'
    ? message.text.replace(/\n*\[Sent from Open Game Maker: [^\]\n]*\]\s*$/u, '')
    : message.text;
}
