import { ICONS } from '../../icons';
import type { Showcase } from './showcase';
import type { Branch, Job, JobKind, JobState, SlotId, ViewportId } from '@ogm/contracts';

export type { Branch };

// OGM-012's list response currently has no shared client type. Optional fields are the forward-compatible display
// projection named by OGM-073; the adapter keeps today's smaller response useful while those fields land.
export type DisplayImage = {
  width: number;
  height: number;
  sources: Record<'avif' | 'webp' | 'png', { width: number; path: string }[]>;
};

export type GameSummary = {
  showcase?: Showcase;
  id: string;
  creationStatus?: 'creating' | 'failed' | 'ready';
  familyId: string;
  ownerId: string;
  title: string;
  allowAiGeneratedAssets?: boolean;
  demo?: boolean;
  /** The shareable `/play/<slug>` segment; null only for a game written before slugs existed. */
  slug?: string | null;
  visibility?: 'listed' | 'private';
  releaseState?: 'released' | 'coming_soon';
  canPlay?: boolean;
  canManageRelease?: boolean;
  repoVisibility?: 'public' | 'private';
  repo: { owner: string; name: string; url?: string; visibility?: 'public' | 'private' } | null;
  createdAt: string;
  updatedAt?: string;
  lastPlayedAt?: string | null;
  logoUrl?: string | null;
  logoImage?: DisplayImage | null;
  coverImage?: DisplayImage | null;
  slotImages?: Partial<Record<SlotId, Partial<Record<ViewportId, DisplayImage>>>>;
  loadingUrls?: { portrait: string; landscape: string };
  loadingImages?: { portrait: DisplayImage; landscape: DisplayImage };
  coverUrl?: string | null;
  trailerUrl?: string | null;
  publishedReleaseId?: string | null;
  tagline?: string;
  tags?: string[];
  /** Play-data stats; a stat the game has no data for is absent. */
  stats?: { plays?: number; version?: string };
  choices?: { genre?: string[]; vibe?: string[] };
};

export type JobView = Pick<Job, 'id' | 'gameId'> & {
  kind: JobKind;
  state: JobState;
  friendlyState?: string;
  stageText?: string;
  progressPercent?: number | null;
  updatedAt?: string;
};

export const TERMINAL_JOB_STATES = new Set<JobState>(['done', 'failed', 'cancelled']);

// Blobs predates manifest genres; its established puzzle genre remains available until it is republished.
export function gameGenres(game: GameSummary): string[] {
  return game.choices?.genre ?? (game.slug === 'blobs' ? ['puzzle'] : []);
}

export function gameTags(game: GameSummary): string[] {
  return [...new Set([...(game.tags ?? []), ...gameGenres(game), ...(game.choices?.vibe ?? [])])];
}

export function gameUpdatedAt(game: GameSummary): string {
  return game.updatedAt ?? game.createdAt;
}

// Manifest tags are free text; these spellings name an icon the set already has.
const TAG_ICONS: Record<string, string> = {
  'pixel art': 'pixel',
  'turn based': 'turns',
  narrative: 'story',
  'single player': 'solo',
  singleplayer: 'solo',
  multiplayer: 'party',
};

/** Genre labels can come from creators; unknown labels use the existing generic icon. */
export function genreIcon(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, ' ');
  if (Object.hasOwn(TAG_ICONS, key)) return TAG_ICONS[key]!;
  return Object.hasOwn(ICONS, key) ? key : 'other';
}
