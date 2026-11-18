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
  // Files still copying: the panel polls until none are left, even for a closed ticket.
  mediaPending: number;
  timeline: { at: string; kind: string; label: string | null; quote: string | null }[];
};

const KIND: Record<string, MediaKind> = { image: 'image', animated_image: 'image', video: 'video', audio: 'audio' };
// A ticket with many rounds can list many files; the gallery shows the newest ones.
export const MAX_DETAIL_MEDIA = 40;

// At most this many daemon-to-blob copies run at once per API process: a ticket may list dozens of large clips, and
// opening it must not start them all together. The rest wait their turn and report as pending.
export const MAX_DETAIL_COPIES = 3;

type Copy = { promise: Promise<BlobHash>; state: 'pending' | 'done' | 'failed' };
type CopyRuntime = { byKey: Map<string, Copy>; active: number; queue: (() => void)[] };
const runtimes = new WeakMap<AppDeps, CopyRuntime>();

async function slot(runtime: CopyRuntime): Promise<() => void> {
  if (runtime.active >= MAX_DETAIL_COPIES) await new Promise<void>((resolve) => runtime.queue.push(resolve));
  runtime.active += 1;
  return () => {
    runtime.active -= 1;
    runtime.queue.shift()?.();
  };
}

function copied(deps: AppDeps, client: AiurClient, ticket: string, item: TicketDetailMedia): Copy {
  let runtime = runtimes.get(deps);
  if (runtime === undefined) runtimes.set(deps, (runtime = { byKey: new Map(), active: 0, queue: [] }));
  const { byKey } = runtime;
  const key = `${client.baseUrl}\n${ticket}\n${item.id}`;
  let copy = byKey.get(key);
  if (copy === undefined) {
    const started: Copy = {
      state: 'pending',
      promise: (async () => {
        const release = await slot(runtime);
        try {
          const file = await client.ticketDetailMedia(
            ticket,
            item.url,
            AbortSignal.timeout(aiurMediaTiming.copyTimeoutMs),
          );
          const ref = await deps.blobStore.put(capped(file.body, MAX_AIUR_MEDIA_BYTES), item.mime ?? file.mime);
          return ref.hash;
        } finally {
          release();
        }
      })(),
    };
    started.promise.then(
      () => {
        started.state = 'done';
      },
      (error: unknown) => {
        started.state = 'failed';
        deps.log({ event: 'ticket_detail_media_copy_failed', ticket, error: (error as Error).name });
        setTimeout(() => byKey.delete(key), aiurMediaTiming.retryAfterMs).unref();
      },
    );
    byKey.set(key, (copy = started));
  }
  return copy;
}

// A copy still running after a short wait leaves this read without the file and counts it as pending, so the panel
// polls again until it lands; a failed copy is left out until its retry window passes.
async function withinWait(copy: Copy): Promise<BlobHash | 'pending' | 'failed'> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), aiurMediaTiming.inboxWaitMs);
  });
  try {
    return await Promise.race([copy.promise, late]);
  } catch {
    return 'failed';
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
  const copies = await Promise.all(items.map((item) => withinWait(copied(deps, client, ticket, item))));
  const media = await Promise.all(
    items.map(async (item, index) => {
      const hash = copies[index]!;
      return hash === 'pending' || hash === 'failed'
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
    mediaPending: copies.filter((copy) => copy === 'pending').length,
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
