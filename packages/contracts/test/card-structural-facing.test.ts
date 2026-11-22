import { expect, it } from 'vitest';

import { assetMetadataSchema } from '../src/assets.js';
import { validateCard } from '../src/card.js';
import { cardFixtureDocs } from './helpers.js';

it('accepts measured per-facing geometry and rejects facts without evidence or unknown facings', () => {
  const card = structuredClone(
    cardFixtureDocs().find(({ file }) => file === 'sprite-kenney-tiny-dungeon-knight.json')!.doc,
  ) as { sprite: Record<string, unknown> };
  card.sprite.structural_facings = {
    W: {
      alpha_bounds: { value: [46, 67, 127, 215], verified: 'alpha scan' },
      edges: { value: ['yMin'], verified: 'measured against grid' },
      sockets: [{ kind: 'end', position: [64, 208], verified: 'adjacent run' }],
    },
  };
  expect(validateCard(card)).toMatchObject({ ok: true });
  card.sprite.structural_facings = { W: { anchor: { value: [64, 208] } } };
  expect(validateCard(card)).toMatchObject({ ok: false });
  card.sprite.structural_facings = { UP: { edges: { value: ['yMin'], verified: 'measured' } } };
  expect(validateCard(card)).toMatchObject({ ok: false });
});

it('preserves facing facts in the asset metadata consumed by adapters', () => {
  const sprite = {
    drawn_view: 'iso',
    structural_facings: { W: { edges: { value: ['yMin'], verified: 'measured against grid' } } },
  };
  expect(assetMetadataSchema.parse({ sprite })).toEqual({ sprite });
  expect(
    assetMetadataSchema.safeParse({
      sprite: { drawn_view: 'iso', structural_facings: { W: { edges: { value: ['yMin'] } } } },
    }).success,
  ).toBe(false);
});

it('carries structural facts through the emitted asset manifest schema', async () => {
  const { assetManifestSchema } = await import('../src/assets.js');
  const { loadJson } = await import('./helpers.js');
  const { emittedValidator } = await import('./json-schema.js');
  const manifest = loadJson<{ assets: Record<string, { meta?: unknown }> }>('fixtures/assets.v1.json');
  const asset = Object.values(manifest.assets).find((entry) => entry.meta !== undefined)!;
  asset.meta = {
    sprite: { drawn_view: 'iso', structural_facings: { W: { edges: { value: ['yMin'], verified: 'measured' } } } },
  };
  expect(assetManifestSchema.safeParse(manifest).success).toBe(true);
  expect(emittedValidator('assets.v1')(manifest)).toBe(true);
});
