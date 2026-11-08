import type { AiurClient, Decision, DecisionMedia } from '@ogm/aiur-client';
import type { BlobHash } from '@ogm/blob-store';
import type { CommandOption } from '@ogm/contracts';
import sharp from 'sharp';

import type { MediaSigner } from '../build-chat/store.js';
import type { AppDeps } from '../app/types.js';

// A Command no job owns carries its option media in aiur's public projection: a vetted https file is a `url` locator
// the browser may load as is, and a file on the aiur host is an `attachment` only the supervisor token can read. Such a
// file is copied once into the blob store and signed exactly like a job checkpoint's media, so the browser never holds
// an aiur credential. Copies are remembered per instance, decision and attachment; a failed copy is retried on the
// next inbox read, and the option is listed without media meanwhile.

type OptionMedia = NonNullable<CommandOption['media']>;
type Stored = { hash: BlobHash; width?: number; height?: number };

// aiur's own per-kind ceiling for a video, the largest it accepts.
export const MAX_AIUR_MEDIA_BYTES = 250 * 1024 * 1024;

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

async function* capped(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > MAX_AIUR_MEDIA_BYTES) throw new Error('aiur media too large');
    yield chunk;
  }
}

async function copy(deps: AppDeps, client: AiurClient, decisionId: string, item: DecisionMedia, attachmentId: string) {
  const file = await client.decisionMedia(decisionId, attachmentId);
  const mime = item.mime_type ?? file.mime;
  if (KIND[item.kind ?? ''] !== 'image' || (dimension(item.width) && dimension(item.height))) {
    const ref = await deps.blobStore.put(capped(file.body), mime);
    return { hash: ref.hash };
  }
  // A still without its size is measured, so its card keeps the picture's shape.
  const chunks: Uint8Array[] = [];
  for await (const chunk of capped(file.body)) chunks.push(chunk);
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
    pending.catch(() => byKey.delete(key));
  }
  return pending;
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
    const copied = await stored(deps, client, decisionId, item, locator.attachment_id);
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

// The media each option shows, by option id: its first item the deck can render. An item aiur cannot serve leaves its
// option without media and is logged; it never fails the inbox.
export async function optionMediaFromAiur(
  deps: AppDeps,
  client: AiurClient,
  gameId: string,
  decision: Decision,
  sign: MediaSigner,
): Promise<Map<string, OptionMedia>> {
  const media = new Map<string, OptionMedia>();
  await Promise.all(
    decision.options.map(async (option) => {
      const item = (option.media ?? []).find((candidate) => KIND[candidate.kind ?? ''] !== undefined);
      if (item === undefined) return;
      try {
        const resolved = await resolveItem(deps, client, decision.decision_id, item, sign);
        if (resolved !== undefined) media.set(option.id, resolved);
      } catch (error) {
        deps.log({
          event: 'game_command_media_unavailable',
          gameId,
          decisionId: decision.decision_id,
          error: (error as Error).name,
        });
      }
    }),
  );
  return media;
}
