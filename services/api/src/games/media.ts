import { access, open } from 'node:fs/promises';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { ImageSlots, type SlotId, type ViewportId } from '@ogm/contracts';
import { buildDir } from '@ogm/games-host/layout';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDeps } from '../app/types.js';
import type { DisplayImage } from '../builds/display-images.js';
import { hasCreatorMembership, issueGrant } from '../artifacts/grants.js';
import { currentPublishedBuild } from '../artifacts/published.js';
import type { Principal } from '@ogm/contracts';

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const MAX_LEGACY_MANIFEST_BYTES = 1024 * 1024;

async function readDisplayFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const file = await open(path, 'r');
    try {
      const size = (await file.stat()).size;
      if (size > MAX_LEGACY_MANIFEST_BYTES) return undefined;
      const buffer = Buffer.alloc(size + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > size) return undefined;
      const value: unknown = JSON.parse(buffer.subarray(0, length).toString('utf8'));
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } finally {
      await file.close();
    }
  } catch {
    return undefined;
  }
}

async function manifestMedia(directory: string): Promise<{
  logo?: string;
  genres?: string[];
  description?: string;
  tags?: string[];
  images?: Record<string, DisplayImage>;
  slotImages?: unknown;
  sharedUrls?: Record<string, string>;
  pending?: boolean;
  loading?: { portrait: string; landscape: string };
}> {
  try {
    const sidecar = await readDisplayFile(join(directory, '.ogm-display.json'));
    const source =
      !sidecar || sidecar.description === undefined || sidecar.tags === undefined
        ? await readDisplayFile(join(directory, 'manifest.json'))
        : undefined;
    const manifest = { ...source, ...sidecar } as {
      logo?: unknown;
      genres?: unknown;
      description?: unknown;
      tags?: unknown;
      images?: Record<string, DisplayImage>;
      slotImages?: unknown;
      sharedUrls?: Record<string, string>;
      loading?: unknown;
    };
    const logo = manifest.logo;
    const { genres, description, tags } = manifest;
    const names = (value: unknown, max: number): value is string[] =>
      Array.isArray(value) &&
      value.length <= max &&
      value.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 32);
    const loading = manifest.loading as Record<string, unknown> | null | undefined;
    const validLoading = async (path: unknown): Promise<boolean> =>
      typeof path === 'string' && /^media\/[a-zA-Z0-9_-]+\.png$/u.test(path) && (await exists(join(directory, path)));
    const portrait = loading?.portrait;
    const landscape = loading?.landscape;
    const loadingValid = (await validLoading(portrait)) && (await validLoading(landscape));
    const images =
      sidecar?.pending === true
        ? undefined
        : manifest.images && typeof manifest.images === 'object'
          ? manifest.images
          : undefined;
    return {
      ...(sidecar?.pending === true ? { pending: true } : {}),
      ...(loadingValid ? { loading: { portrait: portrait as string, landscape: landscape as string } } : {}),
      ...(typeof logo === 'string' &&
      /^media\/[a-zA-Z0-9_-]+\.(png|webp|svg)$/u.test(logo) &&
      (await exists(join(directory, logo)))
        ? { logo }
        : {}),
      ...(images ? { images } : {}),
      ...(manifest.slotImages && typeof manifest.slotImages === 'object' ? { slotImages: manifest.slotImages } : {}),
      ...(sidecar?.sharedUrls && typeof sidecar.sharedUrls === 'object'
        ? { sharedUrls: sidecar.sharedUrls as Record<string, string> }
        : {}),
      ...(names(genres, 4) ? { genres } : {}),
      ...(typeof description === 'string' && description.length > 0 && description.length <= 160
        ? { description }
        : {}),
      ...(names(tags, 8) ? { tags } : {}),
    };
  } catch {
    return {};
  }
}

