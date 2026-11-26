import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { blobPath, buildDir, resolveFile } from '@ogm/games-host/layout';
import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { findGame } from './games.js';
import { gameMedia } from './media.js';
import type { DisplayImage } from '../builds/display-images.js';

type Media = {
  logoUrl?: string;
  coverUrl?: string;
  logoImage?: DisplayImage;
  coverImage?: DisplayImage;
  tagline?: string;
  tags?: string[];
  choices?: { genre: string[] };
};

function cardUrls(media: Media): string[] {
  return [
    media.logoUrl,
    media.coverUrl,
    ...[media.logoImage, media.coverImage].flatMap((image) =>
      image ? Object.values(image.sources).flatMap((entries) => entries.map((entry) => entry.path)) : [],
    ),
  ].filter((url): url is string => typeof url === 'string');
}

function cardPath(gameId: string, url: string): string {
  return `/api/v1/games/${encodeURIComponent(gameId)}/card-image/${Buffer.from(url).toString('base64url')}`;
}

/** Expose only card artwork; build files and all other game media still require host authorization. */
export function publicCardMedia(gameId: string, media: Media | undefined): Media | undefined {
  if (!media) return undefined;
  const safe = (url: string | undefined) =>
    url && /\.(?:png|webp|avif)$/u.test(new URL(url).pathname) ? cardPath(gameId, url) : undefined;
  const image = (value: Media['logoImage']) =>
    value && {
      ...value,
      sources: Object.fromEntries(
        Object.entries(value.sources).map(([format, entries]) => [
          format,
          entries.map((entry) => ({ ...entry, path: cardPath(gameId, entry.path) })),
        ]),
      ) as typeof value.sources,
    };
  const logoImage = image(media.logoImage);
  const coverImage = image(media.coverImage);
  return {
    ...(safe(media.logoUrl) || logoImage ? { logoUrl: safe(media.logoUrl) ?? logoImage!.sources.png[0]?.path } : {}),
    ...(safe(media.coverUrl) || coverImage
      ? { coverUrl: safe(media.coverUrl) ?? coverImage!.sources.png[0]?.path }
      : {}),
    ...(logoImage ? { logoImage } : {}),
    ...(coverImage ? { coverImage } : {}),
    ...(media.tagline ? { tagline: media.tagline } : {}),
    ...(media.tags ? { tags: media.tags } : {}),
    ...(media.choices ? { choices: media.choices } : {}),
  };
}

export async function readPublicCardImage(
  deps: AppDeps,
  gameId: string,
  token: string,
): Promise<{ bytes: Buffer; type: string }> {
  const game = findGame(deps.db, gameId);
  if (game.delistedAt !== null || game.releaseState !== 'coming_soon' || !/^[A-Za-z0-9_-]{1,2048}$/u.test(token))
    throw new HttpError(404, 'image_not_found');
  const media = (await gameMedia(deps, [gameId])).get(gameId);
  const url = Buffer.from(token, 'base64url').toString('utf8');
  if (!media || !cardUrls(media).includes(url)) throw new HttpError(404, 'image_not_found');
  const parsed = new URL(url);
  if (parsed.origin !== new URL(deps.config.gamesOrigin).origin) throw new HttpError(404, 'image_not_found');
  const extension = extname(parsed.pathname);
  const type = ({ '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' } as Record<string, string>)[
    extension
  ];
  if (!type) throw new HttpError(404, 'image_not_found');
  const parts = parsed.pathname.split('/');
  let path: string | null = null;
  try {
    if (parts.length === 3 && parts[1] === 'a' && parts[2]) path = blobPath(deps.config.gamesRoot, parts[2]);
    if (parts.length >= 6 && parts[1] === 'g' && parts[2] === gameId && parts[3]) {
      path = await resolveFile(buildDir(deps.config.gamesRoot, gameId, parts[3]), parts.slice(4).join('/'));
    }
    if (!path) throw new Error('invalid path');
    const info = await stat(path);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('invalid image');
    return { bytes: await readFile(path), type };
  } catch {
    throw new HttpError(404, 'image_not_found');
  }
}
