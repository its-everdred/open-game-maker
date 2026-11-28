import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';

import { loadCatalog, loadIndex, packOf, type CatalogMediaRole, type ResolvedCard } from '@ogm/asset-cards';
import { Hono } from 'hono';

import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { streamMedia, type MediaFile } from './byte-range.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};
const PREVIEWS = new Set(['thumb', 'sheet', 'waveform', 'clip', 'specimen', 'diorama', 'loop']);

/** Resolve only a named file from the indexed card, confined to the library root. */
export async function catalogMediaFile(root: string, card: ResolvedCard, role: string): Promise<MediaFile | undefined> {
  if (card.status === 'quarantined' || card.status === 'rejected' || !card.resolved.rights.uses.length) return;
  let path: string | undefined;
  if (role === 'source' && card.resolved.rights.uses.includes('in-game')) {
    const pack = packOf(card.id);
    const version = /@([^@/]+)$/.exec(card.id)?.[1];
    const primary = card.source?.files.find((file) => file.role === 'primary');
    if (
      pack &&
      version &&
      version !== '.' &&
      version !== '..' &&
      primary &&
      !isAbsolute(primary.path) &&
      !primary.path.split(/[\\/]/).includes('..')
    ) {
      path = join('packs', pack, version, 'extracted', primary.path);
    }
  } else if (PREVIEWS.has(role)) {
    path = card.previews?.[role as Exclude<CatalogMediaRole, 'source'>];
  }
  return role === 'source' ? safeSourceFile(root, path) : safeMediaFile(root, path);
}

/** Some older cards omit one vendor wrapper directory. Accept only a unique suffix match. */
async function safeSourceFile(root: string, path: string | undefined): Promise<MediaFile | undefined> {
  const direct = await safeMediaFile(root, path);
  if (direct || !path) return direct;
  const match = /^(packs\/[a-z0-9][a-z0-9-]*\/[^/]+\/extracted)\/(.+)$/.exec(path);
  if (!match || match[1]!.split('/').includes('..') || match[2]!.split('/').includes('..')) return;
  try {
    const base = await realpath(root);
    const extracted = join(base, match[1]!);
    const [info, resolved] = await Promise.all([lstat(extracted), realpath(extracted)]);
    const within = relative(base, resolved);
    if (!info.isDirectory() || info.isSymbolicLink() || within.startsWith('..') || isAbsolute(within)) return;
    const entries = await readdir(resolved, { recursive: true });
    const matches = entries.filter((entry) => entry === match[2] || entry.endsWith(`/${match[2]}`));
    if (matches.length !== 1) return;
    return safeMediaFile(root, join(match[1]!, matches[0]!));
  } catch {
    return;
  }
}

async function safeMediaFile(root: string, path: string | undefined): Promise<MediaFile | undefined> {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes('..')) return;
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) return;
  try {
    const base = await realpath(root);
    const candidate = join(base, path);
    const [info, resolved] = await Promise.all([lstat(candidate), realpath(candidate)]);
    const within = relative(base, resolved);
    if (!info.isFile() || info.isSymbolicLink() || within.startsWith('..') || isAbsolute(within)) return;
    return { path: resolved, bytes: (await stat(resolved)).size, mime };
  } catch {
    return;
  }
}

export function catalogMediaRoutes(assetsRoot: string | undefined): Hono<ApiBindings> {
  let cached: { at: number; value: ReturnType<typeof loadIndex> } | undefined;
  let recoveredCache: { at: number; value: ReturnType<typeof loadCatalog> } | undefined;
  const index = () => {
    if (!cached || Date.now() - cached.at > 5000) {
      const next = { at: Date.now(), value: loadIndex(assetsRoot!) };
      cached = next;
      void next.value.catch(() => {
        if (cached === next) cached = undefined;
      });
    }
    return cached.value;
  };
  const recoveredIndex = () => {
    if (!recoveredCache || Date.now() - recoveredCache.at > 5000) {
      const next = { at: Date.now(), value: loadCatalog(assetsRoot!) };
      recoveredCache = next;
      void next.value.catch(() => {
        if (recoveredCache === next) recoveredCache = undefined;
      });
    }
    return recoveredCache.value;
  };
  return new Hono<ApiBindings>().get('/assets/:id/media/:role', async (c) => {
    requirePrincipal(c, ['user']);
    if (!assetsRoot) return c.json({ error: 'not_found' }, 404);
    const cards = await index();
    const card = cards.cards.find((item) => item.id === c.req.param('id'));
    const collection = card?.collection ? cards.collections[card.collection] : undefined;
    if (collection?.status === 'quarantined' || collection?.status === 'rejected')
      return c.json({ error: 'not_found' }, 404);
    let file = card && (await catalogMediaFile(assetsRoot, card, c.req.param('role')));
    if (!card) {
      const recovered = (await recoveredIndex().catch(() => undefined))?.recovered.get(c.req.param('id'));
      const role = c.req.param('role');
      if (recovered?.rights.uses.length) {
        const path =
          role === 'source' && recovered.rights.uses.includes('in-game')
            ? recovered.sourcePath
            : PREVIEWS.has(role)
              ? recovered.previews[role as Exclude<CatalogMediaRole, 'source'>]
              : undefined;
        file = role === 'source' ? await safeSourceFile(assetsRoot, path) : await safeMediaFile(assetsRoot, path);
      }
    }
    if (!file) return c.json({ error: 'not_found' }, 404);
    return streamMedia(file, c.req.header('range'));
  });
}
