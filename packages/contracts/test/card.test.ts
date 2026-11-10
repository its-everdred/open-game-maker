import { describe, expect, it } from 'vitest';

import { validateCard, validateLayoutSpec } from '../src/card.js';
import type { Sprite } from '../src/card.generated.js';
import { cardFixtureDocs, negativeFixture } from './helpers.js';

describe('card schemas', () => {
  it('accepts all 16 moved C3 fixtures', () => {
    for (const { file, doc } of cardFixtureDocs()) {
      const schema = (doc as { schema?: string }).schema;
      const result = schema?.startsWith('ogm.map-layout-spec') ? validateLayoutSpec(doc) : validateCard(doc);
      expect(result, file).toMatchObject({ ok: true });
    }
  });

  it('accepts 1.1 processing and rejects unknown processing modes', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'collection-kenney-mini-dungeon.json')?.doc,
    );
    expect(validateCard(card)).toMatchObject({ ok: true });

    (card as { rights: { processing: string } }).rights.processing = 'cloud';
    const result = validateCard(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('processing');
  });

  it('accepts a collection card compatibility set', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'collection-kenney-mini-dungeon.json')?.doc,
    ) as { describe: { set?: string } };
    card.describe.set = 'kenney-mini-3d';
    expect(validateCard(card)).toMatchObject({ ok: true });
  });

  it('accepts a typed AI generation marker and rejects free-form methods', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'collection-kenney-mini-dungeon.json')?.doc,
    ) as { schema: string; generation?: { method: string; tool: string } };
    card.schema = 'ogm.asset-card/1.2';
    card.generation = { method: 'ai', tool: 'Krea 2 Turbo + pixel-art LoRA' };
    expect(validateCard(card)).toMatchObject({ ok: true });

    card.generation.method = 'maybe-ai';
    const result = validateCard(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('generation');

    card.generation = { method: 'ai', tool: 'spoof\nnext line' };
    expect(validateCard(card)).toMatchObject({ ok: false });

    card.generation = { method: 'ai', tool: 'spoof\u061cnext' };
    expect(validateCard(card)).toMatchObject({ ok: false });
  });

  it('accepts a sprite facing set and rejects an unknown facing', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'sprite-kenney-tiny-dungeon-knight.json')?.doc,
    ) as { sprite: Sprite };
    card.sprite.directions = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    expect(validateCard(card)).toMatchObject({ ok: true });

    card.sprite.directions = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE', 'U'] as unknown as Sprite['directions'];
    const result = validateCard(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('directions');
  });

  it('accepts local specimen, diorama, loop, and vendor-store preview keys', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'collection-kenney-mini-dungeon.json')?.doc,
    ) as {
      previews: Record<string, string>;
      provenance: Record<string, Record<string, unknown>>;
    };
    card.previews = {
      specimen: 'packs/smallscaleint-knight/specimen.png',
      diorama: 'sets/smallscaleint/diorama.fantasy.256.png',
      loop: 'sets/smallscaleint/diorama.fantasy.256.gif',
      store: 'packs/smallscaleint-knight/store/fallback.gif',
    };
    card.provenance['previews.store'] = {
      by: 'vendor-metadata',
      at: '2026-11-01T12:00:00Z',
      input: 'packs/smallscaleint-knight/store/media.json',
    };
    expect(validateCard(card)).toMatchObject({ ok: true });

    card.previews.store = 'https://example.com/private?token=secret';
    expect(validateCard(card)).toMatchObject({ ok: false });
  });

  it('rejects preview traversal and untrusted vendor-store provenance', () => {
    const base = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'collection-kenney-mini-dungeon.json')?.doc,
    ) as {
      previews: Record<string, string>;
      provenance: Record<string, { by: string; at?: string }>;
    };
    base.previews = { store: 'packs/smallscaleint-knight/store/fallback.gif' };

    expect(validateCard(base)).toMatchObject({ ok: false });
    base.provenance['previews.store'] = { by: 'model', at: '2026-11-01T12:00:00Z' };
    expect(validateCard(base)).toMatchObject({ ok: false });
    base.provenance['previews.store'] = { by: 'vendor-metadata', at: '2026-11-01T12:00:00Z' };
    base.previews.store = 'packs/../../outside.png';
    expect(validateCard(base)).toMatchObject({ ok: false });
  });

  it('accepts deterministic sprite sources and rejects unsafe source paths', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'sprite-kenney-tiny-dungeon-knight.json')?.doc,
    ) as {
      describe: { world?: string };
      sprite: Record<string, unknown>;
    };
    card.describe.world = 'fantasy';
    card.sprite.animations = [
      {
        name: 'attack',
        frames: [0, 1],
        fps: 12,
        directions: ['E', 'N', 'S', 'W'],
        sheets: [
          {
            path: 'Spritesheets/Shadowless/Knight/Attack.png',
            variant: 'shadowless',
            frame_w: 64,
            frame_h: 64,
            cols: 2,
            rows: 4,
          },
        ],
        direction_files: {
          S: ['Knight/Attack/S/0.png', 'Knight/Attack/S/1.png'],
        },
      },
    ];
    card.sprite.facings = { E: 'Tiles/chest_E.png', N: 'Tiles/chest_N.png' };
    expect(validateCard(card)).toMatchObject({ ok: true });

    (card.sprite.animations as Array<{ frames: number[]; fps: number }>)[0]!.frames = [];
    (card.sprite.animations as Array<{ frames: number[]; fps: number }>)[0]!.fps = 0;
    expect(validateCard(card)).toMatchObject({ ok: true });

    const typoFacing: Sprite = {
      drawn_view: 'iso',
      facings: {
        // @ts-expect-error Direction maps reject misspelled keys at compile time.
        SOUTH: 'Tiles/chest_S.png',
      },
    };
    expect(typoFacing.facings).toBeDefined();

    (card.sprite.animations as Array<{ sheets: Array<{ path: string }> }>)[0]!.sheets[0]!.path = '../outside.png';
    const result = validateCard(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('path');
  });

  it('reports the invalid interpretation author', () => {
    const result = validateCard(negativeFixture('interpretation-not-admin.json').doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('set_by');
  });

  it('accepts the deterministic conversion flag used by asset intake', () => {
    const card = structuredClone(
      cardFixtureDocs().find(({ file }) => file === 'asset-wall.json')?.doc ??
        cardFixtureDocs().find(({ doc }) => (doc as { card_type?: string }).card_type === 'asset')?.doc,
    ) as Record<string, unknown>;
    delete card.geometry;
    card.flags = ['needs-conversion'];
    expect(validateCard(card)).toMatchObject({ ok: true });
  });
});
