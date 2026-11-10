import type { AssetCard, Audience, Genre, Mood, Redistribution, Use } from '@ogm/contracts';

export type Rights = { uses: Use[]; audience: Audience; redistribution: Redistribution };

export type ResolvedCard = AssetCard & {
  resolved: {
    license: string;
    rights: Rights;
    style_family?: string;
    set?: string;
    pov_fit?: string[];
    settings?: string[];
    environments?: string[];
    provenance: Record<string, { by: 'collection' }>;
  };
};

export type IndexError = { path: string; errors: string[] };

export type CardIndex = {
  version: 2;
  built: string;
  vocab: string;
  cards: ResolvedCard[];
  collections: Record<string, ResolvedCard>;
  errors: IndexError[];
};

export type SearchQuery = {
  words?: string[];
  kind?: string;
  subkind?: string;
  family?: string;
  /**
   * `describe.moods` the card must carry, all of them. This is the audio-style direction query (#357): a creator picks
   * a mood, and every mood the card was tagged with has to agree.
   */
  moods?: Mood[];
  /** `describe.genre`, any of them: styles are alternatives on one axis, moods are separate axes. */
  genres?: Genre[];
  /** Exact curated compatibility-set id. */
  set?: string;
  /** The game's family (from `assets.lock.json`): only cards of this family or `any` (R55). */
  gameFamily?: string;
  /** Compatibility-set ids inferred from packs already in the lockfile. */
  gameSets?: string[];
  /** Exact locked packs that remain eligible when a lock also names a compatibility set. */
  gamePacks?: string[];
  pov?: string;
  use?: Use;
  rigId?: string;
  sameRigAs?: string;
  includeDraft?: boolean;
  /** Hide assets whose typed generation marker says they were AI-generated. */
  excludeAiGenerated?: boolean;
  tier?: number;
  /** Exact facing count a directional sprite must carry (`sprite.directions` length). */
  directions?: number;
  collection?: string;
  limit?: number;
};
