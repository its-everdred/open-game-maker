import { expect, it } from 'vitest';

import * as adapter from '../../../pack-adapters/smallscaleint/src/index.js';
import { smallScaleIntFacts } from '../../src/scene-check/facts.js';
import { Grid, segments, terminals } from '../../src/scene-check/grid.js';
import { RUN } from '../../src/scene-check/model.js';
import { screenBox } from '../../src/scene-check/overlap.js';
import { readTiledScene } from '../../src/scene-check/read.js';
import { checkScene } from '../../src/scene-check/report.js';
import { connectedRuns, unmeasured } from '../../src/scene-check/runs.js';
import { camera, scene as fixtureScene, yard } from './fixture.js';

it('recognizes assembled gate posts and checks their scaled alpha bounds', () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: 2 + (i % 3), y: 2 + Math.floor(i / 3) }));
  const pillar = 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/stone-a14@2026-11-01';
  const gate = adapter.edgeRun(cells, 'fence', [{ cell: { x: 3, y: 4 }, edge: 'yMax' }], {
    asset: pillar,
    facing: 'E',
    scale: 0.4,
  });
  const scene = readTiledScene([{ json: adapter.assemblyMap(6, 6, gate.placements) }], smallScaleIntFacts(adapter), {});
  const posts = scene.pieces.filter((piece) => piece.role === 'post');
  expect(posts).toHaveLength(2);
  expect(posts.map((piece) => piece.scale)).toEqual([0.4, 0.4]);
  expect([...terminals(posts)]).toEqual([]);
  expect(connectedRuns(new Grid(scene))).toContainEqual(expect.objectContaining({ id: 'connected-runs/open-end' }));
  expect(unmeasured(new Grid(scene))).toContainEqual(expect.objectContaining({ id: 'facts/scaled-post' }));
  const scaled = screenBox(scene, posts[0]!)!;
  const full = screenBox(scene, { ...posts[0]!, scale: 1 })!;
  for (const [actual, expected] of scaled.map(
    (value, index) => [value, [-151.6, 144.4, -109.2, 235.6][index]!] as const,
  )) {
    expect(actual).toBeCloseTo(expected);
  }
  expect(scaled[2] - scaled[0]).toBeCloseTo((full[2] - full[0]) * 0.4);
  expect(scaled[3] - scaled[1]).toBeCloseTo((full[3] - full[1]) * 0.4);
  const bad = adapter.assemblyMap(6, 6, gate.placements);
  const post = bad.tilesets[0]!.tiles!.find((tile) =>
    tile.properties?.some((p) => p.name === 'role' && p.value === 'post'),
  )!;
  post.properties!.find((p) => p.name === 'scale')!.value = 0;
  expect(readTiledScene([{ json: bad }], smallScaleIntFacts(adapter), {}).notes).toContainEqual(
    expect.objectContaining({ id: 'facts/unsupported-scale', severity: 'high' }),
  );
});

it('accepts a unit-scaled floor and reports an unsupported floor scale without aborting', () => {
  const json = adapter.assemblyMap(1, 1, [
    { cell: { x: 0, y: 0 }, layer: 'floor', asset: 'grass', facing: 'E', solid: false, scale: 1 },
  ]);
  expect(readTiledScene([{ json }], smallScaleIntFacts(adapter), {}).notes).toEqual([]);
  expect(new adapter.IsoMap(json).pieces('floor')[0]?.scale).toBe(1);
  json.tilesets[0]!.tiles![0]!.properties!.find((p) => p.name === 'scale')!.value = 0.4;
  expect(new adapter.IsoMap(json).pieces('floor')[0]?.scale).toBeUndefined();
  expect(readTiledScene([{ json }], smallScaleIntFacts(adapter), {}).notes).toContainEqual(
    expect.objectContaining({ id: 'facts/unsupported-scale', severity: 'high' }),
  );
});

it('reports scaled structural edges as unchecked instead of declaring them connected', () => {
  const fence = 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01';
  const json = adapter.assemblyMap(1, 1, [
    { cell: { x: 0, y: 0 }, layer: 'wall', asset: fence, facing: 'E', solid: true, scale: 0.4 },
  ]);
  const scene = readTiledScene([{ json }], smallScaleIntFacts(adapter), {});
  expect(unmeasured(new Grid(scene))).toContainEqual(
    expect.objectContaining({ id: 'facts/scaled-edge', severity: 'high' }),
  );
});

it.each(['door', 'opening'] as const)('does not count a scaled %s as a full structural edge', (role) => {
  const asset = 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f6@2026-11-01';
  const json = adapter.assemblyMap(1, 1, [
    { cell: { x: 0, y: 0 }, layer: 'wall', asset, facing: 'S', solid: false, scale: 0.4, role },
  ]);
  const scene = readTiledScene([{ json }], smallScaleIntFacts(adapter), {});
  expect(unmeasured(new Grid(scene))).toContainEqual(
    expect.objectContaining({ id: 'facts/scaled-edge', severity: 'high' }),
  );
  expect(segments(scene.pieces, RUN)).toEqual([]);
  expect(terminals(scene.pieces).size).toBe(0);
  const unscaled = { ...scene.pieces[0]!, scale: 1 };
  expect(terminals([unscaled]).size).toBeGreaterThan(0);
});

it('does not accept shrunken roof sprites as full-cell coverage', () => {
  const scene = fixtureScene(yard());
  for (const piece of scene.pieces) if (piece.role === 'roof') piece.scale = 0.4;
  const report = checkScene('scaled-roof', scene, { camera, minDensity: 1, allow: [] });
  expect(report.pass).toBe(false);
  expect(report.findings.map((finding) => finding.id)).toEqual(
    expect.arrayContaining(['facts/scaled-roof', 'coherent-buildings/roof-gap']),
  );
});

it('does not let uninspected shrunken posts terminate a fence', () => {
  const scene = fixtureScene(yard());
  for (const piece of scene.pieces) if (piece.role === 'post') piece.scale = 0.1;
  const report = checkScene('scaled-posts', scene, { camera, minDensity: 1, allow: [] });
  expect(report.pass).toBe(false);
  expect(report.findings.map((finding) => finding.id)).toEqual(
    expect.arrayContaining(['facts/scaled-post', 'connected-runs/open-end']),
  );
});
