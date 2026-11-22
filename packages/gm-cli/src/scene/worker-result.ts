import type { EmbeddedAsset, Embedding } from './match.js';

/** Local worker output is trusted only after its pack rights validation succeeds. */
export type SceneMatchResult = {
  query: Embedding;
  candidates: readonly EmbeddedAsset[];
  examined: number;
  eligible: number;
  truncated: boolean;
};

export type SceneBatchMatchResult = Omit<SceneMatchResult, 'candidates'> & {
  mock_sha256: string;
  candidates: readonly (EmbeddedAsset & { source_sha256: string })[];
  scope: { pack: string; kind: 'sprite'; facing: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' };
  regions: readonly { crop: readonly [number, number, number, number]; query: Embedding }[];
};
