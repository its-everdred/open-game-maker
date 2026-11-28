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
from blender_unity_bake import bake_mesh, requires_mesh_bake, expression_material, has_world_coordinates
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('quad'); mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3)])
obj=bpy.data.objects.new('quad',mesh); bpy.context.scene.collection.objects.link(obj)
mesh.uv_layers.new(name='uv0'); mesh.uv_layers.new(name='uv1')
for loop in mesh.loops:
 x,y,_=mesh.vertices[loop.vertex_index].co
 mesh.uv_layers['uv0'].data[loop.index].uv=(x,y); mesh.uv_layers['uv1'].data[loop.index].uv=(1-x,1-y)
mesh.materials.append(bpy.data.materials.new('source'))
obj2=obj.copy(); obj2.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj2)
obj3=obj.copy(); obj3.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj3)
obj4=obj.copy(); obj4.data=mesh.copy(); obj4.location.x=.5; bpy.context.scene.collection.objects.link(obj4)
obj5=obj.copy(); obj5.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj5)
obj6=obj.copy(); obj6.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj6)
obj7=obj.copy(); obj7.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj7)
obj8=obj.copy(); obj8.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj8)
obj9=obj.copy(); obj9.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj9)
obj10=obj.copy(); obj10.data=mesh.copy(); bpy.context.scene.collection.objects.link(obj10)
color=obj6.data.color_attributes.new(name='Unity color',type='FLOAT_COLOR',domain='CORNER')
for value in color.data: value.color=(1,1,.25,1)
paths=[]
for layer in range(2):
 image=bpy.data.images.new('gradient',width=16,height=16,alpha=True); image.colorspace_settings.name='Non-Color'
 pixels=[]
 for y in range(16):
  for x in range(16): pixels.extend([(x+.5)/16 if layer==0 else 1,(y+.5)/16 if layer==1 else 1,1,1])
 image.pixels.foreach_set(pixels); image.filepath_raw=str(Path(${JSON.stringify(root)})/f'gradient-{layer}.png'); image.file_format='PNG'; image.save(); paths.append(image.filepath_raw)
