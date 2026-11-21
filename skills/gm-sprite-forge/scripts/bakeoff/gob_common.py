"""Shared goblin pieces for the bake-off: a hunched biped armature with a 15-frame procedural walk (frames 1-16,
16 == 1), nearest-bone skin weights, and a procedural axe. Front is -Y, height ~1.0."""
import math

import bpy
from mathutils import Vector

J = {  # joint positions (x, y, z); front is -Y, hunched forward
    'hips': (0, 0.0, 0.46), 'chest': (0, -0.13, 0.66), 'neck': (0, -0.24, 0.72), 'head': (0, -0.36, 0.80),
    'sh.L': (0.14, -0.14, 0.68), 'el.L': (0.27, -0.16, 0.52), 'ha.L': (0.29, -0.24, 0.36), 'fi.L': (0.295, -0.27, 0.29),
    'hip.L': (0.08, 0.0, 0.44), 'kn.L': (0.11, -0.09, 0.25), 'an.L': (0.11, 0.02, 0.05), 'to.L': (0.11, -0.09, 0.0),
}
for k in list(J):
    if k.endswith('.L'):
        x, y, z = J[k]
        J[k[:-2] + '.R'] = (-x, y, z)
BONES = [('spine', 'hips', 'chest', None), ('neck', 'chest', 'neck', 'spine'), ('head', 'neck', 'head', 'neck')]
for s in 'LR':
    BONES += [(f'upperarm.{s}', f'sh.{s}', f'el.{s}', 'spine'), (f'forearm.{s}', f'el.{s}', f'ha.{s}', f'upperarm.{s}'),
              (f'hand.{s}', f'ha.{s}', f'fi.{s}', f'forearm.{s}'),
              (f'thigh.{s}', f'hip.{s}', f'kn.{s}', None), (f'shin.{s}', f'kn.{s}', f'an.{s}', f'thigh.{s}'),
              (f'foot.{s}', f'an.{s}', f'to.{s}', f'shin.{s}')]


def armature(scale=1.0, offset=(0, 0, 0)):
    arm = bpy.data.armatures.new('rig')
    ob = bpy.data.objects.new('rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    off = Vector(offset)
    for name, a, b, parent in BONES:
        e = arm.edit_bones.new(name)
        e.head = Vector(J[a]) * scale + off
        e.tail = Vector(J[b]) * scale + off
        e.roll = 0
        if parent:
            e.parent = arm.edit_bones[parent]
            e.use_connect = False
    root = arm.edit_bones.new('root')
    root.head, root.tail = off, off + Vector((0, 0, 0.1 * scale))
    for name, _, _, parent in BONES:
        if not parent:
            arm.edit_bones[name].parent = root
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def walk(rig, frames=15):
    """Loop of `frames` frames starting at 1; frame 1 + frames repeats frame 1."""
    for f in range(frames + 1):
        t = 2 * math.pi * f / frames
        s = math.sin(t)
        c = math.cos(t)
        pose = {
            'thigh.L': (-30 * s, 0), 'thigh.R': (30 * s, 0),
            'shin.L': (35 * max(0, -c) + 8, 0), 'shin.R': (35 * max(0, c) + 8, 0),
            'foot.L': (-10 * s, 0), 'foot.R': (10 * s, 0),
            'upperarm.L': (22 * s, 0), 'upperarm.R': (-14 * s, 0),
            'forearm.L': (-15 - 10 * s, 0), 'forearm.R': (-20, 0),
            'spine': (4 + 2 * math.cos(2 * t), 4 * s), 'head': (-6, -5 * s),
        }
        for name, (rx, rz) in pose.items():
            pb = rig.pose.bones[name]
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (math.radians(rx), 0, math.radians(rz))
            pb.keyframe_insert('rotation_euler', frame=1 + f)
        rb = rig.pose.bones['root']
        rb.location = (0, 0.03 * abs(math.cos(t)), 0)  # bob: root bone local Y is world Z
        rb.keyframe_insert('location', frame=1 + f)


def bind(mesh_ob, rig):
    """Nearest-bone weights (inverse distance^4 over the two closest bones), then an armature modifier."""
    bones = [b for b in rig.data.bones if b.name != 'root']
    segs = [(b.name, rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in bones]
    groups = {n: mesh_ob.vertex_groups.new(name=n) for n, _, _ in segs}
    mw = mesh_ob.matrix_world
    for v in mesh_ob.data.vertices:
        p = mw @ v.co
        ds = []
        for n, a, b in segs:
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
            ds.append(((p - (a + ab * t)).length, n))
        ds.sort()
        w = [(1 / max(d, 1e-4) ** 4, n) for d, n in ds[:2]]
        tot = sum(x for x, _ in w)
        for x, n in w:
            groups[n].add([v.index], x / tot, 'REPLACE')
    mod = mesh_ob.modifiers.new('rig', 'ARMATURE')
    mod.object = rig
    mesh_ob.parent = rig


def material(name, rgb, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def axe(rig, hand_bone, length=0.7, scale=1.0):
    """Wooden haft with a grey blade, held in hand_bone, haft pointing down/forward."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.014 * scale, depth=length * scale)
    haft = bpy.context.object
    haft.data.materials.append(material('haft', (0.18, 0.09, 0.03)))
    bpy.ops.mesh.primitive_cube_add(size=1)
    blade = bpy.context.object
    blade.scale = (0.014 * scale, 0.15 * scale, 0.13 * scale)
    blade.location = (0, -0.09 * scale, -length * 0.4 * scale)
    bpy.ops.object.transform_apply(location=True, scale=True)
    bev = blade.modifiers.new('bev', 'BEVEL')
    bev.width = 0.01 * scale
    blade.data.materials.append(material('blade', (0.55, 0.56, 0.58), 0.35))
    blade.parent = haft
    import mathutils
    bpy.context.view_layer.update()
    pb = rig.pose.bones[hand_bone]
    grip = rig.matrix_world @ pb.head  # held at the palm, haft tilted forward, blade low and outward
    haft.matrix_world = (mathutils.Matrix.Translation(grip) @ mathutils.Matrix.Rotation(math.radians(-35), 4, 'X')
                         @ mathutils.Matrix.Translation((0, 0, -0.05 * scale)))
    world = haft.matrix_world.copy()
    haft.parent = rig
    haft.parent_type = 'BONE'
    haft.parent_bone = hand_bone
    haft.matrix_parent_inverse = mathutils.Matrix.Identity(4)
    haft.matrix_basis = mathutils.Matrix.Identity(4)
    bpy.context.view_layer.update()  # now matrix_world is the bone's effective parent matrix (scaled rigs too)
    haft.matrix_parent_inverse = haft.matrix_world.inverted() @ world
    bpy.context.view_layer.update()
    print('AXE', tuple(round(c, 3) for c in haft.matrix_world.translation),
          'expected', tuple(round(c, 3) for c in world.translation))
    return haft
