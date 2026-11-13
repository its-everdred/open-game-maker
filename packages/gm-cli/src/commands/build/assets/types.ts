import type { AssetMetadata, CacheEntryKind, LockEntry, Tier } from '@ogm/contracts';

import type { ResolvedFile } from '../../../resolve.js';

export type LicenseEntry = {
  id: string;
  attribution?: string;
  use: 'any' | 'personal';
};

export type ManifestAssetEntry = {
  phase?: string;
  file: Partial<Record<Tier | '*', string>>;
  mesh?: string;
  bounds?: [number, number, number];
  license: LicenseEntry;
  meta?: AssetMetadata;
};

export type BuiltFileInfo = {
  bytes: number;
  tris?: number;
  gpuTexMB?: number;
  maxTexture?: number;
  decoders: Array<'meshopt' | 'draco' | 'ktx2'>;
};

export type JobResult = {
  files: Record<string, BuiltFileInfo>;
  assets: Record<string, ManifestAssetEntry>;
  /**
   * Generated names of the extra sheet files a card's `meta.sprite` points at, per lock entry, so the manifest
   * attributes each one to its asset in the cache plan. Absent when the card has no extra sheets.
   */
  companions?: Record<string, string[]>;
};

export type FreshJobResult = JobResult & { buffers: Record<string, Buffer> };

export type GltfFacts = {
  triangles: number;
  rigged: boolean;
  animated: boolean;
  textureKeys: string[];
};

export type BuildItem = {
  entry: LockEntry;
  source: string;
  /**
   * Every file the lock lists for the entry, primary first. Image jobs encode the sheets a sprite card's
   * `meta.sprite` names; other kinds build from `source` alone.
   */
  files?: ResolvedFile[];
  meta?: AssetMetadata;
  facts?: GltfFacts;
  sourceHash?: string;
};

export type CacheIdentity = { sourceHash: string; key: string };

export type BuildJob = {
  kind: 'kit' | 'model' | 'image' | 'audio' | 'font';
  cacheKind: CacheEntryKind;
  slug: string;
  items: BuildItem[];
  tiers: Tier[];
  recipe: Record<string, unknown>;
  /** Image jobs in a `pixel-art` family game encode losslessly so sheet frames stay exact. */
  pixelArt?: boolean;
};

export type CompletedJob = { job: BuildJob; result: JobResult };

export type BuildFailure = { id: string; message: string };

export type AssetBudgetReport = {
  tier: Tier;
  phase: string;
  bytes: number;
  files: number;
  tris: number;
  gpuTexMB: number;
  maxTexture: number;
  exceeded: Array<{ metric: string; value: number; limit: number }>;
};

export function licenseFor(entry: LockEntry): LicenseEntry {
  return {
    id: entry.license,
    ...(entry.rights.attribution ? { attribution: entry.rights.attribution } : {}),
    use: entry.rights.audience === 'private' ? 'personal' : 'any',
  };
}

export function manifestAsset(
  item: BuildItem,
  file: ManifestAssetEntry['file'],
  extra: Pick<ManifestAssetEntry, 'mesh' | 'bounds'> = {},
): ManifestAssetEntry {
  return {
    file,
    ...extra,
    license: licenseFor(item.entry),
    ...(item.meta === undefined ? {} : { meta: item.meta }),
  };
}
