import { access, open } from 'node:fs/promises';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { buildDir } from '@ogm/games-host/layout';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDeps } from '../app/types.js';
import type { DisplayImage } from '../builds/display-images.js';

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const MAX_LEGACY_MANIFEST_BYTES = 1024 * 1024;

async function manifestMedia(
  directory: string,
): Promise<{
  logo?: string;
  genres?: string[];
  images?: Record<string, DisplayImage>;
  loading?: { portrait: string; landscape: string };
}> {
  try {
    const file = await open(join(directory, '.ogm-display.json'), 'r').catch(() =>
      open(join(directory, 'manifest.json'), 'r'),
    );
    let bytes: Buffer;
    try {
      const size = (await file.stat()).size;
      if (size > MAX_LEGACY_MANIFEST_BYTES) return {};
      // One extra byte detects a file that grows between stat and read.
      const buffer = Buffer.alloc(size + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > size) return {};
      bytes = buffer.subarray(0, length);
    } finally {
      await file.close();
    }
    const manifest = JSON.parse(bytes.toString('utf8')) as {
      logo?: unknown;
      genres?: unknown;
      images?: Record<string, DisplayImage>;
      loading?: unknown;
    };
    const logo = manifest.logo;
    const genres = manifest.genres;
    const loading = manifest.loading as Record<string, unknown> | null | undefined;
    const validLoading = async (path: unknown): Promise<boolean> =>
      typeof path === 'string' && /^media\/[a-zA-Z0-9_-]+\.png$/u.test(path) && (await exists(join(directory, path)));
    const portrait = loading?.portrait;
    const landscape = loading?.landscape;
    const loadingValid = (await validLoading(portrait)) && (await validLoading(landscape));
    return {
      ...(loadingValid ? { loading: { portrait: portrait as string, landscape: landscape as string } } : {}),
      ...(typeof logo === 'string' &&
      /^media\/[a-zA-Z0-9_-]+\.(png|webp|svg)$/u.test(logo) &&
      (await exists(join(directory, logo)))
        ? { logo }
        : {}),
      ...(manifest.images && typeof manifest.images === 'object' ? { images: manifest.images } : {}),
      ...(Array.isArray(genres) &&
      genres.length <= 4 &&
      genres.every((g) => typeof g === 'string' && g.length > 0 && g.length <= 32)
        ? { genres: genres as string[] }
        : {}),
    };
  } catch {
    return {};
  }
}

/** Media belongs to the current main build, so a new publish updates both URLs atomically. */
export async function gameMedia(deps: AppDeps, gameIds: string[]) {
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
        choices?: { genre: string[] };
        coverUrl?: string;
        trailerUrl?: string;
        portraitTrailerUrl?: string;
        coverImage?: DisplayImage;
        logoImage?: DisplayImage;
      },
    ]
  > = [];
  for (let index = 0; index < branches.length; index += 8) {
    entries.push(
      ...(await Promise.all(
        branches.slice(index, index + 8).map(async ({ gameId, buildId }) => {
          if (!buildId) return [gameId, {}] as const;
          let directory: string;
          try {
            directory = buildDir(deps.config.gamesRoot, gameId, buildId);
          } catch {
            return [gameId, {}] as const;
          }
          if (!(await exists(join(directory, '.complete')))) return [gameId, {}] as const;
          const [cover, landscape, portrait, manifest] = await Promise.all([
            exists(join(directory, 'media/thumbnail.png')),
            exists(join(directory, 'media/trailer-landscape.mp4')),
            exists(join(directory, 'media/trailer-portrait.mp4')),
            manifestMedia(directory),
          ]);
          const origin = deps.config.gamesOrigin.replace(/\/$/, '');
          const base = `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/media`;
          const image = (key: string | undefined): DisplayImage | undefined => {
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
                    new RegExp(`^media/ogm-variants/[a-f0-9]{64}\\.${format}$`, 'u').test(entry.path),
                )
              )
                return undefined;
            }
            const prefix = `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/`;
            return {
              ...value,
              sources: Object.fromEntries(
                (['avif', 'webp', 'png'] as const).map((format) => [
                  format,
                  sources[format].map((entry) => ({ ...entry, path: prefix + entry.path })),
                ]),
              ) as DisplayImage['sources'],
            };
          };
          const coverImage = image('media/thumbnail.png');
          const logoImage = image(manifest.logo);
          return [
            gameId,
            {
              ...(manifest.logo
                ? {
                    logoUrl: `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/${manifest.logo}`,
                  }
                : {}),
              ...(coverImage ? { coverImage } : {}),
              ...(logoImage ? { logoImage } : {}),
              ...(manifest.loading
                ? {
                    loadingUrls: {
                      portrait: `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/${manifest.loading.portrait}`,
                      landscape: `${origin}/g/${encodeURIComponent(gameId)}/${encodeURIComponent(buildId)}/${manifest.loading.landscape}`,
                    },
                  }
                : {}),
              ...(manifest.genres ? { choices: { genre: manifest.genres } } : {}),
              ...(cover ? { coverUrl: `${base}/thumbnail.png` } : {}),
              ...(landscape ? { trailerUrl: `${base}/trailer-landscape.mp4` } : {}),
              ...(portrait ? { portraitTrailerUrl: `${base}/trailer-portrait.mp4` } : {}),
            },
          ] as const;
        }),
      )),
    );
  }
  return new Map(entries);
}
