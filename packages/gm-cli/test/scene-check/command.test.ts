import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assetFacts, smallScaleIntFacts } from '../../src/scene-check/facts.js';
import { gm, tempDir } from '../helpers.js';
import { tiled, yard } from './fixture.js';

const FENCE = 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01';

/** A game folder holding the yard; `broken` stands its guard inside a house wall (a failing high check). */
function game(broken: boolean): string {
  const dir = tempDir('gm-scene-');
  writeFileSync(join(dir, 'gm.lock.json'), JSON.stringify({ v: 1, set: 'smallscaleint' }));
  mkdirSync(join(dir, 'maps'));
  const fixture = yard();
  if (broken) fixture.spawns[1] = { name: 'guard', x: 3, y: 3 };
  writeFileSync(join(dir, 'maps', 'yard.json'), JSON.stringify(tiled(fixture)));
  return dir;
}

describe('gm verify scene', () => {
  it('fails on a high finding, writes the ranked list and overlay, and passes with it listed as known', async () => {
    const dir = game(true);
    const frame = ['--center', '6,6', '--view', '300x300'];
    const out = join(dir, 'report');
    const failed = await gm(['verify', 'scene', dir, 'yard', ...frame, '--out', out, '--overlay', join(dir, 'o.png')], {
      cwd: dir,
    });
    expect(failed.code).toBe(1);
    // The fixture ids carry no measured SmallScaleInt edges: the report says the runs went unchecked, never passes them.
    expect(failed.out.join('\n')).toContain('facts/unmeasured-edge');
    expect(existsSync(join(dir, 'o.png'))).toBe(true);
    const report = JSON.parse(readFileSync(`${out}.json`, 'utf8')) as { findings: { id: string; rank: number }[] };
    expect(report.findings[0]).toMatchObject({ id: 'no-overlap/actor-in-solid', rank: 1 });
    expect(readFileSync(`${out}.md`, 'utf8')).toContain('### Scene structure: yard — FAIL');
    const known = await gm(['verify', 'scene', dir, 'yard', ...frame, '--allow', 'no-overlap/actor-in-solid'], {
      cwd: dir,
    });
    expect(known.code).toBe(0);
    expect(known.out.join('\n')).toContain('high (known limitation)');
  }, 60_000);

  it('refuses a game whose set has no scene facts', async () => {
    const dir = game(false);
    writeFileSync(join(dir, 'gm.lock.json'), JSON.stringify({ v: 1, set: 'kaykit' }));
    const { code } = await gm(['verify', 'scene', dir, 'yard'], { cwd: dir });
    expect(code).toBe(2);
  });
});

describe('SmallScaleInt facts', () => {
  const adapter = {
    conventions: { tile: { value: { footprint: [128, 64] } } },
    structuralImageBounds: { value: { [FENCE]: { size: [128, 256] } } },
    structuralCardFacts: (id: string) =>
      id === FENCE
        ? {
            E: { edges: { value: ['yMax'] }, alpha_bounds: { value: [0, 92, 81, 240] } },
            N: { edges: { value: ['xMax'] } },
          }
        : undefined,
  };

  it('reads measured edges and alpha bounds from the adapter, and nothing it did not measure', () => {
    const facts = smallScaleIntFacts(adapter).asset(FENCE)!;
    expect(facts.edges).toEqual({ E: 'yMax', N: 'xMax' });
    expect(facts.alpha).toEqual({ E: [0, 92, 81, 240] });
    expect(facts.size).toEqual([128, 256]);
    expect(smallScaleIntFacts({}).asset(FENCE)).toBeUndefined();
  });

  it('gives a derived copy its source facts, so a game-cropped wall is checked like the pack wall', () => {
    const pack = smallScaleIntFacts(adapter);
    const lock = { 't3:game/fence-copy': { derived_from: [FENCE] } };
    expect(assetFacts(pack, lock, 't3:game/fence-copy')?.edges?.E).toBe('yMax');
  });
});
