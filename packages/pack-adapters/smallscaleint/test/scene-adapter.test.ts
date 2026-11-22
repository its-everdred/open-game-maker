import { SceneDocSchema, type AssetCard } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { IsoMap, sceneToIsoMap, smallScaleIntSceneAdapter } from '../src/index.js';

function card(id: string, title: string, facings: readonly string[] = ['E', 'N', 'S', 'W']): AssetCard {
  return {
    schema: 'ogm.asset-card/1.1',
    vocab: '2026-11-01',
    id,
    card_type: 'asset',
    status: 'measured',
    title,
    kind: 'sprite',
    subkind: 'tile',
    provenance: {},
    sprite: {
      drawn_view: 'iso',
      tile: { layer: 'decor' },
      facings: Object.fromEntries(facings.map((facing) => [facing, `${id}_${facing}.png`])),
    },
  };
}

const cards = [
  card('t1:ssi/ground-h1@1', 'Ground H1'),
  card('t1:ssi/wall-a1@1', 'Wall A1'),
  card('t1:ssi/door-b2@1', 'Door B2'),
  card('t1:ssi/roof-a1@1', 'Roof A1'),
  card('t1:ssi/chest-a1@1', 'Chest A1'),
  card('t3:game/asset-tmp/rock-wall', 'Cave Wall', ['E']),
];

describe('smallScaleIntSceneAdapter', () => {
  const adapter = smallScaleIntSceneAdapter(cards);

  it('offers only the facings an asset was drawn in', () => {
    // A game-made wall drawn once must not be offered N/W/S: the map would ask for images that do not exist.
    expect(adapter.facings('t3:game/asset-tmp/rock-wall')).toEqual(['E']);
    expect(adapter.facings('t1:ssi/chest-a1@1')).toEqual(['E', 'N', 'W', 'S']);
    expect(adapter.facings('t1:ssi/unknown-tile@1')).toEqual(['E', 'N', 'W', 'S']);
    expect(adapter.facings('spawn')).toEqual([]);
  });

  it('places walls and doors on edges, other pieces on cells and spawns anywhere', () => {
    expect(adapter.placement('t1:ssi/wall-a1@1')).toBe('edge');
    expect(adapter.placement('t1:ssi/door-b2@1')).toBe('edge');
    // The card title, not just the id, decides: this id has no category word in it.
    expect(adapter.placement('t3:game/asset-tmp/rock-wall')).toBe('edge');
    expect(adapter.placement('t1:ssi/chest-a1@1')).toBe('cell');
    expect(adapter.placement('spawn')).toBe('free');
  });

  it('snaps to cells, to the nearest cell edge midpoint, or not at all', () => {
    expect(adapter.snap({ x: 2.4, y: 3.6 }, 'cell')).toEqual({ x: 2, y: 4 });
    expect(adapter.snap({ x: 2.1, y: 3.6 }, 'edge')).toEqual({ x: 2, y: 3.5 });
    expect(adapter.snap({ x: 2.6, y: 3.1 }, 'edge')).toEqual({ x: 2.5, y: 3 });
    expect(adapter.snap({ x: 2.6, y: 3.1 }, 'free')).toEqual({ x: 2.6, y: 3.1 });
  });

  it('puts each asset on its default layer and has a brush per category, ground and roof included', () => {
    expect(adapter.layerFor('t1:ssi/ground-h1@1')).toBe('floor');
    expect(adapter.layerFor('t1:ssi/door-b2@1')).toBe('wall');
    expect(adapter.layerFor('t1:ssi/roof-a1@1')).toBe('roof');
    expect(adapter.layerFor('t1:ssi/chest-a1@1')).toBe('decor');
    expect(adapter.brushes()).toEqual([
      { id: 'ground', label: 'Ground', layer: 'floor', assets: ['t1:ssi/ground-h1@1'] },
      { id: 'wall', label: 'Wall', layer: 'wall', assets: ['t1:ssi/wall-a1@1'] },
      { id: 'door', label: 'Door', layer: 'wall', assets: ['t1:ssi/door-b2@1'] },
      { id: 'roof', label: 'Roof', layer: 'roof', assets: ['t1:ssi/roof-a1@1'] },
      { id: 'chest', label: 'Chest', layer: 'decor', assets: ['t1:ssi/chest-a1@1'] },
    ]);
  });

  it('starts an empty scene the game can load, and keeps fixed facings until autotile rules land', () => {
    const doc = adapter.emptyScene('dusk-helm', 'study', { width: 3, height: 2 });
    doc.layers.floor!.tiles!['0,0'] = { asset: 't1:ssi/ground-h1@1', facing: 'E' };
    doc.layers.wall!.tiles!['1,0'] = { asset: 't1:ssi/wall-a1@1', facing: 'S' };

    expect(SceneDocSchema.safeParse(doc).success).toBe(true);
    expect(new IsoMap(sceneToIsoMap(doc)).pieces().map((piece) => piece.key)).toEqual(['floor:0,0', 'wall:1,0']);
    expect(adapter.autotile!(doc, 'wall', ['1,0'])).toEqual({ layers: doc.layers, objects: doc.objects });
  });
});