/** Media belongs to the current main build; display variants have their own content address. */
export async function gameMedia(
  deps: AppDeps,
  gameIds: string[],
  viewer?: {
    principal: Extract<Principal, { kind: 'user' }>;
    headers: Headers;
  },
) {
  if (!gameIds.length) return new Map();
  const branches = deps.db
    .select({ gameId: schema.branches.gameId, buildId: schema.branches.latestBuildId })
    .from(schema.branches)
    .where(and(inArray(schema.branches.gameId, gameIds), eq(schema.branches.name, 'main')))
    .all();
  const entries: Array<
    readonly [
      string,
      {
        logoUrl?: string;
        loadingUrls?: { portrait: string; landscape: string };
        loadingImages?: { portrait: DisplayImage; landscape: DisplayImage };
        choices?: { genre: string[] };
        tagline?: string;
        tags?: string[];
        coverUrl?: string;
        trailerUrl?: string;
        coverImage?: DisplayImage;
        logoImage?: DisplayImage;
        slotImages?: Partial<Record<SlotId, Partial<Record<ViewportId, DisplayImage>>>>;
      },
    ]
  > = [];
  for (let index = 0; index < branches.length; index += 8) {
    entries.push(
      ...(await Promise.all(
        branches.slice(index, index + 8).map(async ({ gameId, buildId: latestBuildId }) => {
          const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
          const releaseBuildId = currentPublishedBuild(deps, gameId);
          const owner =
            !!viewer &&
            !!game &&
            viewer.principal.userId === game.ownerId &&
            viewer.principal.familyId === game.familyId &&
            viewer.principal.capability === 'creator' &&
            hasCreatorMembership(deps, game.familyId, viewer.principal.userId);
          const buildId = viewer && !owner ? releaseBuildId : latestBuildId;
          if (!buildId) return [gameId, {}] as const;
          let directory: string;
          try {
            directory = buildDir(deps.config.gamesRoot, gameId, buildId);
          } catch {
            return [gameId, {}] as const;
          }
          if (!(await exists(join(directory, '.complete')))) return [gameId, {}] as const;
          const [cover, trailer, manifest] = await Promise.all([
            exists(join(directory, 'media/thumbnail.png')),
            exists(join(directory, 'media/trailer-landscape.mp4')),
            manifestMedia(directory),
          ]);
          const origin = deps.config.gamesOrigin.replace(/\/$/, '');
          let grant: string | undefined;
          if (viewer && (game?.visibility !== 'listed' || releaseBuildId !== buildId)) {
            try {
              grant = await issueGrant(
                deps,
                gameId,
                buildId,
                viewer.principal.userId,
                viewer.headers,
                owner ? undefined : 'player',
              );
            } catch {
              return [gameId, {}] as const;
            }
          }
          const prefix = grant
            ? `${origin}/d/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/${grant}/`
            : `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/`;
          const base = `${prefix}media`;
          const assetUrl = (path: string) =>
            path.startsWith('/a/') ? (grant ? `${prefix}a/${path.slice(3)}` : `${origin}${path}`) : `${prefix}${path}`;
          const image = (key: string | undefined): DisplayImage | undefined => {
            if (manifest.pending) return undefined;
            const value = key && manifest.images?.[key];
            if (
              !value ||
              !Number.isSafeInteger(value.width) ||
              !Number.isSafeInteger(value.height) ||
              value.width <= 0 ||
              value.height <= 0 ||
              !value.sources
            )
              return undefined;
            const sources = value.sources;
            for (const format of ['avif', 'webp', 'png'] as const) {
              if (
                !Array.isArray(sources[format]) ||
                !sources[format].length ||
                !sources[format].every(
                  (entry) =>
                    entry !== null &&
                    typeof entry === 'object' &&
                    Number.isSafeInteger(entry.width) &&
                    entry.width > 0 &&
                    typeof entry.path === 'string' &&
                    new RegExp(`^(?:/a/|media/ogm-variants/)[a-f0-9]{64}\\.${format}$`, 'u').test(entry.path),
                )
              )
                return undefined;
            }
            return {
              ...value,
              sources: Object.fromEntries(
                (['avif', 'webp', 'png'] as const).map((format) => [
                  format,
                  sources[format].map((entry) => ({
                    ...entry,
                    path: assetUrl(entry.path),
                  })),
                ]),
              ) as DisplayImage['sources'],
            };
          };
          const coverImage = image('media/thumbnail.png');
          const logoImage = image(manifest.logo);
          const loadingPortrait = image(manifest.loading?.portrait);
          const loadingLandscape = image(manifest.loading?.landscape);
          const slots = ImageSlots.safeParse(manifest.slotImages);
          const slotImages = slots.success
            ? (Object.fromEntries(
                Object.entries(slots.data).map(([slotId, entry]) => [
                  slotId,
                  Object.fromEntries(
                    Object.entries(entry.variants ?? {}).flatMap(([viewport, path]) => {
                      const display = image(path);
                      return display ? [[viewport, display]] : [];
                    }),
                  ),
                ]),
              ) as Partial<Record<SlotId, Partial<Record<ViewportId, DisplayImage>>>>)
            : undefined;
          return [
            gameId,
            {
              // The web gates tile art on logoUrl/coverUrl (the image objects only add srcsets), so both stay.
              ...(manifest.logo
                ? {
                    logoUrl: manifest.sharedUrls?.[manifest.logo]
                      ? assetUrl(manifest.sharedUrls[manifest.logo]!)
                      : assetUrl(manifest.logo),
                  }
                : {}),
              ...(coverImage ? { coverImage } : {}),
              ...(logoImage ? { logoImage } : {}),
              ...(slotImages ? { slotImages } : {}),
              ...(manifest.loading
                ? {
                    loadingUrls: {
                      portrait: manifest.sharedUrls?.[manifest.loading.portrait]
                        ? assetUrl(manifest.sharedUrls[manifest.loading.portrait]!)
                        : assetUrl(manifest.loading.portrait),
                      landscape: manifest.sharedUrls?.[manifest.loading.landscape]
                        ? assetUrl(manifest.sharedUrls[manifest.loading.landscape]!)
                        : assetUrl(manifest.loading.landscape),
                    },
                  }
                : {}),
              ...(loadingPortrait && loadingLandscape
                ? { loadingImages: { portrait: loadingPortrait, landscape: loadingLandscape } }
                : {}),
              ...(manifest.genres ? { choices: { genre: manifest.genres } } : {}),
              ...(manifest.description ? { tagline: manifest.description } : {}),
              ...(manifest.tags ? { tags: manifest.tags } : {}),
              ...(cover
                ? {
                    coverUrl: manifest.sharedUrls?.['media/thumbnail.png']
                      ? assetUrl(manifest.sharedUrls['media/thumbnail.png']!)
                      : `${base}/thumbnail.png`,
                  }
                : {}),
              ...(trailer ? { trailerUrl: `${base}/trailer-landscape.mp4` } : {}),
            },
          ] as const;
        }),
      )),
    );
  }
  return new Map(entries);
}
