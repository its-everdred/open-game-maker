import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const probe = spawnSync(
  'blender',
  [
    '--background',
    '--factory-startup',
    '--python-use-system-env',
    '--python-exit-code',
    '1',
    '--python-expr',
    'import numpy',
  ],
  { encoding: 'utf8', timeout: 180_000 },
);
const unavailable =
  (probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ||
  /No module named ['"]numpy['"]/.test(probe.stderr ?? '');
if (probe.status !== 0 && !unavailable)
  throw new Error(`Blender probe failed: ${probe.error?.message ?? probe.stderr}`);

it.skipIf(unavailable)(
  'bakes two distinct UV layers into the correct mesh coordinates (requires Blender and NumPy)',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-unity-bake-'));
    try {
      const python = `import bpy, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(join(repo, 'scripts/assets'))})
from blender_unity_bake import bake_mesh, requires_mesh_bake
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('quad'); mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3)])
obj=bpy.data.objects.new('quad',mesh); bpy.context.scene.collection.objects.link(obj)
mesh.uv_layers.new(name='uv0'); mesh.uv_layers.new(name='uv1')
for loop in mesh.loops:
 x,y,_=mesh.vertices[loop.vertex_index].co
 mesh.uv_layers['uv0'].data[loop.index].uv=(x,y); mesh.uv_layers['uv1'].data[loop.index].uv=(1-x,1-y)
mesh.materials.append(bpy.data.materials.new('source'))
paths=[]
for layer in range(2):
 image=bpy.data.images.new('gradient',width=16,height=16,alpha=True); image.colorspace_settings.name='Non-Color'
 pixels=[]
 for y in range(16):
  for x in range(16): pixels.extend([(x+.5)/16 if layer==0 else 1,(y+.5)/16 if layer==1 else 1,1,1])
 image.pixels.foreach_set(pixels); image.filepath_raw=str(Path(${JSON.stringify(root)})/f'gradient-{layer}.png'); image.file_format='PNG'; image.save(); paths.append(image.filepath_raw)
surface={'path':'test.mat','textures':[{'uv':0,'scale':[1,1],'offset':[0,0]},{'uv':1,'scale':[1,1],'offset':[0,0]}],'texturePaths':paths,'textureSrgb':[False,False],'color':[1,1,1,1]}
surface['textures'][1]['uvTransform']=[0,1,0,-1,0,1]
constant=lambda value: {'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[value,value,value,1]}
mask={'path':'test.mat','textures':[surface['textures'][1]],'texturePaths':[paths[1]],'textureSrgb':[False],'color':[1,1,1,1]}
surface['blends']=[{'a':constant(1),'b':constant(.5),'weight':{'term':mask,'channel':1}}]
assert requires_mesh_bake([surface]); bake_mesh(obj,[surface])
assert len(mesh.uv_layers)==1 and mesh.uv_layers[0].name=='OGM baked UV'
assert not any(material.name.startswith('Unity bake source') for material in bpy.data.materials)
image=next(n.image for n in mesh.materials[0].node_tree.nodes if n.type=='TEX_IMAGE'); pixels=list(image.pixels); size=image.size[0]
for loop in mesh.loops:
 u,v=mesh.uv_layers[0].data[loop.index].uv; u=.8*u+.1; v=.8*v+.1
 x=min(size-1,int(u*size)); y=min(size-1,int(v*size)); ix=(y*size+x)*4
 vx,vy,_=mesh.vertices[loop.vertex_index].co
 green=.8*vx+.1; blend=1-.5*green
 for i,expected in [(0,(.8*vx+.1)*blend),(1,green*blend)]:
  expected=expected*12.92 if expected<=.0031308 else 1.055*expected**(1/2.4)-.055
  assert abs(pixels[ix+i]-expected)<.12, (loop.vertex_index,i,pixels[ix+i],expected)
for index in range(7): mesh.uv_layers.new(name=f'extra-{index}')
try:
 bake_mesh(obj,[surface])
 raise AssertionError('expected spare UV layer refusal')
except ValueError as error:
 assert 'spare UV layer' in str(error)
`;
      const result = spawnSync(
        'blender',
        [
          '--background',
          '--factory-startup',
          '--python-use-system-env',
          '--python-exit-code',
          '1',
          '--python-expr',
          python,
        ],
        { encoding: 'utf8', timeout: 180_000 },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  240_000,
);
