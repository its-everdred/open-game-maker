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
  sources: [
    {
      id: 'claude:seven_day',
      label: 'Claude',
      usedPercent: 53,
      resetsAt: '2026-11-27T09:00:00.000Z',
      basis: 'reported',
      observedAt: '2026-11-22T22:07:20.000Z',
      stale: false,
    },
    {
      id: 'codex:codex:primary',
      label: 'Codex',
      usedPercent: null,
      resetsAt: '2026-11-25T16:28:48.000Z',
      basis: 'unknown',
      observedAt: '2026-11-22T05:07:24.000Z',
      stale: true,
    },
    { id: 'fal', label: 'fal', usedPercent: 20, resetsAt: null, basis: 'estimate', observedAt: null, stale: false },
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
      'Claude  53% used  resets 2026-11-27T09:00:00.000Z  reported',
      'Codex  unknown  resets 2026-11-25T16:28:48.000Z  unknown  stale since 2026-11-22T05:07:24.000Z',
      'fal  20% used  estimate',
    ]);
  });

  it('reads a bundle written before provider readings existed as having none', async () => {
    const { sources: _sources, ...older } = energy;
    const result = await gm(['energy', '--json'], { cwd: workspace(bundle({ energy: older })) });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!).sources).toEqual([]);
  });

  it('fails loud, saying to treat Energy as unknown, when the bundle has none', async () => {
    for (const cwd of [workspace(), workspace(bundle())]) {
      const result = await gm(['energy'], { cwd });
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toContain('treat Energy as unknown');
    }
  });
});
