import records from './showcase-data.json';
import type { GameSummary } from './types';

export type Showcase = {
  displayTags: Array<{ key: string; label: string; kind: string; color: string }>;
  id: string;
  title: string;
  font: string;
  color: string;
  badge: string;
  tagline: string;
  genres: string[];
  vibe: string[];
  art: string;
  players: string;
  world: string;
  controls: string;
  rating: number | null;
  votes: string;
  plays: string;
  updated: string;
  version: string;
  played: string;
};

// Keep real game identities and append other real games; showcase identities never pretend to be stored games.
export function mergeShowcase(games: GameSummary[]): GameSummary[] {
  const used = new Set<string>();
  const curated = (records as Showcase[]).map((record) => {
    const match = games.find((game) => game.slug === record.id || (!game.slug && game.title === record.title));
    if (match) {
      used.add(match.id);
      return { ...match, showcase: record };
    }
    return {
      id: `showcase:${record.id}`,
      familyId: '',
      ownerId: '',
      repo: null,
      createdAt: '',
      title: record.title,
      tagline: record.tagline,
      choices: { genre: record.genres, vibe: record.vibe },
      showcase: record,
    } satisfies GameSummary;
  });
  return [...curated, ...games.filter((game) => !used.has(game.id))];
}
