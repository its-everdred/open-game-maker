"""Run in Blender: exercise cloth simulation without licensed assets."""
import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from cloth import drape

bpy.ops.wm.read_factory_settings(use_empty=True)
n = 12
vertices = [(x / n - .5, y / n - .5, 1) for x in range(n + 1) for y in range(n + 1)]
faces = [(x*(n+1)+y, (x+1)*(n+1)+y, (x+1)*(n+1)+y+1, x*(n+1)+y+1)
         for x in range(n) for y in range(n)]
mesh = bpy.data.meshes.new('cloth')
mesh.from_pydata(vertices, [], faces)
mesh.update()
obj = bpy.data.objects.new('cloth', mesh)
bpy.context.collection.objects.link(obj)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, .86))
floor = bpy.context.object
floor.dimensions = (2, 2, .1)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# Preserve pre-existing collision settings and ignore unrelated scene colliders.
temporary = floor.modifiers.new('setup', 'COLLISION')
floor.collision.thickness_outer = .073
floor.modifiers.remove(temporary)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, .945))
unrelated = bpy.context.object
unrelated.dimensions = (2, 2, .05)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
unrelated_collision = unrelated.modifiers.new('unrelated collision', 'COLLISION')
unrelated.modifiers.remove(unrelated_collision)
copy_mesh = obj.data.copy()
baseline = bpy.data.objects.new('baseline', copy_mesh)
bpy.context.collection.objects.link(baseline)
expected = bpy.data.objects.new('expected', obj.data.copy())
bpy.context.collection.objects.link(expected)
pins = [0, n, n*(n+1), (n+1)*(n+1)-1]
original = [obj.data.vertices[i].co.copy() for i in pins]
scene = bpy.context.scene
scene.frame_set(3)
end = scene.frame_end
try:
    drape(obj, [len(vertices)], [floor], frames=20)
except ValueError:
    pass
else:
    raise AssertionError('invalid pin accepted')
assert len(obj.modifiers) == 0 and len(floor.modifiers) == 0
drape(baseline, pins, [], frames=35, quality=5)
drape(expected, pins, [floor], frames=35, quality=5)
unrelated.modifiers.new('unrelated collision', 'COLLISION')
assert drape(obj, pins, [floor], frames=35, quality=5) == obj
assert all((obj.data.vertices[i].co - v).length < .01 for i, v in zip(pins, original))
centre = obj.data.vertices[(n//2)*(n+1)+n//2].co.z
baseline_centre = baseline.data.vertices[(n//2)*(n+1)+n//2].co.z
assert centre > baseline_centre + .005, (centre, baseline_centre)
assert abs(centre - expected.data.vertices[(n//2)*(n+1)+n//2].co.z) < .001
assert centre < .95, centre
assert abs(floor.collision.thickness_outer - .073) < .0001
assert len(unrelated.modifiers) == 1
assert len(obj.modifiers) == 0 and len(floor.modifiers) == 0 and len(obj.vertex_groups) == 0
assert scene.frame_current == 3 and scene.frame_end == end
