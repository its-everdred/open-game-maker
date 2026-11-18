import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AnyMachine style check', () => {
  it('compares a standalone prop to the supplied pack, not itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anymachine-style-'));
    const mesh = (name: string, textured: boolean, indices: number) => ({
      accessors: [{ count: 10, min: [0, 0, 0], max: [1, 1, 1] }, { count: indices }],
      materials: [{ pbrMetallicRoughness: textured ? { baseColorTexture: { index: 0 } } : {} }],
      meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    });
    try {
      const source = join(dir, 'source.gltf');
      const prop = join(dir, 'prop.gltf');
      writeFileSync(source, JSON.stringify(mesh('pack', true, 300)));
      writeFileSync(prop, JSON.stringify(mesh('pack', false, 30)));
      const result = spawnSync(
        'python3',
        [join(process.cwd(), '../../skills/vendor/anymachine/scripts/style-check.py'), '--standalone', prop, source],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('flat-colour material');
      expect(result.stdout).toContain('coarse');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
