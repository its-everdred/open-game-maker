import { describe, expect, it } from 'vitest';

import { budgetReport } from '../src/commands/build/assets/budget.js';
import { assembleManifest } from '../src/commands/build/assets/manifest.js';

// A game with a full scene (characters, clips, sounds, scenery) needs more than 30 small files;
// the byte cap, not the count, keeps a mobile download small.
function game(count: number) {
  const assets: Record<string, { file: Record<string, string> }> = {};
  const details: Record<string, { bytes: number }> = {};
  for (let i = 0; i < count; i++) {
    assets[`a${i}`] = { file: { '*': `f${i}.bin` } };
    details[`f${i}.bin`] = { bytes: 10_000 };
  }
  return { manifest: { assets } as never, details: details as never };
}

describe('mobile file-count budget', () => {
  it('keeps a companion on every tier when it shares a primary digest', () => {
    const shared = `${'d'.repeat(64)}.glb`;
    const other = `${'e'.repeat(64)}.glb`;
    const file = { bytes: 10, decoders: [] };
    const license = { id: 'CC0-1.0', use: 'any' };
    const jobs = [
      {
        job: {
          cacheKind: 'model',
          items: [{ entry: { id: 'boot' } }, { entry: { id: 'lazy', phase: 'lazy:backdrop-nim' } }],
        },
        result: {
          files: { [shared]: file, [other]: file },
          assets: {
            boot: { file: { desktop: shared, mobile: other }, license },
            lazy: { file: { '*': other }, license },
          },
          companions: { lazy: [shared] },
        },
      },
    ] as never;
    const { cachePlan } = assembleManifest(['desktop', 'mobile'], jobs, ['boot', 'lazy']);
    const entry = cachePlan.entries.find((item) => item.url.endsWith(shared))!;
    expect(entry.tiers).toEqual(['*']);
    expect(entry.assetPhasesByTier?.mobile).toEqual(['lazy:backdrop-nim']);
  });
  it('attributes a shared digest to the owning phase for each tier', () => {
    const shared = `${'a'.repeat(64)}.glb`;
    const bootMobile = `${'b'.repeat(64)}.glb`;
    const lazyDesktop = `${'c'.repeat(64)}.glb`;
    const file = { bytes: 10, decoders: [] };
    const license = { id: 'CC0-1.0', use: 'any' };
    const jobs = [
      {
        job: {
          cacheKind: 'model',
          items: [{ entry: { id: 'boot' } }, { entry: { id: 'lazy', phase: 'lazy:backdrop-nim' } }],
        },
        result: {
          files: { [shared]: file, [bootMobile]: file, [lazyDesktop]: file },
          assets: {
            boot: { file: { desktop: shared, mobile: bootMobile }, license },
            lazy: { file: { desktop: lazyDesktop, mobile: shared }, license },
          },
        },
      },
    ] as never;
    const { manifest, cachePlan, details } = assembleManifest(['desktop', 'mobile'], jobs, ['boot', 'lazy']);
    const entry = cachePlan.entries.find((item) => item.url.endsWith(shared))!;
    expect(entry.assetPhasesByTier).toEqual({ desktop: ['boot'], mobile: ['lazy:backdrop-nim'] });
    expect(budgetReport(manifest, details, 'mobile', 'boot', 100, cachePlan).bytes).toBe(10);
    expect(budgetReport(manifest, details, 'mobile', 'lazy:backdrop-nim', 100, cachePlan).bytes).toBe(10);
  });
  it('counts shared files and companion files once in each owning phase', () => {
    const manifest = {
      assets: {
        boot: { file: { '*': '/a/shared' } },
        lazy: { phase: 'lazy:backdrop-nim', file: { '*': '/a/shared' } },
      },
    } as never;
    const details = { '/a/shared': { bytes: 10 }, '/a/sheet': { bytes: 20 } } as never;
    const plan = {
      entries: [
        { url: '/a/shared', tiers: ['*'], assetPhasesByTier: { mobile: ['boot', 'lazy:backdrop-nim'] } },
        { url: '/a/sheet', tiers: ['*'], assetPhasesByTier: { mobile: ['lazy:backdrop-nim'] } },
      ],
    } as never;
    expect(budgetReport(manifest, details, 'mobile', 'boot', 100, plan).bytes).toBe(10);
    expect(budgetReport(manifest, details, 'mobile', 'lazy:backdrop-nim', 25, plan)).toMatchObject({
      bytes: 30,
      exceeded: [{ metric: 'bytes', value: 30, limit: 25 }],
    });
  });
  it('lets a 31-file game with a scenery bundle pass', () => {
    const { manifest, details } = game(31);
    expect(budgetReport(manifest, details, 'mobile' as never).exceeded).toEqual([]);
  });

  it('still flags a game past 48 files', () => {
    const { manifest, details } = game(49);
    expect(budgetReport(manifest, details, 'mobile' as never).exceeded).toEqual([
      { metric: 'files', value: 49, limit: 48 },
    ]);
  });
});
