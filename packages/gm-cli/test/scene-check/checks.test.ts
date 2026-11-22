import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { occupiedShare } from '../../src/scene-check/framing.js';
import { readTiledScene } from '../../src/scene-check/read.js';
import { checkScene, type CheckOptions } from '../../src/scene-check/report.js';
import type { Scene } from '../../src/scene-check/model.js';
import { camera, pack, scene, tiled, without, yard, type Fixture } from './fixture.js';

const options: CheckOptions = { camera, minDensity: 1, allow: [] };
const ids = (s: Scene, extra: Partial<CheckOptions> = {}) =>
  checkScene('fixture', s, { ...options, ...extra }).findings.map((finding) => finding.id);
const at = (x: number, y: number, layer: string) => (piece: { x: number; y: number; layer: string }) =>
  piece.x === x && piece.y === y && piece.layer === layer;

function turn(fixture: Fixture, x: number, y: number, layer: string, facing: 'E' | 'N' | 'W' | 'S'): Fixture {
  return { ...fixture, pieces: fixture.pieces.map((p) => (at(x, y, layer)(p) ? { ...p, facing } : p)) };
}

describe('the clean yard', () => {
  it('passes every check, so each failure below is caused only by the defect it adds', () => {
    const report = checkScene('yard', scene(yard()), options);
    // Only the honest note that the flowers' on-screen overlap went unmeasured.
    expect(report.findings.map((f) => f.id)).toEqual(['facts/unmeasured-alpha']);
    expect(report.pass).toBe(true);
  });
});

describe('connected-runs', () => {
  it('fails a fence piece turned to stand apart: Kevin rejected the churchyard because its fence pieces stood apart', () => {
    // Facing N draws the x-max edge of (3,1), not its y-min edge, so the back fence breaks at that piece.
    const report = checkScene('yard', scene(turn(yard(), 3, 1, 'wall', 'N')), options);
    const open = report.findings.filter((f) => f.id === 'connected-runs/open-end');
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((f) => f.severity === 'high')).toBe(true);
    expect(report.pass).toBe(false);
  });

  it('fails an undeclared gap, but not the posted gate: only declared gates may break a run', () => {
    expect(ids(scene(without(yard(), at(8, 1, 'wall'))))).toContain('connected-runs/gap');
    // A lone turned piece has two open ends one edge apart; that is a stray piece, not a gap.
    const stray = yard();
    stray.pieces.push({ layer: 'wall', x: 8, y: 6, asset: 'pack:fence', facing: 'W', solid: true });
    expect(ids(scene(stray))).toContain('connected-runs/open-end');
    expect(ids(scene(stray))).not.toContain('connected-runs/gap');
    const unposted = without(yard(), (p) => p.asset === 'pack:post');
    expect(ids(scene(unposted))).toContain('connected-runs/open-end');
  });
});

describe('coherent-buildings', () => {
  it('fails a free-standing facade: the #24 crypt was one wall with an arch, no shell', () => {
    const facade = without(yard(), (p) => p.asset === 'pack:wall' && p.y === 3);
    expect(ids(scene(facade))).toContain('coherent-buildings/open-shell');
  });

  it('accepts the same open shell when it is tagged a ruin', () => {
    const ruin = without(yard(), (p) => p.asset === 'pack:wall' && p.y === 3);
    ruin.pieces = ruin.pieces.map((p) => (p.asset === 'pack:door' ? { ...p, tags: 'ruin' } : p));
    expect(ids(scene(ruin)).filter((id) => id.startsWith('coherent-buildings'))).toEqual([]);
  });

  it('accepts a door with no measured edge closing its shell: #24 crypt doors are unmeasured crops', () => {
    const fixture = yard();
    fixture.pieces = fixture.pieces.map((p) => (p.asset === 'pack:door' ? { ...p, asset: 'pack:plain-door' } : p));
    expect(ids(scene(fixture)).filter((id) => id.startsWith('coherent-buildings'))).toEqual([]);
  });

  it('fails a roof that leaves its footprint open: a roof must cover the whole building', () => {
    expect(ids(scene(without(yard(), at(4, 4, 'roof'))))).toContain('coherent-buildings/roof-gap');
    expect(ids(scene(without(yard(), (p) => p.layer === 'roof')))).toContain('coherent-buildings/no-roof');
  });
});

