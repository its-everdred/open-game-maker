import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const skill = readFileSync(join(import.meta.dirname, 'SKILL.md'), 'utf8');

describe('gm-repair skill', () => {
  it('stays concise and names every repair safety step', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(80);
    for (const required of [
      'diagnostics',
      'untrusted',
      'promise',
      'first new console error',
      'gm check',
      'gm test',
      'gm run',
      'gm chat post',
      'published release',
      'design/*.json',
      '.gm/changes/',
      'skills/vendor/phaser/v3-to-v4-migration',
      'skills/vendor/threejs',
      'Aiur attention',
    ]) {
      expect(skill.toLowerCase()).toContain(required.toLowerCase());
    }
  });

  it('does not direct agents to install or download anything', () => {
    expect(skill).not.toMatch(/\b(?:curl|wget|npm install|pnpm add|download)\b/i);
  });

  it('handles an unconfirmed report conversation without inventing a reproduction', () => {
    expect(skill).toContain('Report a Bug conversation');
    expect(skill).toContain('captured game state');
    expect(skill).toContain('reproduce');
    expect(skill).toContain('Do not claim a reproduction');
  });
});
