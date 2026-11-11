import type { AssetManifest, CachePlan, Tier } from '@ogm/contracts';

import type { AssetBudgetReport, BuiltFileInfo } from './types.js';

const LIMITS = {
  bytes: 2 * 1024 * 1024,
  // A file count only matters as request overhead; the 2 MiB byte cap is the real mobile limit (raised for Blobs' scenery, 2026-11-09).
  files: 48,
  tris: 300_000,
  gpuTexMB: 100,
  maxTexture: 1_024,
} as const;

export function budgetReport(
  manifest: AssetManifest,
  details: Record<string, BuiltFileInfo>,
  tier: Tier,
  phase = 'boot',
  byteLimit = LIMITS.bytes,
  plan?: CachePlan,
): AssetBudgetReport {
  const names = new Set<string>();
  for (const asset of Object.values(manifest.assets)) {
    if ((asset.phase ?? 'boot') !== phase) continue;
    const name = asset.file[tier] ?? asset.file['*'];
    if (name) names.add(name);
  }
  for (const entry of plan?.entries ?? []) {
    if (
      (entry.assetPhasesByTier?.[tier]?.includes(phase) ?? phase === 'boot') &&
      (entry.tiers.includes('*') || entry.tiers.includes(tier))
    )
      names.add(entry.url);
  }
  let bytes = 0;
  let tris = 0;
  let gpuTexMB = 0;
  let maxTexture = 0;
  for (const name of names) {
    const file = details[name];
    if (!file) throw new Error(`budget references unknown file ${name}`);
    bytes += file.bytes;
    tris += file.tris ?? 0;
    gpuTexMB += file.gpuTexMB ?? 0;
    maxTexture = Math.max(maxTexture, file.maxTexture ?? 0);
  }
  const values = { bytes, files: names.size, tris, gpuTexMB, maxTexture };
  const limits = { ...LIMITS, bytes: byteLimit };
  const exceeded = (Object.keys(limits) as Array<keyof typeof LIMITS>)
    .filter((metric) => values[metric] > limits[metric])
    .map((metric) => ({ metric, value: values[metric], limit: limits[metric] }));
  return { tier, phase, ...values, exceeded };
}