describe('no-overlap', () => {
  it('fails two props on one cell: props stacked on one footprint read as clutter, not placement', () => {
    const stacked = yard();
    stacked.pieces.push({ layer: 'decor2', x: 2, y: 2, asset: 'pack:stone', solid: false });
    expect(ids(scene(stacked))).toContain('no-overlap/shared-cell');
  });

  it('fails sprites that interpenetrate on screen in one depth band', () => {
    const crowded = without(yard(), (p) => p.x === 7 && p.y === 2 && p.layer === 'decor');
    crowded.pieces.push({ layer: 'decor', x: 7, y: 2, asset: 'pack:bush', solid: false });
    crowded.pieces.push({ layer: 'decor2', x: 6, y: 3, asset: 'pack:bush', solid: false });
    crowded.pieces = crowded.pieces.filter((p) => !(p.x === 6 && p.y === 3 && p.asset === 'pack:flower'));
    expect(ids(scene(crowded))).toContain('no-overlap/interpenetrate');
  });

  it('fails a character standing inside a solid', () => {
    const fixture = yard();
    fixture.spawns[1] = { name: 'guard', x: 3, y: 3 };
    expect(ids(scene(fixture))).toContain('no-overlap/actor-in-solid');
  });
});

describe('facing', () => {
  it('fails a facing the asset does not ship', () => {
    const lock = { 'pack:flower': { meta: { sprite: { facings: { S: 'flower.png' } } } } };
    expect(ids(scene(yard(), lock))).toContain('facing/unshipped');
  });

  it('names the facing that joins a fence piece turned across its run', () => {
    const report = checkScene('yard', scene(turn(yard(), 3, 1, 'wall', 'N')), options);
    const across = report.findings.find((f) => f.id === 'facing/across-run');
    expect(across?.message).toContain('facing W joins its neighbours');
  });

  it('fails a door that opens onto no walkable cell', () => {
    const blocked = yard();
    blocked.pieces.push({ layer: 'decor', x: 3, y: 5, asset: 'pack:rock', solid: true });
    expect(ids(scene(blocked))).toContain('facing/door-blocked');
  });
});

describe('traversable', () => {
  it('fails a character the spawn cannot reach', () => {
    const fixture = yard();
    fixture.spawns.push({ name: 'merchant', x: 8, y: 6 });
    for (const [x, y] of [
      [7, 6],
      [9, 6],
      [8, 5],
      [8, 7],
    ] as const) {
      fixture.pieces.push({ layer: 'decor2', x, y, asset: 'pack:rock', solid: true });
    }
    const findings = checkScene('yard', scene(fixture), options).findings;
    expect(findings.some((f) => f.id === 'traversable/unreachable' && f.message.startsWith('merchant'))).toBe(true);
  });

  it('fails a path that leads nowhere: paths must connect what they claim to', () => {
    const fixture = yard();
    fixture.pieces = fixture.pieces.map((p) =>
      p.layer === 'floor' && p.x === 9 && p.y === 2 ? { ...p, asset: 'pack:paving' } : p,
    );
    expect(ids(scene(fixture))).toContain('traversable/dead-path');
  });
});

