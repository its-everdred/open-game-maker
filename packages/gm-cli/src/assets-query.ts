import type { SearchQuery } from '@ogm/asset-cards';
import { GENRES, MOODS, type Genre, type Mood, type Use } from '@ogm/contracts';

import { UsageError, type FlagSpec } from './command.js';

const USES: Use[] = [
  'in-game',
  'placeholder',
  'derive-layout',
  'style-reference',
  'vision-input',
  'edit-audio',
  'derive-audio',
];

export const FILTER_FLAGS: FlagSpec = {
  kind: { type: 'string', help: 'kind or kind/subkind (model/kit, audio/music/loop)' },
  family: { type: 'string', help: 'style family (chunky-low-poly)' },
  mood: {
    type: 'string',
    multiple: true,
    help: `mood the card must carry, repeat for all of them (${MOODS.join(', ')})`,
  },
  genre: { type: 'string', multiple: true, help: `genre, any of them (${GENRES.join(', ')})` },
  set: { type: 'string', help: 'exact curated compatibility set (smallscaleint)' },
  pov: { type: 'string', help: 'camera fit (iso, topdown, side, follow, fps, orbit)' },
  use: { type: 'string', default: 'in-game', help: `allowed use (${USES.join(', ')})` },
  'rig-id': { type: 'string', help: 'only cards on this rig or retargeting to it' },
  'same-rig-as': { type: 'string', help: 'only cards sharing or retargeting to the rig of this card id' },
  'include-draft': { type: 'boolean', default: false, help: 'also match draft cards of every kind' },
  'exclude-ai-generated': { type: 'boolean', default: false, help: 'hide assets marked as AI-generated' },
  tier: { type: 'number', help: 'library tier 1, 2 or 3' },
  directions: { type: 'number', help: 'exact facing count of a directional sprite (8)' },
  collection: { type: 'string', help: 'only this collection id' },
};

/** The values of a repeatable string flag, refusing a value the card schema could never hold. */
function vocabulary<T extends string>(name: string, values: unknown, allowed: readonly T[], command: string): T[] {
  const raw = values === undefined ? [] : Array.isArray(values) ? values : [values];
  return raw.map((value) => {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new UsageError(
        `unknown ${name} "${String(value)}"`,
        `gm ${command} --${name} ${allowed.slice(0, 3).join(` --${name} `)} (gm assets facets lists what the cards carry)`,
      );
    }
    return value as T;
  });
}

/** Map the shared filter flags to a SearchQuery, refusing unknown uses, tiers and audio direction values. */
export function toQuery(name: string, words: string[], flags: Record<string, unknown>): SearchQuery {
  const use = flags.use as string;
  if (!USES.includes(use as Use)) throw new UsageError(`unknown use "${use}"`, `gm ${name} --use in-game`);
  const q: SearchQuery = {
    words,
    use: use as Use,
    includeDraft: flags['include-draft'] === true,
    excludeAiGenerated: flags['exclude-ai-generated'] === true,
  };
  if (typeof flags.kind === 'string') {
    const [kind, ...sub] = flags.kind.split('/');
    q.kind = kind;
    if (sub.length > 0) q.subkind = sub.join('/');
  }
  if (flags.tier !== undefined) {
    if (![1, 2, 3].includes(flags.tier as number))
      throw new UsageError('--tier must be 1, 2 or 3', `gm ${name} --tier 1`);
    q.tier = flags.tier as number;
  }
  const moods: Mood[] = vocabulary('mood', flags.mood, MOODS, name);
  if (moods.length > 0) q.moods = moods;
  const genres: Genre[] = vocabulary('genre', flags.genre, GENRES, name);
  if (genres.length > 0) q.genres = genres;
  if (flags.directions !== undefined) {
    if (!Number.isInteger(flags.directions) || (flags.directions as number) < 1)
      throw new UsageError('--directions must be a positive whole number', `gm ${name} --directions 8`);
    q.directions = flags.directions as number;
  }
  if (typeof flags.family === 'string') q.family = flags.family;
  if (typeof flags.set === 'string') q.set = flags.set;
  if (typeof flags.pov === 'string') q.pov = flags.pov;
  if (typeof flags['rig-id'] === 'string') q.rigId = flags['rig-id'];
  if (typeof flags['same-rig-as'] === 'string') q.sameRigAs = flags['same-rig-as'];
  if (typeof flags.collection === 'string') q.collection = flags.collection;
  return q;
}
