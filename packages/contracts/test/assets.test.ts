import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assetManifestSchema, assetMetadataSchema, assetsLockSchema, cachePlanSchema } from '../src/assets.js';
import { loadJson } from './helpers.js';
import { emittedValidator } from './json-schema.js';

type Manifest = { assets: Record<string, { file: Record<string, string> }> };

describe('assets contract', () => {
  it('carries the typed AI generation marker in lock and manifest metadata', () => {
    expect(assetMetadataSchema.parse({ generation: { method: 'ai', tool: 'Krea 2 Turbo + pixel-art LoRA' } })).toEqual({
      generation: { method: 'ai', tool: 'Krea 2 Turbo + pixel-art LoRA' },
    });
    expect(assetMetadataSchema.safeParse({ generation: { method: 'maybe-ai', tool: 'unknown' } }).success).toBe(false);
    expect(assetMetadataSchema.safeParse({ generation: { method: 'ai', tool: 'spoof\u200enext' } }).success).toBe(
      false,
    );
  });

  it('accepts the golden cache plan in both Zod and the emitted JSON Schema', () => {
    const doc = loadJson('fixtures/cache-plan.v1.json');
    expect(cachePlanSchema.safeParse(doc).success).toBe(true);
    expect(emittedValidator('cache-plan.v1')(doc)).toBe(true);
  });

  it('accepts the golden manifest in both Zod and the emitted JSON Schema', () => {
    const doc = loadJson('fixtures/assets.v1.json');
    expect(assetManifestSchema.safeParse(doc).success).toBe(true);
    expect(emittedValidator('assets.v1')(doc)).toBe(true);
  });

  it('rejects unknown card blocks under manifest metadata', () => {
    const doc = loadJson('fixtures/assets-negative/meta-unknown-key.v1.json');
    expect(assetManifestSchema.safeParse(doc).success).toBe(false);
    expect(emittedValidator('assets.v1')(doc)).toBe(false);
  });

  // `meta` blocks are the card's own sprite/rig/kit/geometry schema, so a malformed block fails even though
  // its key is allowed; adapters read sheet layout from it and must never get a half-shaped block.
  it('rejects a card block that breaks the card sub-schema', () => {
    const doc = loadJson<Manifest & { assets: Record<string, { meta?: unknown }> }>('fixtures/assets.v1.json');
    const asset = Object.values(doc.assets).find((entry) => entry.meta !== undefined)!;
    asset.meta = { sprite: { animations: [{ name: 'walk', frames: [0], sheets: [{ path: 'a.png', frame_w: '8' }] }] } };
    expect(assetManifestSchema.safeParse(doc).success).toBe(false);
    expect(emittedValidator('assets.v1')(doc)).toBe(false);
  });

  // A pre-meta manifest (`version: 1`, no `minor`, no `meta`) is still valid: the minor bump is additive.
  it('accepts a meta-less v1 manifest without a minor', () => {
    const doc = loadJson<Manifest & { minor?: number; assets: Record<string, { meta?: unknown }> }>(
      'fixtures/assets.v1.json',
    );
    delete doc.minor;
    for (const asset of Object.values(doc.assets)) delete asset.meta;
    expect(assetManifestSchema.safeParse(doc).success).toBe(true);
    expect(emittedValidator('assets.v1')(doc)).toBe(true);
  });

  // `meta` is copied into the public manifest, so it must not leak or point at files outside the asset.
  it.each(['/home/kevin/sheet.png', '~/sheet.png', '../sheet.png', 'sprites/../../sheet.png', 'C:\\sheet.png'])(
    'rejects the meta path %s',
    (path) => {
      const doc = loadJson<Manifest & { assets: Record<string, { meta?: unknown }> }>('fixtures/assets.v1.json');
      const asset = Object.values(doc.assets).find((entry) => entry.meta !== undefined)!;
      asset.meta = {
        sprite: {
          drawn_view: 'iso',
          animations: [{ name: 'walk', frames: [0], sheets: [{ path, frame_w: 8, frame_h: 8, cols: 1, rows: 1 }] }],
        },
      };
      expect(assetManifestSchema.safeParse(doc).success).toBe(false);
    },
  );

  // The loader never derives file names, so every tier entry must name a real file.
  it('rejects an asset tier that names a file missing from files, at that asset', () => {
    const doc = loadJson<Manifest>('fixtures/assets.v1.json');
    doc.assets['monsters/yeti']!.file.mobile = 'monster-yeti.mobile.missing.glb';
    expect(assetManifestSchema.safeParse(doc).error?.issues.map((issue) => issue.path)).toEqual([
      ['assets', 'monsters/yeti', 'file', 'mobile'],
    ]);
  });

  it('rejects an unknown tier', () => {
    const doc = loadJson<Manifest>('fixtures/assets.v1.json');
    doc.assets['castle/tower-base']!.file = { ultra: 'kit-castle.3f9a1c.glb' };
    expect(assetManifestSchema.safeParse(doc).success).toBe(false);
  });

  it('accepts the golden lockfile with the public and private tier-1 examples', () => {
    const doc = loadJson<{ assets: { id: string }[] }>('fixtures/assets-lock.v1.json');
    expect(assetsLockSchema.parse(doc).assets.map((asset) => asset.id.slice(0, 3))).toEqual(['t1:', 't1:']);
    expect(emittedValidator('assets-lock.v1')(doc)).toBe(true);
  });

  it('rejects a lock entry without a sha256 digest', () => {
    const doc = loadJson<{ assets: { sha256: string }[] }>('fixtures/assets-lock.v1.json');
    doc.assets[0]!.sha256 = 'abc';
    expect(assetsLockSchema.safeParse(doc).error?.issues[0]?.path).toEqual(['assets', 0, 'sha256']);
  });

  it('keeps the OGM-062 lockfile marker above the lock schema', () => {
    const source = readFileSync(new URL('../src/assets.ts', import.meta.url), 'utf8');
    const marker = source.indexOf('// ---- lockfile (OGM-062 edits below this line) ----');
    expect(marker).toBeGreaterThan(source.indexOf('export const assetManifestSchema'));
    expect(marker).toBeLessThan(source.indexOf('export const assetsLockSchema'));
  });
});