describe('natural-placement', () => {
  it('fails a scene too sparse to read as a place: the town hub was ~15 props on 1600 cells', () => {
    expect(ids(scene(without(yard(), (p) => p.asset === 'pack:flower')))).toContain('natural-placement/sparse');
  });

  it('fails props stamped on a regular grid unless tagged formal', () => {
    const planted = without(yard(), (p) => p.asset === 'pack:flower');
    for (const x of [0, 3, 6, 9])
      for (const y of [0, 11]) planted.pieces.push({ layer: 'decor', x, y, asset: 'pack:tree' });
    expect(ids(scene(planted))).toContain('natural-placement/grid');
    planted.pieces = planted.pieces.map((p) => (p.asset === 'pack:tree' ? { ...p, tags: 'formal' } : p));
    expect(ids(scene(planted))).not.toContain('natural-placement/grid');
  });

  it('fails a prop over the void and the map edge inside the frame: #40 ended in a void', () => {
    expect(ids(scene(without(yard(), at(2, 2, 'floor'))))).toContain('natural-placement/over-void');
    expect(ids(scene(yard()), { camera: { width: 390, height: 844, zoom: 1, center: { x: 5, y: 11 } } })).toContain(
      'natural-placement/edge-in-frame',
    );
  });
});

describe('framing', () => {
  it('fails a scene that fills much less of the frame than the approved mock', async () => {
    const { data, info } = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#000000ff' } })
      .composite([
        { input: { create: { width: 20, height: 40, channels: 4, background: '#30a030ff' } }, left: 0, top: 0 },
      ])
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(occupiedShare(data, info.width, info.height)).toBeCloseTo(0.5, 1);
    // The yard frame is all ground, so a half-empty mock is a framing mismatch, and the reverse holds too.
    expect(ids(scene(yard()), { mock: { occupied: 0.5 } })).toContain('framing/occupied');
    expect(ids(scene(yard()), { mock: { occupied: 1 } })).not.toContain('framing/occupied');
  });

  it('fails a character drawn at a different scale than in the mock', () => {
    const report = ids(scene(yard()), { mock: { occupied: 1, character: 0.3, characterHeight: 30 } });
    expect(report).toContain('framing/character-scale');
  });
});

describe('ranking and known limitations', () => {
  it('ranks high findings first and lets a listed known limitation pass', () => {
    const broken = without(yard(), (p) => p.asset === 'pack:flower' || at(8, 1, 'wall')(p));
    const report = checkScene('yard', scene(broken), options);
    expect(report.findings[0]!.severity).toBe('high');
    expect(report.findings.map((f) => f.rank)).toEqual(report.findings.map((_, i) => i + 1));
    expect(report.pass).toBe(false);
    const allowed = checkScene('yard', scene(broken), { ...options, allow: ['connected-runs'] });
    expect(allowed.pass).toBe(true);
  });
});

describe('reading scenes as maps lay them out', () => {
  it('treats ground on any layer as ground: #40 put its grass on the wall layer and left the floor empty', () => {
    const fixture = yard();
    fixture.pieces = fixture.pieces.map((p) => (p.layer === 'floor' ? { ...p, layer: 'wall9' } : p));
    expect(ids(scene(fixture))).not.toContain('natural-placement/over-void');
  });

  it('fails a map drawn at a tile size the pack does not use: its pieces cannot join', () => {
    const json = tiled(yard()) as { tilewidth: number; tileheight: number };
    json.tilewidth = 256;
    json.tileheight = 128;
    const report = checkScene('yard', readTiledScene([{ json }], pack, {}), options);
    expect(report.findings.map((f) => f.id)).toContain('facts/tile-size');
    expect(report.pass).toBe(false);
  });

  it('judges density on the scene alone: a bare surround drawn beneath only closes the frame', () => {
    const grass = tiled({
      width: 40,
      height: 40,
      pieces: Array.from({ length: 1600 }, (_, i) => ({
        layer: 'floor',
        x: i % 40,
        y: Math.floor(i / 40),
        asset: 'pack:grass',
      })),
      spawns: [],
    });
    const withSurround = readTiledScene(
      [{ json: tiled(yard()) }, { json: grass, offset: { x: -14, y: -14 }, prefix: 'under/', under: true }],
      pack,
      {},
    );
    expect(checkScene('yard', withSurround, options).findings.map((f) => f.id)).not.toContain(
      'natural-placement/sparse',
    );
  });
});

