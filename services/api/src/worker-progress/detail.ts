import type { AiurClient, TicketDetail, TicketDetailMedia } from '@ogm/aiur-client';
import type { BlobHash } from '@ogm/blob-store';

import type { AppDeps } from '../app/types.js';
import type { MediaSigner } from '../build-chat/store.js';
import { aiurMediaTiming, capped, MAX_AIUR_MEDIA_BYTES } from '../commands/aiur-media.js';
import { belongsToGame, type ticketScope } from './scope.js';

type Repository = { owner: string; name: string };
type MediaKind = 'image' | 'video' | 'audio';

// What the hammer panel shows for one ticket (#873), from aiur's ticket detail (aiur-team/aiur#8043): a plain summary,
// where it stands, the worker's media and how it got there. Media is copied once into the blob store and signed like
// a Command's, so the browser never holds an aiur credential and a clip gets the blob route's range reads.
export type TicketDetailView = {
  ticket: string;
  title: string;
  status: string;
  phase: string | null;
  running: boolean;
  activity: string | null;
  summary: string | null;
  issueUrl: string | null;
  pr: { number: number; url: string; state: string; ci: string | null } | null;
  media: { id: string; kind: MediaKind; url: string; caption: string | null }[];
  timeline: { at: string; kind: string; label: string | null; quote: string | null }[];
};

const KIND: Record<string, MediaKind> = { image: 'image', animated_image: 'image', video: 'video', audio: 'audio' };
// A ticket with many rounds can list many files; the gallery shows the newest ones.
export const MAX_DETAIL_MEDIA = 40;

const copies = new WeakMap<AppDeps, Map<string, Promise<BlobHash>>>();

function copied(deps: AppDeps, client: AiurClient, ticket: string, item: TicketDetailMedia): Promise<BlobHash> {
  let byKey = copies.get(deps);
  if (byKey === undefined) copies.set(deps, (byKey = new Map()));
  const key = `${client.baseUrl}\n${ticket}\n${item.id}`;
  let pending = byKey.get(key);
  if (pending === undefined) {
    pending = (async () => {
      const file = await client.ticketDetailMedia(ticket, item.url, AbortSignal.timeout(aiurMediaTiming.copyTimeoutMs));
      const ref = await deps.blobStore.put(capped(file.body, MAX_AIUR_MEDIA_BYTES), item.mime ?? file.mime);
      return ref.hash;
    })();
    byKey.set(key, pending);
    pending.catch((error: unknown) => {
      deps.log({ event: 'ticket_detail_media_copy_failed', ticket, error: (error as Error).name });
      setTimeout(() => byKey.delete(key), aiurMediaTiming.retryAfterMs).unref();
    });
  }
  return pending;
}

// A copy still running after a short wait leaves this read without the file; the panel's next poll shows it.
async function withinWait<T>(pending: Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), aiurMediaTiming.inboxWaitMs);
  });
  try {
    return await Promise.race([pending, late]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function ticketDetailView(
  deps: AppDeps,
  client: AiurClient,
  ticket: string,
  sign: MediaSigner,
  read: TicketDetail,
): Promise<TicketDetailView> {
  const items = read.media.filter((item) => KIND[item.kind] !== undefined).slice(-MAX_DETAIL_MEDIA);
  const media = await Promise.all(
    items.map(async (item) => {
      const hash = await withinWait(copied(deps, client, ticket, item));
      return hash === undefined
        ? []
        : [{ id: item.id, kind: KIND[item.kind]!, url: await sign(hash), caption: text(item.caption) }];
    }),
  );
  return {
    ticket,
    title: read.title,
    status: read.status,
    phase: text(read.phase),
    running: read.live?.running === true,
    activity: text(read.live?.activity),
    summary: text(read.summary?.text),
    issueUrl: text(read.url),
    pr: read.pr
      ? { number: read.pr.number, url: read.pr.url, state: read.pr.state, ci: text(read.pr.ci?.state) }
      : null,
    media: media.flat(),
    timeline: read.timeline.map((entry) => ({
      at: entry.at,
      kind: entry.kind,
      label: text(entry.label),
      quote: text(entry.detail?.quote),
    })),
  };
}

// Whether a ticket is this game's, open or closed. A stale snapshot only vouches for tickets the game's own jobs
// filed: a shared daemon holds other games' tickets, so an unknown ticket is refused.
export async function ownsTicket(
  deps: AppDeps,
  repo: Repository,
  scope: ReturnType<typeof ticketScope>,
  ticket: string,
): Promise<boolean> {
  if (scope.owned.has(ticket)) return true;
  for (const state of ['open', 'closed'] as const) {
    const snapshot = await deps.registry.trackerTickets!(repo, state);
    const found = snapshot.tickets.find((item) => item.ticket === ticket);
    if (found && !snapshot.stale) return belongsToGame(found, scope);
  }
  const looked = deps.registry.trackerTicket ? await deps.registry.trackerTicket(repo, ticket) : null;
  return looked !== null && belongsToGame(looked, scope);
}
