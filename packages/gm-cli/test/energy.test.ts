import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const energy = {
  level: 'limited',
  preference: 'save',
  windows: [
    { window: 'day', usedPercent: 80, resetsAt: '2026-11-09T08:00:00.000Z' },
    { window: 'week', usedPercent: null, resetsAt: '2026-11-09T08:00:00.000Z' },
    { window: 'month', usedPercent: 10, resetsAt: '2026-12-01T08:00:00.000Z' },
  ],
  services: [
    { service: 'voice', usedPercent: null },
    { service: 'images', usedPercent: null },
  ],
};

function workspace(bundle?: object): string {
  const cwd = tempDir('gm-energy-');
  execFileSync('git', ['init', '-q'], { cwd });
  if (bundle) {
    mkdirSync(join(cwd, '.gm/context'), { recursive: true });
    writeFileSync(join(cwd, '.gm/context/bundle.json'), JSON.stringify(bundle));
  }
  return cwd;
}

const bundle = (extra: object = {}) => ({
  v: 1,
  jobId: 'j1',
  gameId: 'g1',
  repo: 'everdred-games/gm-g1',
  kind: 'feature',
  skillPackVersion: '1.0.0',
  skillPackUrl: 'http://127.0.0.1:4000/internal/skills/1.0.0.tgz',
  gameContext: {
    title: 'Castle Run',
    family: 'chunky-low-poly',
    pov: 'iso',
    genre: 'platformer',
    multiplayer: false,
    paidApisDuringGameplay: false,
    branch: 'main',
    lockfilePath: 'assets.lock.json',
  },
  ...extra,
});

describe('gm energy', () => {
  it("prints the job's Energy and preference so the agent can pick model, effort and timing", async () => {
    const cwd = workspace(bundle({ energy }));
    const json = await gm(['energy', '--json'], { cwd });
    expect(json).toMatchObject({ code: 0, err: [] });
    expect(JSON.parse(json.out[0]!)).toEqual(energy);

    const text = await gm(['energy'], { cwd });
    expect(text.out).toEqual([
      'energy limited, preference save',
      'day  80% used  resets 2026-11-09T08:00:00.000Z',
      'week  unknown  resets 2026-11-09T08:00:00.000Z',
      'month  10% used  resets 2026-12-01T08:00:00.000Z',
      'voice  unknown',
      'images  unknown',
    ]);
  });

  it('fails loud, saying to treat Energy as unknown, when the bundle has none', async () => {
    for (const cwd of [workspace(), workspace(bundle())]) {
      const result = await gm(['energy'], { cwd });
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toContain('treat Energy as unknown');
    }
  });
});
