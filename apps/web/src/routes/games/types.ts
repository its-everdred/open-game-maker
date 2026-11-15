import { ICONS } from '../../icons';
import type { Showcase } from './showcase';
import type { Branch, Job, JobKind, JobState } from '@ogm/contracts';

export type { Branch };

// OGM-012's list response currently has no shared client type. Optional fields are the forward-compatible display
// projection named by OGM-073; the adapter keeps today's smaller response useful while those fields land.
export type GameSummary = {
  showcase?: Showcase;
  id: string;
  familyId: string;
  ownerId: string;
  title: string;
  allowAiGeneratedAssets?: boolean;
  /** The shareable `/play/<slug>` segment; null only for a game written before slugs existed. */
  slug?: string | null;
  visibility?: 'listed' | 'private';
  repoVisibility?: 'public' | 'private';
  repo: { owner: string; name: string; url?: string; visibility?: 'public' | 'private' } | null;
  createdAt: string;
  updatedAt?: string;
  lastPlayedAt?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  trailerUrl?: string | null;
  portraitTrailerUrl?: string | null;
  publishedReleaseId?: string | null;
  tagline?: string;
  tags?: string[];
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

/** Genre labels can come from creators; unknown labels use the existing generic icon. */
export function genreIcon(name: string): string {
  const key = name.trim().toLowerCase();
  return Object.hasOwn(ICONS, key) ? key : 'other';
}
