import type { AiurClient, Decision, DecisionMedia } from '@ogm/aiur-client';
import type { BlobHash } from '@ogm/blob-store';
import type { CommandOption } from '@ogm/contracts';
import sharp from 'sharp';

import type { MediaSigner } from '../build-chat/store.js';
import type { AppDeps } from '../app/types.js';

// A Command no job owns carries its option media in aiur's public projection: a vetted https file is a `url` locator
// the browser may load as is, and a file on the aiur host is an `attachment` only the supervisor token can read. Such a
// file is copied once into the blob store and signed exactly like a job checkpoint's media, so the browser never holds
// an aiur credential. Copies are remembered per instance, decision and attachment. The inbox waits a moment for a
// copy and then lists the option without media while the copy finishes for the next read; a stalled transfer is
// aborted, and a failed copy is tried again only after a while so a broken file is not refetched on every poll.

type OptionMedia = NonNullable<CommandOption['media']>;
type Stored = { hash: BlobHash; width?: number; height?: number };

// aiur's own per-kind ceilings: a video is the largest file it accepts, an animated image the largest still. A still
// measured here is held in memory whole, so it gets the still ceiling; everything else streams into the blob store.
export const MAX_AIUR_MEDIA_BYTES = 250 * 1024 * 1024;
export const MAX_AIUR_IMAGE_BYTES = 25 * 1024 * 1024;

// How long one inbox read waits for a copy, how long a transfer may take, and how long a failure is remembered.
// Mutable for tests only.
export const aiurMediaTiming = { inboxWaitMs: 3_000, copyTimeoutMs: 120_000, retryAfterMs: 5 * 60_000 };

const KIND: Record<string, OptionMedia['kind']> = {
  image: 'image',
  animated_image: 'image',
  video: 'video',
  audio: 'audio',
};

// The deck sizes a card from width and height; a sample with none (audio, or an item aiur sent without them) gets the
// card size the deck's own fixtures use.
const FALLBACK = { width: 640, height: 360 };

const copies = new WeakMap<AppDeps, Map<string, Promise<Stored>>>();

function dimension(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function* capped(body: ReadableStream<Uint8Array>, limit: number): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) throw new Error('aiur media too large');
    yield chunk;
  }
}

async function copy(deps: AppDeps, client: AiurClient, decisionId: string, item: DecisionMedia, attachmentId: string) {
  const file = await client.decisionMedia(decisionId, attachmentId, AbortSignal.timeout(aiurMediaTiming.copyTimeoutMs));
  const mime = item.mime_type ?? file.mime;
  if (KIND[item.kind ?? ''] !== 'image' || (dimension(item.width) && dimension(item.height))) {
    const ref = await deps.blobStore.put(capped(file.body, MAX_AIUR_MEDIA_BYTES), mime);
    return { hash: ref.hash };
  }
  // A still without its size is measured, so its card keeps the picture's shape.
  const chunks: Uint8Array[] = [];
  for await (const chunk of capped(file.body, MAX_AIUR_IMAGE_BYTES)) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const meta = await sharp(bytes).metadata();
  const ref = await deps.blobStore.put(bytes, mime);
  return { hash: ref.hash, width: meta.width, height: meta.height };
}

function stored(deps: AppDeps, client: AiurClient, decisionId: string, item: DecisionMedia, attachmentId: string) {
  let byKey = copies.get(deps);
  if (byKey === undefined) {
    byKey = new Map();
    copies.set(deps, byKey);
  }
  const key = `${client.baseUrl}\n${decisionId}\n${attachmentId}`;
  let pending = byKey.get(key);
  if (pending === undefined) {
    pending = copy(deps, client, decisionId, item, attachmentId);
    byKey.set(key, pending);
    // Logged here, once, because a copy can fail after the read that started it has moved on.
    pending.catch((error: unknown) => {
      deps.log({ event: 'game_command_media_copy_failed', decisionId, error: (error as Error).name });
      setTimeout(() => byKey.delete(key), aiurMediaTiming.retryAfterMs).unref();
    });
  }
  return pending;
}

// A copy still running after the inbox's wait leaves this read without the media; the copy carries on, memoized.
async function withinInboxWait<T>(pending: Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), aiurMediaTiming.inboxWaitMs);
  });
  try {
    return await Promise.race([pending, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveItem(
  deps: AppDeps,
  client: AiurClient,
  decisionId: string,
  item: DecisionMedia,
  sign: MediaSigner,
): Promise<OptionMedia | undefined> {
  const kind = KIND[item.kind ?? ''];
  const locator = item.locator;
  if (kind === undefined || !locator) return undefined;
  let url: string;
  let measured: { width?: number; height?: number } = {};
  if (locator.kind === 'url' && locator.value) {
    url = locator.value;
  } else if (locator.kind === 'attachment' && locator.attachment_id) {
    const copied = await withinInboxWait(stored(deps, client, decisionId, item, locator.attachment_id));
    if (copied === undefined) return undefined;
    url = await sign(copied.hash);
    measured = copied;
  } else {
    return undefined;
  }
  // A poster on the aiur host is not one of the Command's own items, so aiur's media route does not serve it; only an
  // https poster is passed on. A clip without one still plays: its `kind` says it is a clip.
  const poster = kind === 'video' && item.poster?.kind === 'url' ? item.poster.value : undefined;
  const duration = kind === 'image' ? undefined : item.duration_ms;
  return {
    url,
    ...(poster ? { poster } : {}),
    width: dimension(item.width) ?? dimension(measured.width) ?? FALLBACK.width,
    height: dimension(item.height) ?? dimension(measured.height) ?? FALLBACK.height,
    ...(typeof duration === 'number' && Number.isInteger(duration) && duration >= 0 ? { duration_ms: duration } : {}),
    kind,
  };
}

// The media each option shows, by option id: its first item the deck can render, and its first audio item when that
// is not the shown one (a character card's portrait with its voice). An item aiur cannot serve leaves its option
// without that media (its copy logs the failure once); it never fails the inbox.
export type ResolvedOptionMedia = { media?: OptionMedia; audio?: OptionMedia };

export async function optionMediaFromAiur(
  deps: AppDeps,
  client: AiurClient,
  decision: Decision,
  sign: MediaSigner,
): Promise<Map<string, ResolvedOptionMedia>> {
  const resolved = new Map<string, ResolvedOptionMedia>();
  const quietly = async (item: DecisionMedia | undefined) => {
    if (item === undefined) return undefined;
    try {
      return await resolveItem(deps, client, decision.decision_id, item, sign);
    } catch {
      // The failed copy was logged once when it failed; every poll in its retry window lands here quietly.
      return undefined;
    }
  };
  await Promise.all(
    decision.options.map(async (option) => {
      const items = option.media ?? [];
      const shown = items.find((candidate) => KIND[candidate.kind ?? ''] !== undefined);
      const voice = KIND[shown?.kind ?? ''] === 'audio' ? undefined : items.find(({ kind }) => kind === 'audio');
      const [media, audio] = await Promise.all([quietly(shown), quietly(voice)]);
      if (media === undefined && audio === undefined) return;
      resolved.set(option.id, {
        ...(media === undefined ? {} : { media }),
        ...(audio === undefined ? {} : { audio }),
      });
    }),
  );
  return resolved;
}