describe('review follow-ups', () => {
  it('fails a scene with no spawn or a blocked spawn: nothing can be proven reachable from it', () => {
    expect(ids(scene({ ...yard(), spawns: [] }))).toContain('traversable/no-spawn');
    const walled = yard();
    walled.spawns[0] = { name: 'player', x: 3, y: 3, prefab: 'player' };
    expect(ids(scene(walled))).toContain('traversable/spawn-blocked');
  });

  it('fails a closed house without a door, and a roof standing with no walls at all', () => {
    const doorless = yard();
    doorless.pieces = doorless.pieces.map((p) =>
      p.asset === 'pack:door' ? { ...p, asset: 'pack:wall', solid: true } : p,
    );
    expect(ids(scene(doorless))).toContain('coherent-buildings/no-door');
    expect(ids(scene(without(yard(), (p) => p.asset === 'pack:wall' || p.asset === 'pack:door')))).toContain(
      'coherent-buildings/no-shell',
    );
  });

  it('keeps a garden wall that runs on from a closed house out of the shell check', () => {
    const fixture = yard();
    fixture.pieces.push(
      { layer: 'wall', x: 5, y: 3, asset: 'pack:wall', facing: 'N', solid: true },
      { layer: 'wall', x: 6, y: 3, asset: 'pack:wall', facing: 'N', solid: true },
      { layer: 'decor2', x: 7, y: 3, asset: 'pack:post', solid: true },
    );
    expect(ids(scene(fixture)).filter((id) => !id.startsWith('facts'))).toEqual([]);
  });

  it('treats a roofless walled yard with only a gate as a boundary, not a roofless building', () => {
    const fixture = without(yard(), (p) => p.layer === 'roof');
    fixture.pieces = fixture.pieces.map((p) => (p.asset === 'pack:door' ? { ...p, asset: 'pack:gate' } : p));
    expect(ids(scene(fixture)).filter((id) => id.startsWith('coherent-buildings'))).toEqual([]);
  });

  it('fails a prop lifted off the ground and two pieces drawing one edge', () => {
    const fixture = yard();
    fixture.pieces = fixture.pieces.map((p) =>
      p.asset === 'pack:flower' && p.x === 2 && p.y === 2 ? { ...p, elevation: 1 } : p,
    );
    fixture.pieces.push({ layer: 'decor2', x: 3, y: 1, asset: 'pack:fence', facing: 'W', solid: true });
    expect(ids(scene(fixture))).toEqual(
      expect.arrayContaining(['natural-placement/floating', 'connected-runs/stacked']),
    );
  });

  it('fails tiles with Tiled flip flags, which the adapter refuses to draw', () => {
    const json = tiled(yard()) as { layers: { name: string; data?: number[] }[] };
    const decor = json.layers.find((l) => l.name === 'decor')!.data!;
    const i = decor.findIndex(Boolean);
    decor[i] = (decor[i]! | 0x80000000) >>> 0;
    expect(checkScene('yard', readTiledScene([{ json }], pack, {}), options).findings.map((f) => f.id)).toContain(
      'facts/tile-flip',
    );
  });

  it("ignores a surround's spawns: they belong to another scene", () => {
    const surround = tiled({
      width: 4,
      height: 4,
      pieces: [],
      spawns: [{ name: 'player', x: 0, y: 0, prefab: 'player' }],
    });
    const merged = readTiledScene(
      [{ json: tiled(yard()) }, { json: surround, offset: { x: 20, y: 20 }, under: true }],
      pack,
      {},
    );
    expect(merged.actors.map((a) => a.name)).toEqual(['player', 'guard']);
  });
});
