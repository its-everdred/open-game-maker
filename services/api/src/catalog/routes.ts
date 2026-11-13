import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';

import { Hono } from 'hono';

import {
  loadFamilies,
  loadIndex,
  licenseFor,
  packOf,
  packsOfFamily,
  type ResolvedCard,
  type StyleFamilyApi,
} from '@ogm/asset-cards';
import type { BlobHash, BlobStore } from '@ogm/blob-store';
import { loadEnv } from '@ogm/config';
import {
  legacyStyleShowcaseSequenceSchema,
  smallScaleIntShowcaseV5Schema,
  smallScaleIntShowcaseV6Schema,
  type StyleShowcase,
  type StyleShowcaseMedia,
} from '@ogm/contracts';

import type { ApiBindings } from '../app/types.js';
import { requirePrincipal } from '../app/principal.js';
import { audioStyleRoutes } from './audio-styles.js';
import { streamMedia } from './byte-range.js';

export type { StyleFamilyApi } from '@ogm/asset-cards';

// The creation flow (OGM-074) reads this path; T09 §4 fixed it before the `/api/v1` convention.
export const prefix = '/api/catalog';

const CACHE_MS = 5 * 60_000;
// Outlives a body cached here (5 min) and then by the client (max-age 300); the store rounds it up to a day anyway.
const THUMB_TTL_MS = 24 * 60 * 60_000;
const blobHash = /^sha256:[0-9a-f]{64}$/;
const MEDIA_MIME = new Map([
  ['.gif', 'image/gif'],
  ['.json', 'application/json'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
]);

type ShowcaseFile = { path: string; bytes: number; mime: string };
type DiscoveredShowcase = { showcase: StyleShowcase; files: Map<string, ShowcaseFile> };

/** What `gm packs index --import-previews` (OGM-067) adds to an index entry; card files never carry it. */
type Imported = { previews?: { blob?: { thumb?: string } }; visibility?: 'private' | 'library' };

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function safeFile(root: string, path: string): Promise<ShowcaseFile | undefined> {
  try {
    const [info, resolved] = await Promise.all([lstat(path), realpath(path)]);
    if (!info.isFile() || info.isSymbolicLink() || !isInside(root, resolved)) return undefined;
    const file = await stat(resolved);
    const mime = MEDIA_MIME.get(extname(resolved));
    if (!mime) return undefined;
    return { path: resolved, bytes: file.size, mime };
  } catch {
    return undefined;
  }
}

async function safeDirectory(root: string, path: string): Promise<string | undefined> {
  try {
    const [info, resolved] = await Promise.all([lstat(path), realpath(path)]);
    if (!info.isDirectory() || info.isSymbolicLink() || !isInside(root, resolved)) return undefined;
    return resolved;
  } catch {
    return undefined;
  }
}

function mediaUrl(setId: string, name: string): string {
  return `${prefix}/style-sets/${encodeURIComponent(setId)}/showcase/${encodeURIComponent(name)}`;
}

function stopLabel(id: string): string {
  return id.replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

async function discoverShowcase(
  assetsRoot: string | undefined,
  setId: string,
): Promise<DiscoveredShowcase | undefined> {
  if (!assetsRoot || !loadFamilies().some((family) => family.sets.some((set) => set.id === setId))) return undefined;
  let root: string;
  try {
    root = await realpath(assetsRoot);
  } catch {
    return undefined;
  }
  const showcaseRoot = await safeDirectory(root, join(root, 'sets', setId, 'showcase'));
  if (!showcaseRoot) return undefined;
  const mediaRoot = await safeDirectory(showcaseRoot, join(showcaseRoot, 'out', 'media'));
  if (!mediaRoot) return undefined;
  const files = new Map<string, ShowcaseFile>();
  const add = async (name: string): Promise<string | undefined> => {
    const file = await safeFile(mediaRoot, join(mediaRoot, name));
    if (!file) return undefined;
    files.set(name, file);
    return mediaUrl(setId, name);
  };
  const addMedia = async (source: {
    mp4: string;
    gif: string;
    poster: string;
  }): Promise<StyleShowcaseMedia | undefined> => {
    const [videoUrl, gifUrl, posterUrl] = await Promise.all([add(source.mp4), add(source.gif), add(source.poster)]);
    if (!videoUrl || !gifUrl || !posterUrl) return undefined;
    return { videoUrl, gifUrl, posterUrl };
  };

  const manifestPath = join(mediaRoot, 'manifest.json');
  let manifestPresent = true;
  try {
    await lstat(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') manifestPresent = false;
    else return undefined;
  }
  if (manifestPresent) {
    const manifestFile = await safeFile(mediaRoot, manifestPath);
    if (!manifestFile) return undefined;
    let input: unknown;
    try {
      input = JSON.parse(await readFile(manifestFile.path, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
    const v6 = smallScaleIntShowcaseV6Schema.safeParse(input);
    if (v6.success) {
      const [region, sheet, resolvedStops] = await Promise.all([
        addMedia(v6.data.tracks.region),
        addMedia(v6.data.tracks.sheet),
        Promise.all(
          v6.data.stops.map(async (stop) => {
            const [regionPosterUrl, sheetPosterUrl] = await Promise.all([
              add(stop.region.poster),
              add(stop.sheet.poster),
            ]);
            if (!regionPosterUrl || !sheetPosterUrl) return undefined;
            return {
              id: stop.id,
              label: stop.label ?? stopLabel(stop.id.replace(/^\d+-/u, '')),
              startSeconds: stop.start_time,
              region: { posterUrl: regionPosterUrl },
              sheet: { posterUrl: sheetPosterUrl },
            } satisfies StyleShowcase['stops'][number];
          }),
        ),
      ]);
      const stops = resolvedStops.filter((stop) => stop !== undefined);
      if (!region || !sheet || stops.length !== v6.data.stops.length) return undefined;
      return {
        showcase: {
          regionVideoUrl: region.videoUrl,
          sheetVideoUrl: sheet.videoUrl,
          stops,
        },
        files,
      };
    }

    const parsed = smallScaleIntShowcaseV5Schema.safeParse(input);
    if (!parsed.success) return undefined;
    const [resolvedStops, outlineSheet] = await Promise.all([
      Promise.all(
        parsed.data.stops.map(async (stop) => {
          const [region, sheet] = await Promise.all([addMedia(stop.region), addMedia(stop.sheet)]);
          if (!region || !sheet) return undefined;
          return {
            id: stop.id,
            label: stop.label,
            startSeconds: stop.startSeconds ?? 0,
            region,
            sheet,
          } satisfies StyleShowcase['stops'][number];
        }),
      ),
      addMedia(parsed.data.outlineOptions.sheet),
    ]);
    const stops = resolvedStops.filter((stop) => stop !== undefined);
    if (stops.length !== parsed.data.stops.length || !outlineSheet) return undefined;
    return {
      showcase: {
        stops,
        outlineOptions: {
          id: parsed.data.outlineOptions.id,
          label: parsed.data.outlineOptions.label,
          sheet: outlineSheet,
        },
      },
      files,
    };
  }

  const sequenceFile = await safeFile(showcaseRoot, join(showcaseRoot, 'sequence.json'));
  if (!sequenceFile) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(await readFile(sequenceFile.path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  const parsed = legacyStyleShowcaseSequenceSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const [tileVideoUrl, sheetVideoUrl] = await Promise.all([
    add('showcase.tiles-row.720.mp4'),
    add('showcase.sheets.720.mp4'),
  ]);
  let startSeconds = 0;
  const apiStops: StyleShowcase['stops'] = [];
  for (const [index, { tile, sheet, seconds }] of parsed.data.stops.entries()) {
    const number = index + 1;
    const [tileFallbackUrl, sheetFallbackUrl] = await Promise.all([
      add(`${number}-${tile}.tile.256.gif`),
      add(`${number}-${sheet}.sheet.256.gif`),
    ]);
    apiStops.push({
      id: tile,
      label: stopLabel(tile),
      startSeconds,
      ...(tileFallbackUrl ? { tileFallbackUrl } : {}),
      ...(sheetFallbackUrl ? { sheetFallbackUrl } : {}),
    });
    startSeconds += seconds;
  }
  if (!tileVideoUrl && !sheetVideoUrl && apiStops.every((stop) => !stop.tileFallbackUrl && !stop.sheetFallbackUrl))
    return undefined;
  return {
    showcase: {
      ...(tileVideoUrl ? { tileVideoUrl } : {}),
      ...(sheetVideoUrl ? { sheetVideoUrl } : {}),
      stops: apiStops,
    },
    files,
  };
}

/** Fail closed unless every pack resolves to a recognized public SPDX license. */
export function setRequiresPrivateRepository(
  packIds: readonly string[],
  resolvedLicenseFor: (packId: string) => string | undefined,
): boolean {
  return packIds.some((packId) => {
    const value = resolvedLicenseFor(packId);
    const license = value ? licenseFor(value) : undefined;
    return !license || license.id.startsWith('LicenseRef-') || license.ceiling.audience !== 'public';
  });
}

/** A signed URL only for a public collection whose imported thumb blob the store holds. */
export async function thumbnailUrl(
  blobStore: BlobStore,
  card: (ResolvedCard & Imported) | undefined,
): Promise<string | null> {
  const thumb = card?.previews?.blob?.thumb;
  if (!card || !thumb || !blobHash.test(thumb)) return null;
  if (card.visibility === 'private' || card.resolved.rights.audience !== 'public') return null;
  const hash = thumb as BlobHash;
  if (!(await blobStore.head(hash))) return null;
  return (await blobStore.signedGet(hash, new Date(Date.now() + THUMB_TTL_MS))).url;
}

async function styleFamilies(assetsRoot: string | undefined, blobStore: BlobStore): Promise<StyleFamilyApi[]> {
  const byPack = new Map<string, ResolvedCard>();
  if (assetsRoot) {
    for (const card of Object.values((await loadIndex(assetsRoot)).collections)) {
      const pack = packOf(card.id);
      if (pack) byPack.set(pack, card);
    }
  }
  const apiPack = async (id: string) => {
    const card = byPack.get(id);
    return {
      id,
      name: card?.title ?? id,
      thumbnailUrl: await thumbnailUrl(blobStore, card),
      aiGenerated: card?.generation?.method === 'ai',
    };
  };
  return Promise.all(
    loadFamilies().map(async (f) => ({
      id: f.id,
      label: f.label,
      dimension: f.dimension,
      fidelity: f.fidelity,
      views: f.views,
      creationChoice: f.creation_choice,
      coverage: f.coverage,
      packs: await Promise.all(packsOfFamily(f).map(apiPack)),
      sets: await Promise.all(
        f.sets.map(async (set) => {
          const showcase = (await discoverShowcase(assetsRoot, set.id))?.showcase;
          return {
            id: set.id,
            label: set.label,
            pickerFamilies: set.picker_families ?? [],
            vendors: set.vendors,
            traits: set.traits,
            requiresPrivateRepository: setRequiresPrivateRepository(
              set.packs.map((pack) => pack.id),
              (pack) => byPack.get(pack)?.resolved.license,
            ),
            packs: await Promise.all(
              set.packs.map(async (pack) => ({
                ...(await apiPack(pack.id)),
                compatibleWith: pack.compatible_with ?? [],
              })),
            ),
            ...(showcase ? { showcase } : {}),
          };
        }),
      ),
    })),
  );
}

/** `GET /style-families`: public (no principal), cached in memory for five minutes, with an ETag. */
export function catalogRoutes(opts: { assetsRoot?: string }): Hono<ApiBindings> {
  type Entry = { body: string; etag: string };
  type ShowcaseEntry = { at: number; entry: Promise<DiscoveredShowcase | undefined> };
  let cached: { at: number; entry: Promise<Entry> } | undefined;
  const knownSetIds = new Set(loadFamilies().flatMap((family) => family.sets.map((set) => set.id)));
  const showcaseCache = new Map<string, ShowcaseEntry>();
  const build = async (blobStore: BlobStore): Promise<Entry> => {
    const body = JSON.stringify(await styleFamilies(opts.assetsRoot, blobStore));
    return { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"` };
  };
  const cachedShowcase = (setId: string): Promise<DiscoveredShowcase | undefined> => {
    if (!knownSetIds.has(setId)) return Promise.resolve(undefined);
    const current = showcaseCache.get(setId);
    if (current && Date.now() - current.at <= CACHE_MS) return current.entry;
    const next = { at: Date.now(), entry: discoverShowcase(opts.assetsRoot, setId) };
    showcaseCache.set(setId, next);
    void next.entry.then(
      (discovered) => {
        if (!discovered && showcaseCache.get(setId) === next) showcaseCache.delete(setId);
      },
      () => {
        if (showcaseCache.get(setId) === next) showcaseCache.delete(setId);
      },
    );
    return next.entry;
  };
  return (
    new Hono<ApiBindings>()
      .get('/style-families', async (c) => {
        // One shared build per cache period, so a burst never rebuilds the index concurrently; a failed build is retried.
        if (!cached || Date.now() - cached.at > CACHE_MS) {
          const next = { at: Date.now(), entry: build(c.get('deps').blobStore) };
          cached = next;
          next.entry.catch(() => {
            if (cached === next) cached = undefined;
          });
        }
        const entry = await cached.entry;
        c.header('ETag', entry.etag);
        c.header('Cache-Control', 'public, max-age=300');
        if (c.req.header('if-none-match') === entry.etag) return c.body(null, 304);
        c.header('Content-Type', 'application/json');
        return c.body(entry.body);
      })
      .get('/style-sets/:setId/showcase/:file', async (c) => {
        requirePrincipal(c, ['user']);
        const discovered = await cachedShowcase(c.req.param('setId'));
        const file = discovered?.files.get(c.req.param('file'));
        if (!file) return c.json({ error: 'not_found' }, 404);
        return streamMedia(file, c.req.header('range'));
      })
      // The Sound step's tiles and their 60 s montages (#357); the montage builder writes the files this reads.
      .route('/', audioStyleRoutes({ assetsRoot: opts.assetsRoot, prefix }))
  );
}

const env = loadEnv('api', { OGM_ASSETS_ROOT: { kind: 'path', required: false } });

export default catalogRoutes({ assetsRoot: env.OGM_ASSETS_ROOT });
