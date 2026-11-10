import { describe, expect, it } from 'vitest';

import type { AssetsLock } from '@ogm/contracts';

import { renderCredits } from '../src/credits.js';

describe('credits rendering', () => {
  it('groups by licence and deduplicates attribution deterministically', () => {
    const lock: AssetsLock = {
      version: 1,
      family: 'chunky-low-poly',
      pov: 'iso',
      assets: [
        {
          id: 't1:kenney-mini-dungeon/character-orc@2.0',
          sha256: '0'.repeat(64),
          path: 'assets/model/kenney-mini-dungeon/orc.glb',
          license: 'CC0-1.0',
          rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
          credit: {
            pack: 'kenney-mini-dungeon',
            title: 'Mini Dungeon (Kenney)',
            licenseSource: 'License.txt',
            attribution: 'none required',
            source: { label: 'Kenney' },
          },
          added: '2026-11-01',
        },
        {
          id: 't3:coin-hop/door-a',
          sha256: '1'.repeat(64),
          path: 'assets/model/coin-hop/door-a.glb',
          license: 'LicenseRef-studio',
          rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: 'Studio A' },
          credit: {
            pack: 'coin-hop:studio',
            title: 'Studio assets',
            licenseSource: 'Studio agreement',
            attribution: 'Studio A',
            source: { label: 'Studio A' },
          },
          added: '2026-11-01',
        },
        {
          id: 't3:coin-hop/door-b',
          sha256: '2'.repeat(64),
          path: 'assets/model/coin-hop/door-b.glb',
          license: 'LicenseRef-studio',
          rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: 'Studio A' },
          credit: {
            pack: 'coin-hop:studio',
            title: 'Studio assets',
            licenseSource: 'Studio agreement',
            attribution: 'Studio A',
            source: { label: 'Studio A' },
          },
          added: '2026-11-01',
        },
        {
          id: 't3:coin-hop/spark',
          sha256: '3'.repeat(64),
          path: 'assets/vfx/coin-hop/spark.png',
          license: 'LicenseRef-made-by-agent',
          rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
          credit: {
            pack: 'coin-hop:made',
            title: 'Made for this game',
            licenseSource: 'created for this game',
            attribution: 'none required',
            source: { label: 'agent-generated' },
          },
          added: '2026-11-01',
        },
      ],
    };

    expect(renderCredits(lock)).toBe(
      '# Credits\n\n## CC0-1.0\n- CC0 assets from: kenney-mini-dungeon\n- Mini Dungeon (Kenney) — none required (licence: License.txt)\n\n## LicenseRef-made-by-agent\n- Made for this game — none required (licence: created for this game)\n\n## LicenseRef-studio\n- Studio assets — Studio A (licence: Studio agreement)\n',
    );
  });
});
