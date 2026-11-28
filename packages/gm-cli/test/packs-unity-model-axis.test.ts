import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { expect, it } from 'vitest';
import { exportUnityAssembly } from '../src/packs/unity/export.js';
import type { PlannedUnityMesh } from '../src/packs/unity/plan.js';

const probe = spawnSync(
  'blender',
  ['-b', '--factory-startup', '--python-use-system-env', '--python-exit-code', '1', '--python-expr', 'import numpy'],
  { encoding: 'utf8', timeout: 180_000 },
);
const unavailable =
  (probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ||
  /No module named ['"]numpy['"]/.test(probe.stderr ?? '');
if (probe.status !== 0 && !unavailable)
  throw new Error(`Blender probe failed: ${probe.error?.message ?? probe.stderr}`);

it.skipIf(probe.status !== 0).each([
  ['FBX_SCALE_NONE', 0.01],
  ['FBX_SCALE_UNITS', 1],
])(
  'preserves Unity mesh axes and %s units under a prefab rotation (requires Blender and NumPy)',
  async (scaleOption, factor) => {
    const root = await mkdtemp(join(tmpdir(), 'gm-unity-axis-'));
    try {
      const fbx = join(root, 'asymmetric.fbx');
      const output = join(root, 'building.glb');
      const script = `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_cube_add(size=2)\no=bpy.context.object\no.name='Asymmetric'\nfor v in o.data.vertices:\n v.co.y *= 2\n v.co.z *= 3\no.data.materials.append(bpy.data.materials.new('Base'))\nbpy.ops.export_scene.fbx(filepath=${JSON.stringify(fbx)},axis_forward='-Z',axis_up='Y',apply_scale_options='${scaleOption}')`;
      const result = spawnSync(
        'blender',
        ['-b', '--factory-startup', '--python-use-system-env', '--python-exit-code', '1', '--python-expr', script],
        { encoding: 'utf8', timeout: 180_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const plan: PlannedUnityMesh[] = [
        {
          name: 'Asymmetric',
          transformId: 'root',
          parentId: null,
          position: [0, 0, 0],
          rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
          scale: [1, 1, 1],
          active: true,
          rendererActive: true,
          materials: [],
          model: { path: fbx, name: 'Asymmetric', unityMesh: true },
          surfaces: [{ path: 'fixture.mat', textures: [], texturePaths: [], textureSrgb: [], color: [1, 1, 1, 1] }],
        },
      ];
      await exportUnityAssembly(plan, output);
      const document = await new NodeIO().read(output);
      const bounds = getBounds(document.getRoot().listScenes()[0]!);
      const size = bounds.max.map((value, i) => value - bounds.min[i]!);
      expect(size[0]).toBeCloseTo(2 * factor, 3);
      expect(size[1]).toBeCloseTo(6 * factor, 3);
      expect(size[2]).toBeCloseTo(4 * factor, 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  600_000,
);
