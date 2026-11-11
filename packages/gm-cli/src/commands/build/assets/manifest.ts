import { join } from 'node:path';

import {
  ASSETS_SCHEMA_MINOR,
  assetManifestSchema,
  cachePlanSchema,
  type AssetManifest,
  type CacheEntryKind,
  type CachePlan,
  type LoadPhase,
  type Tier,
} from '@ogm/contracts';

import { stableJson, writeIfChanged } from './files.js';
import type { BuiltFileInfo, CompletedJob, ManifestAssetEntry } from './types.js';

const ASSET_URL = '/a/';

function assetUrl(name: string): string {
  return `${ASSET_URL}${name}`;
}

function phaseFor(kind: CacheEntryKind): LoadPhase {
  return kind === 'music' || kind === 'voice' ? 'stream' : 'ready';
}

function emptyPhaseTotals(): CachePlan['totals']['desktop'] {
  return {
    boot: { bytes: 0, files: 0 },
    ready: { bytes: 0, files: 0 },
    stream: { bytes: 0, files: 0 },
  };
}

function pickKind(kinds: Set<CacheEntryKind>): CacheEntryKind {
  const sorted = [...kinds].sort();
  const ready = sorted.find((kind) => phaseFor(kind) === 'ready');
  return ready ?? sorted[0]!;
}

export function assembleManifest(
  tiers: Tier[],
  completed: CompletedJob[],
  expectedIds: string[],
): { manifest: AssetManifest; cachePlan: CachePlan; details: Record<string, BuiltFileInfo> } {
  const details: Record<string, BuiltFileInfo> = {};
  const assets: Record<string, ManifestAssetEntry> = {};
  const kinds = new Map<string, Set<CacheEntryKind>>();
  /* A sprite card's extra sheets are reached through its rewritten meta paths, not its `file` tiers. */
  const companionIds = new Map<string, Set<string>>();
  for (const { job, result } of completed) {
    for (const [name, file] of Object.entries(result.files)) {
      if (details[name] && stableJson(details[name]) !== stableJson(file)) {
        throw new Error(`generated file name collision: ${name}`);
      }
      details[name] = file;
      const fileKinds = kinds.get(name) ?? new Set<CacheEntryKind>();
      fileKinds.add(job.cacheKind);
      kinds.set(name, fileKinds);
    }
    for (const [id, names] of Object.entries(result.companions ?? {})) {
      for (const name of names) {
        if (!details[name]) throw new Error(`asset ${id} references missing generated file ${name}`);
        const url = assetUrl(name);
        const holders = companionIds.get(url) ?? new Set<string>();
        holders.add(id);
        companionIds.set(url, holders);
      }
    }
    for (const [id, asset] of Object.entries(result.assets)) {
      if (assets[id]) throw new Error(`asset built more than once: ${id}`);
      const item = job.items.find((candidate) => candidate.entry.id === id);
      assets[id] = { ...asset, phase: item?.entry.phase ?? 'boot' };
    }
  }
  for (const id of expectedIds) {
    const asset = assets[id];
    if (!asset) throw new Error(`asset was not built: ${id}`);
    for (const tier of tiers) {
      const name = asset.file[tier] ?? asset.file['*'];
      if (!name) throw new Error(`asset ${id} has no file for ${tier}`);
      if (!details[name]) throw new Error(`asset ${id} references missing generated file ${name}`);
    }
  }
  const files = Object.fromEntries(
    Object.entries(details)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, file]) => [
        assetUrl(name),
        {
          bytes: file.bytes,
          ...(file.tris === undefined ? {} : { tris: file.tris }),
          ...(file.gpuTexMB === undefined ? {} : { gpuTexMB: file.gpuTexMB }),
          decoders: file.decoders,
        },
      ]),
  );
  const publicAssets = Object.fromEntries(
    Object.entries(assets)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, asset]) => [
        id,
        {
          ...asset,
          file: Object.fromEntries(
            Object.entries(asset.file).map(([tier, name]) => [tier, name === undefined ? undefined : assetUrl(name)]),
          ),
        },
      ]),
  );
  const manifest = assetManifestSchema.parse({
    version: 1,
    minor: ASSETS_SCHEMA_MINOR,
    tiers,
    files,
    assets: publicAssets,
  });

  const usage = new Map<string, { tiers: Set<Tier | '*'>; ids: Set<string> }>();
  for (const [id, asset] of Object.entries(manifest.assets)) {
    for (const [tier, url] of Object.entries(asset.file)) {
      if (url === undefined) continue;
      const current = usage.get(url) ?? { tiers: new Set<Tier | '*'>(), ids: new Set<string>() };
      current.tiers.add(tier as Tier | '*');
      current.ids.add(id);
      usage.set(url, current);
    }
  }
  for (const [url, ids] of companionIds) {
    const current = usage.get(url);
    /* A companion is required on every tier, even if it also serves as a tier-specific primary. */
    if (current) {
      current.tiers.add('*');
      for (const id of ids) current.ids.add(id);
    } else usage.set(url, { tiers: new Set<Tier | '*'>(['*']), ids: new Set(ids) });
  }
  const entries = Object.entries(details)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, file]) => {
      const match = /^([0-9a-f]{64})\.[a-z0-9]+$/.exec(name);
      if (!match) throw new Error(`generated file is not content-addressed: ${name}`);
      const url = assetUrl(name);
      const fileUsage = usage.get(url);
      const fileKinds = kinds.get(name);
      if (!fileUsage || !fileKinds) throw new Error(`cache plan is missing generated file metadata: ${name}`);
      const kind = pickKind(fileKinds);
      const entryTiers: Array<Tier | '*'> = fileUsage.tiers.has('*')
        ? ['*']
        : tiers.filter((tier) => fileUsage.tiers.has(tier));
      return {
        sha256: match[1]!,
        url,
        bytes: file.bytes,
        kind,
        phase: phaseFor(kind),
        tiers: entryTiers,
        ids: [...fileUsage.ids].sort(),
        assetPhasesByTier: Object.fromEntries(
          tiers.map((tier) => [
            tier,
            [
              ...new Set(
                [...fileUsage.ids]
                  .filter((id) => {
                    const asset = manifest.assets[id];
                    return asset && ((asset.file[tier] ?? asset.file['*']) === url || companionIds.get(url)?.has(id));
                  })
                  .map((id) => manifest.assets[id]?.phase ?? 'boot'),
              ),
            ].sort(),
          ]),
        ),
      };
    });
  const totals: CachePlan['totals'] = {
    desktop: emptyPhaseTotals(),
    mobile: emptyPhaseTotals(),
    low: emptyPhaseTotals(),
  };
  for (const entry of entries) {
    for (const tier of tiers) {
      if (!entry.tiers.includes('*') && !entry.tiers.includes(tier)) continue;
      totals[tier][entry.phase].bytes += entry.bytes;
      totals[tier][entry.phase].files += 1;
    }
  }
  const cachePlan = cachePlanSchema.parse({
    version: 1,
    gameId: '',
    buildId: '',
    built: new Date().toISOString(),
    sdkVersion: '',
    tiers,
    entries,
    totals,
  });
  return {
    manifest,
    cachePlan,
    details: Object.fromEntries(Object.entries(details).map(([name, file]) => [assetUrl(name), file])),
  };
}

export async function writeManifest(
  cwd: string,
  manifestDir: string,
  manifest: AssetManifest,
  cachePlan: CachePlan,
): Promise<void> {
  await writeIfChanged(join(manifestDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, cwd);
  await writeIfChanged(join(manifestDir, 'cache-plan.json'), `${JSON.stringify(cachePlan, null, 2)}\n`, cwd);
}
