import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT } from '../src/files.js';
import { parseRoles, readRoles, skillsConfig } from '../src/index.js';

/* #656, Kevin 2026-11-08: role labels decide which skills aiur inlines at the start of a game ticket, so the mapping
   has one source (gm-core's roles.md) and every config is derived from it, never retyped. */
describe('ticket roles', () => {
  it('reads the role table Kevin set from gm-core/references/roles.md', () => {
    const byLabel = Object.fromEntries(readRoles().map((role) => [role.label, role.skills]));
    expect(byLabel).toEqual({
      'role:visual': ['gm-core', 'gm-verify', 'gm-ui-hud', 'gm-image-mock', 'gm-dream-loop'],
      'role:3d': ['gm-core', 'gm-3d', 'gm-verify', 'gm-dream-loop'],
      'role:gameplay': ['gm-core', 'gm-input', 'gm-verify', 'gm-qa', 'gm-map-inspiration'],
      'role:audio': ['gm-core', 'gm-audio', 'gm-voiceover'],
      'role:qa': ['gm-core', 'gm-qa', 'gm-verify'],
      'role:multiplayer': ['gm-core', 'gm-multiplayer-ready', 'gm-qa'],
      'role:game-design': ['gm-core', 'gm-new-game-design', 'gm-new-game-plan', 'gm-image-mock', 'gm-scope-options'],
      'role:assets': [
        'gm-core',
        'gm-verify',
        'gm-asset-variants',
        'gm-pack-adapter',
        'gm-asset-showcase',
        'gm-dream-loop',
      ],
    });
  });

  it('names only skills the platform pack ships, so a mandatory skill can never be missing at dispatch', () => {
    for (const role of readRoles())
      for (const skill of role.skills) expect(existsSync(join(WORKSPACE_ROOT, 'skills', skill, 'SKILL.md'))).toBe(true);
  });

  it('maps game:<slug> to gm-core and the set skill from gm.lock.json, before the roles', () => {
    const config = skillsConfig(parseRoles('| `role:qa` | play | gm-core, gm-qa |'), [
      { slug: 'castle', set: 'kaykit' },
      { slug: 'bare' },
    ]);
    expect(config.by_label).toEqual({
      'game:bare': ['gm-core'],
      'game:castle': ['gm-core', 'gm-set-kaykit'],
      'role:qa': ['gm-core', 'gm-qa'],
    });
    expect(config.preload_max_bytes).toBe(49152);
  });

  it('refuses a table with no roles, a duplicate role or a role with no skills', () => {
    expect(() => parseRoles('# nothing here')).toThrow('no role:* rows');
    expect(() => parseRoles('| `role:qa` | a | gm-qa |\n| `role:qa` | b | gm-qa |')).toThrow('listed twice');
    expect(() => parseRoles('| `role:qa` | a | , |')).toThrow('no mandatory skills');
  });
});
