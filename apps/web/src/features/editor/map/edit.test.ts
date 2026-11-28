import type { SceneDoc, ScenePackAdapter } from '@ogm/contracts/browser';
import { describe, expect, it } from 'vitest';

import { duplicate, erase, historyOf, move, paint, record, redo, rotate, tileLayersFrontToBack, undo } from './edit';

const adapter: ScenePackAdapter = {
  id: 'test',
  facings: (asset) => (asset === 'rock' ? ['E'] : ['E', 'N', 'W', 'S']),
  placement: () => 'cell',
  snap: (point) => point,
  brushes: () => [],
};

function scene(): SceneDoc {
  return {
    schemaVersion: 1,
    game: 'dusk-helm',
    scene: 'goblin-cave',
    packAdapter: 'test',
    bounds: { width: 3, height: 3 },
    layers: {
      floor: { kind: 'tiles', order: 0, tiles: { '0,0': { asset: 'ground', facing: 'E' } } },
      decor: { kind: 'tiles', order: 2, tiles: { '1,1': { asset: 'chest', facing: 'E', lockedBy: 'creator' } } },
      spawns: { kind: 'objects', order: 4 },
    },
    objects: {},
    hd2d: {},
  };
}

describe('map edits', () => {
  it('paints in the first facing the pack drew, and leaves the document alone when nothing changes', () => {
    const doc = scene();
    const painted = paint(doc, adapter, 'floor', { x: 2, y: 2 }, 'ground');
    expect(painted.layers.floor!.tiles!['2,2']).toEqual({ asset: 'ground', facing: 'E' });
    // Same piece again: no new history step, so undo never lands on an identical map.
    expect(paint(painted, adapter, 'floor', { x: 2, y: 2 }, 'ground')).toBe(painted);
    expect(doc.layers.floor!.tiles!['2,2']).toBeUndefined();
  });

  it('refuses cells outside the map, which the game could not load', () => {
    const doc = scene();
    expect(paint(doc, adapter, 'floor', { x: 3, y: 0 }, 'ground')).toBe(doc);
    expect(move(doc, adapter, { layer: 'decor', cell: '1,1' }, { x: -1, y: 1 })).toBe(doc);
  });

  it('moves a piece only onto a free cell, so a drag never swallows another piece', () => {
    const doc = paint(scene(), adapter, 'decor', { x: 2, y: 1 }, 'rock');
    expect(move(doc, adapter, { layer: 'decor', cell: '1,1' }, { x: 2, y: 1 })).toBe(doc);
    const moved = move(doc, adapter, { layer: 'decor', cell: '1,1' }, { x: 0, y: 2 });
    expect(moved.layers.decor!.tiles!['1,1']).toBeUndefined();
    expect(moved.layers.decor!.tiles!['0,2']).toEqual({ asset: 'chest', facing: 'E' });
  });

  it('turns through the drawn facings only', () => {
    let doc = scene();
    const chest = { layer: 'decor', cell: '1,1' };
    const seen = [];
    for (let turn = 0; turn < 4; turn++) {
      doc = rotate(doc, adapter, chest);
      seen.push(doc.layers.decor!.tiles!['1,1']!.facing);
    }
    expect(seen).toEqual(['N', 'W', 'S', 'E']);
    // A rock drawn in one facing has no other picture to turn to.
    const rock = paint(scene(), adapter, 'decor', { x: 0, y: 0 }, 'rock');
    expect(rotate(rock, adapter, { layer: 'decor', cell: '0,0' })).toBe(rock);
  });

  it('erases and duplicates beside the original', () => {
    const doc = scene();
    expect(erase(doc, adapter, { layer: 'decor', cell: '1,1' }).layers.decor!.tiles).toEqual({});
    const copy = duplicate(doc, adapter, { layer: 'decor', cell: '1,1' });
    expect(copy.ref).toEqual({ layer: 'decor', cell: '0,0' });
    expect(copy.doc.layers.decor!.tiles!['0,0']).toEqual({ asset: 'chest', facing: 'E' });
  });

  it('duplicates a scaled post with its metadata but without the creator lock', () => {
    const doc = scene();
    doc.layers.decor!.tiles!['1,1'] = {
      asset: 'pillar',
      facing: 'E',
      elevation: 1,
      props: { scale: 0.4, role: 'post' },
      lockedBy: 'creator',
    };
    const copy = duplicate(doc, adapter, { layer: 'decor', cell: '1,1' });
    expect(copy.doc.layers.decor!.tiles!['0,0']).toEqual({
      asset: 'pillar',
      facing: 'E',
      elevation: 1,
      props: { scale: 0.4, role: 'post' },
    });
    expect(doc.layers.decor!.tiles!['1,1']!.lockedBy).toBe('creator');
  });

  it('lets the pack re-pick joined pieces around every changed cell, and keeps its picks', () => {
    const calls: string[][] = [];
    // A fence pack turns the piece beside a changed cell to join it, as the autotile rules will.
    const joining: ScenePackAdapter = {
      ...adapter,
      autotile: (doc, layer, cells) => {
        calls.push([...cells]);
        const tiles = { ...doc.layers[layer]!.tiles };
        if (tiles['1,1']) tiles['1,1'] = { ...tiles['1,1'], facing: 'S' };
        return { layers: { ...doc.layers, [layer]: { ...doc.layers[layer]!, tiles } }, objects: doc.objects };
      },
    };
    const painted = paint(scene(), joining, 'decor', { x: 2, y: 2 }, 'fence');
    expect(painted.layers.decor!.tiles!['1,1']!.facing).toBe('S');
    const moved = move(painted, joining, { layer: 'decor', cell: '2,2' }, { x: 0, y: 1 });
    expect(moved.layers.decor!.tiles!['0,1']).toEqual({ asset: 'fence', facing: 'E' });
    expect(calls).toEqual([['2,2'], ['2,2', '0,1']]);
  });

  it('picks from the front layer first', () => {
    expect(tileLayersFrontToBack(scene())).toEqual(['decor', 'floor']);
  });
});

describe('history', () => {
  it('undoes and redoes whole steps and drops the redo branch on a new edit', () => {
    const a = scene();
    const b = paint(a, adapter, 'floor', { x: 1, y: 0 }, 'ground');
    const c = paint(b, adapter, 'floor', { x: 2, y: 0 }, 'ground');
    let history = record(record(historyOf(a), b), c);
    history = undo(undo(history));
    expect(history.present).toBe(a);
    history = redo(history);
    expect(history.present).toBe(b);
    history = record(history, paint(b, adapter, 'floor', { x: 0, y: 1 }, 'ground'));
    expect(redo(history)).toBe(history);
    expect(undo(historyOf(a))).toEqual(historyOf(a));
  });
});
