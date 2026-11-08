import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SKILLS = fileURLToPath(new URL('../../../skills/', import.meta.url));
const read = (path: string) => readFileSync(join(SKILLS, path), 'utf8');
// Workers only open a vendored skill the prompt names exactly; a bare `vendor/threejs` was loaded almost never (#658).
const exactRefs = (text: string) => [...text.matchAll(/`(vendor\/[a-z]+\/[a-z0-9-]+\/SKILL\.md)`/gu)].map((m) => m[1]!);
const bareRefs = (text: string) => [...text.matchAll(/`(vendor\/[a-z0-9/-]+)`/gu)].map((m) => m[1]!);

function roleSection(roles: string, role: string): string {
  const start = roles.indexOf(`### ${role}\n`);
  expect(start, role).toBeGreaterThanOrEqual(0);
  const next = roles.indexOf('\n### ', start + 1);
  return roles.slice(start, next === -1 ? undefined : next);
}

describe('recommended vendored skills', () => {
  it('gives each role the exact vendored skills it needs, and every path exists', () => {
    const roles = read('gm-core/references/roles.md');
    const expected: Record<string, string[]> = {
      'role:3d': [
        'threejs/threejs-lighting',
        'threejs/threejs-materials',
        'threejs/threejs-textures',
        'threejs/threejs-postprocessing',
        'threejs/threejs-performance',
        'gamedev/threejs-scene-setup',
        'gamedev/threejs-materials-lighting',
        'gamedev/camera-systems',
      ],
      'role:visual': ['gamedev/game-ui-ux', 'threejs/threejs-postprocessing', 'phaser/scale-and-responsive'],
      'role:gameplay': ['gamedev/game-feel', 'gamedev/input-systems', 'phaser/input-keyboard-mouse-touch'],
      'role:audio': ['gamedev/audio-design', 'phaser/audio-and-sound'],
      'role:game-design': ['gamedev/prototype-fast', 'gamedev/level-design'],
    };
    for (const [role, skills] of Object.entries(expected)) {
      const refs = exactRefs(roleSection(roles, role));
      expect(refs, role).toEqual(expect.arrayContaining(skills.map((skill) => `vendor/${skill}/SKILL.md`)));
    }
    for (const ref of exactRefs(roles)) expect(existsSync(join(SKILLS, ref)), ref).toBe(true);
    expect(read('gm-core/SKILL.md')).toContain('references/roles.md');
  });

  it('has gm-3d, gm-ui-hud, gm-verify and gm-set-kaykit name exact, existing vendored skills', () => {
    const named: Record<string, string> = {
      'gm-3d': 'vendor/threejs/threejs-lighting/SKILL.md',
      'gm-ui-hud': 'vendor/gamedev/game-ui-ux/SKILL.md',
      'gm-verify': 'vendor/gamedev/threejs-materials-lighting/SKILL.md',
      'gm-set-kaykit': 'vendor/gamedev/threejs-gltf-loading/SKILL.md',
    };
    for (const [name, ref] of Object.entries(named)) {
      const text = read(`${name}/SKILL.md`);
      expect(exactRefs(text), name).toContain(ref);
      for (const exact of exactRefs(text)) expect(existsSync(join(SKILLS, exact)), `${name}: ${exact}`).toBe(true);
      expect(bareRefs(text), `${name} names a vendor set or skill without its SKILL.md`).toEqual([]);
    }
  });
});