fallback={'path':'test.mat','textures':[{'uv':7,'scale':[1,1],'offset':[0,0]}],'texturePaths':[paths[0]],'textureSrgb':[False],'color':[1,1,1,1]}
source, fallback_images=expression_material(fallback,['uv0','uv1'])
assert next(node.uv_map for node in source.node_tree.nodes if node.type=='UVMAP')=='uv1'
bpy.data.materials.remove(source)
for image in fallback_images: bpy.data.images.remove(image)
surface={'path':'test.mat','textures':[{'uv':0,'scale':[1,1],'offset':[0,0]},{'uv':1,'scale':[1,1],'offset':[0,0]}],'texturePaths':paths,'textureSrgb':[False,False],'color':[1,1,1,1]}
surface['textures'][1]['uvTransform']=[0,1,0,-1,0,1]
constant=lambda value: {'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[value,value,value,1]}
mask={'path':'test.mat','textures':[surface['textures'][1]],'texturePaths':[paths[1]],'textureSrgb':[False],'color':[1,1,1,1]}
transparent={'path':'test.mat','textures':[surface['textures'][0]],'texturePaths':[paths[0]],'textureSrgb':[False],'color':[1,1,1,1], 'opacity':{'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[1,1,1,1],'scalarMask':{'term':mask,'channel':1}}, 'doubleSided':True}
assert requires_mesh_bake([transparent])
bake_mesh(obj8,[transparent]); mesh8=obj8.data
material8=mesh8.materials[0]; image8=next(n.image for n in material8.node_tree.nodes if n.type=='TEX_IMAGE'); pixels8=list(image8.pixels); size8=image8.size[0]
assert material8.surface_render_method=='BLENDED' and not material8.use_backface_culling
assert material8.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].is_linked
for loop in mesh8.loops:
 u,v=mesh8.uv_layers[0].data[loop.index].uv; u=.8*u+.1; v=.8*v+.1
 ix=(min(size8-1,int(v*size8))*size8+min(size8-1,int(u*size8)))*4
 x=.8*mesh8.vertices[loop.vertex_index].co.x+.1
 assert abs(pixels8[ix+3]-x)<.12, (loop.vertex_index,pixels8[ix+3],x)
surface['blends']=[{'a':constant(1),'b':constant(.5),'weight':{'term':mask,'channel':'rgb'}}]
surface['scalarMask']={'op':'add','args':[1,{'op':'multiply','args':[{'op':'subtract','args':[{'term':mask,'channel':1},1]},2]}]}
assert requires_mesh_bake([surface]); bake_mesh(obj,[surface])
assert len(mesh.uv_layers)==1 and mesh.uv_layers[0].name=='OGM baked UV'
assert not any(material.name.startswith('Unity bake source') for material in bpy.data.materials)
image=next(n.image for n in mesh.materials[0].node_tree.nodes if n.type=='TEX_IMAGE'); pixels=list(image.pixels); size=image.size[0]
for loop in mesh.loops:
 u,v=mesh.uv_layers[0].data[loop.index].uv; u=.8*u+.1; v=.8*v+.1
 x=min(size-1,int(u*size)); y=min(size-1,int(v*size)); ix=(y*size+x)*4
 vx,vy,_=mesh.vertices[loop.vertex_index].co
 green=.8*vx+.1; blend=1-.5*green
 factor=2*green-1
 for i,expected in [(0,max(0,(.8*vx+.1)*.5*factor)),(1,max(0,green*blend*factor)),(2,max(0,.5*factor))]:
  expected=expected*12.92 if expected<=.0031308 else 1.055*expected**(1/2.4)-.055
  assert abs(pixels[ix+i]-expected)<.12, (loop.vertex_index,i,pixels[ix+i],expected)
adjustedSource={'path':'test.mat','textures':surface['textures'],'texturePaths':paths,'textureSrgb':[False,False],'color':[1,1,1,1],'adjustment':{'op':'saturation','amount':1.1}}
contrasted={'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[1,1,1,1],'products':[adjustedSource],'adjustment':{'op':'contrast','amount':.5}}
adjusted={'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[1.1,1.1,1.1,1],'products':[contrasted],'adjustment':{'op':'power','amount':2}}
bake_mesh(obj2,[adjusted]); mesh2=obj2.data
image2=next(n.image for n in mesh2.materials[0].node_tree.nodes if n.type=='TEX_IMAGE'); pixels2=list(image2.pixels); size2=image2.size[0]
for loop in mesh2.loops:
 u,v=mesh2.uv_layers[0].data[loop.index].uv; u=.8*u+.1; v=.8*v+.1
 ix=(min(size2-1,int(v*size2))*size2+min(size2-1,int(u*size2)))*4
 x=.8*mesh2.vertices[loop.vertex_index].co.x+.1; luma=x*(.2126729+.7151522)+.0721750
 for i,component in enumerate([x,x,1]):
  adjusted_color=(luma+1.1*(component-luma)-.5**2.2)*.5+.5**2.2
  expected=min(1,(1.1*adjusted_color)**2)
  expected=expected*12.92 if expected<=.0031308 else 1.055*expected**(1/2.4)-.055
  assert abs(pixels2[ix+i]-expected)<.12, (loop.vertex_index,i,pixels2[ix+i],expected)
zero={'path':'test.mat','textures':surface['textures'],'texturePaths':paths,'textureSrgb':[False,False],'color':[1,1,1,1],'scalarMask':0}
bake_mesh(obj3,[zero])
image3=next(n.image for n in obj3.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
assert max(list(image3.pixels)[0::4]) < .01
world={'path':'test.mat','textures':[{'scale':[1,1],'offset':[0,0],'worldUvTransform':[-.5,0,0,0,0,0,-.5,0]}],'texturePaths':[paths[0]],'textureSrgb':[False],'color':[1,1,1,1]}
assert requires_mesh_bake([world]); bpy.context.view_layer.update(); bake_mesh(obj4,[world])
mesh4=obj4.data
image4=next(n.image for n in mesh4.materials[0].node_tree.nodes if n.type=='TEX_IMAGE'); pixels4=list(image4.pixels); size4=image4.size[0]
for loop in mesh4.loops:
 u,v=mesh4.uv_layers[0].data[loop.index].uv; u=.8*u+.1; v=.8*v+.1
 ix=(min(size4-1,int(v*size4))*size4+min(size4-1,int(u*size4)))*4
 x=.8*mesh4.vertices[loop.vertex_index].co.x+.1
 expected=.5*(x+.5); expected=expected*12.92 if expected<=.0031308 else 1.055*expected**(1/2.4)-.055
 assert abs(pixels4[ix]-expected)<.12, (loop.vertex_index,pixels4[ix],expected)
normal={'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[1,1,1,1],'blends':[{'a':constant(0),'b':constant(1),'weight':{'op':'absolute','args':[{'normal':1}]}}]}
assert requires_mesh_bake([normal]) and has_world_coordinates([normal]); bake_mesh(obj5,[normal])
image5=next(n.image for n in obj5.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
assert max(list(image5.pixels)[0::4]) > .98
vertex={'path':'test.mat','textures':[],'texturePaths':[],'textureSrgb':[],'color':[1,1,1,1],'blends':[{'a':constant(0),'b':constant(1),'weight':{'vertexColor':2}}]}
assert requires_mesh_bake([vertex]); bake_mesh(obj6,[vertex]); bake_mesh(obj7,[vertex])
image6=next(n.image for n in obj6.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
image7=next(n.image for n in obj7.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
assert .52 < max(list(image6.pixels)[0::4]) < .56
assert max(list(image7.pixels)[0::4]) > .98
overlay=constant(1); overlay['scalarMask']={'op':'overlay','args':[{'term':mask,'channel':1},.8]}
bake_mesh(obj9,[overlay]); mesh9=obj9.data
image9=next(n.image for n in mesh9.materials[0].node_tree.nodes if n.type=='TEX_IMAGE'); pixels9=list(image9.pixels); size9=image9.size[0]
for loop in mesh9.loops:
 u,v=mesh9.uv_layers[0].data[loop.index].uv; u=.8*u+.1; v=.8*v+.1
 ix=(min(size9-1,int(v*size9))*size9+min(size9-1,int(u*size9)))*4
 x=.8*mesh9.vertices[loop.vertex_index].co.x+.1
 expected=1.6*x if x<=.5 else .6+.4*x
 expected=expected*12.92 if expected<=.0031308 else 1.055*expected**(1/2.4)-.055
 assert abs(pixels9[ix]-expected)<.12, (loop.vertex_index,pixels9[ix],expected)
noise=constant(1); noise['scalarMask']={'noise':{'uv':0,'scale':4}}
assert requires_mesh_bake([noise]); bake_mesh(obj10,[noise])
image10=next(n.image for n in obj10.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
red=list(image10.pixels)[0::4]
assert max(red) > .5 and min(red) < .1
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
