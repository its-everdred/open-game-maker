"""Characters that arrive rigged (#1282 bake-off; Blender 4.3 module reached through render_motion.py).

A vendor-rigged body (Meshy, Hyper3D) or a library character (Quaternius) plays a clip on its own skeleton: no landmark
fit, no `retarget.py` rebuild, no stance layer and no IK pass. `kind: own` plays one of the file's actions as it is;
`kind: copy` is the plain retarget (arm C): each mapped bone takes the source bone's rotation away from the source's rest
pose, in world space, applied on top of the target's rest pose turned to point where the source's rest bone points (so a
T-pose source drives an A-pose target), and the hips take the source hips' travel scaled by hip height. Nothing else.

spec["rigged"]: {"path": glb|fbx, "action": name part, "feet": {"L": [foot, toe], "R": [foot, toe]}, "hips": bone,
                 "colour": [r, g, b] (optional flat base colour, linear, for an untextured library mannequin)}
spec["motion"]: {"kind": "own"|"copy"|"pose" (hand-keyed key poses, handpose.py), "frames": [f0, f1] (default: the
                 action's range), "loop": bool,
                 "in_place": bool (hold a travelling clip in place), "sample": "even"|"keys"|"times", ...
                 copy: "path", "action", "map": {target bone: source bone}, "src_hips": bone, "rotz": deg (turn the
                 source to face -Y)}
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sampling  # noqa: E402


def _import(path):
    """The objects and actions this import created (an action is looked up only among its own file's actions)."""
    before, acts = set(bpy.data.objects), set(bpy.data.actions)
    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    elif path.lower().endswith('.bvh'):
        bpy.ops.import_anim.bvh(filepath=path, update_scene_fps=False)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]


def _action(name_part, actions):
    """The action named `name_part`, or the only one whose name contains it (importers add suffixes such as
    `_Armature`), among `actions` (one file's: a copy source's clip must never resolve to the target rig's); an
    ambiguous or missing name fails rather than render another clip."""
    names = [a.name for a in actions]
    exact = [a for a in actions if a.name == name_part]
    acts = exact or [a for a in actions if name_part in a.name]
    if len(acts) != 1:
        raise SystemExit(f'{"no" if not acts else "more than one"} action matching {name_part!r}: {names}')
    return acts[0]


def load(path, action=None, colour=None):
    """The armature and one joined mesh skinned to it; stray objects (helpers, unskinned meshes) are removed."""
    new, file_actions = _import(path)
    rig = next(o for o in new if o.type == 'ARMATURE')
    skinned = [o for o in new if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == rig
                                                           for m in o.modifiers)]
    for o in new:
        if o is not rig and o not in skinned:
            bpy.data.objects.remove(o)
    for o in skinned:
        o.select_set(True)
    bpy.context.view_layer.objects.active = skinned[0]
    if len(skinned) > 1:
        bpy.ops.object.join()
    ob = skinned[0]
    if colour:
        for m in ob.data.materials:
            b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
            if b:
                for link in list(b.inputs['Base Color'].links):
                    m.node_tree.links.remove(link)
                b.inputs['Base Color'].default_value = (*colour, 1)
    rig.animation_data_create()
    if action:
        rig.animation_data.action = _action(action, file_actions)
    return ob, rig


def _dir(arm, b, mapped=None):
    """World direction of a rest bone toward its (mapped) child joint, else along the bone."""
    kids = [c for c in b.children if mapped is None or c.name in mapped] or list(b.children)
    M = arm.matrix_world
    if kids:
        d = (M @ kids[0].head_local) - (M @ b.head_local)
        if d.length > 1e-6:
            return d.normalized()
    return (M.to_3x3() @ (b.matrix_local.to_3x3() @ Vector((0, 1, 0)))).normalized()


def _order(rig, names):
    out = []

    def walk(b):
        if b.name in names:
            out.append(b.name)
        for c in b.children:
            walk(c)
    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return out


def copy_rotations(src, rig, mapping, src_hips, hips, times):
    """Key the target at frames 1..len(times) from the source at `times` (plain world-delta copy, see the module doc)."""
    sc = bpy.context.scene
    order = _order(rig, set(mapping))
    src_names = set(mapping.values())
    Ms, Mt = src.matrix_world, rig.matrix_world
    rest_s = {t: (Ms @ src.data.bones[s].matrix_local).to_3x3().normalized() for t, s in mapping.items()}
    rest_t = {t: (Mt @ rig.data.bones[t].matrix_local).to_3x3().normalized() for t in mapping}
    align = {t: _dir(rig, rig.data.bones[t], set(mapping)).rotation_difference(
        _dir(src, src.data.bones[mapping[t]], src_names)).to_matrix() for t in mapping}
    hs0 = Ms @ src.data.bones[src_hips].head_local
    ht0 = Mt @ rig.data.bones[hips].head_local
    k = ht0.z / hs0.z if hs0.z > 1e-6 else 1.0
    act = bpy.data.actions.new('copy')
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    prev = {}
    for i, t in enumerate(times):
        sc.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
        world = {}
        for tn in order:
            ps = src.pose.bones[mapping[tn]]
            Rs = (Ms @ ps.matrix).to_3x3().normalized()
            world[tn] = Rs @ rest_s[tn].inverted() @ align[tn] @ rest_t[tn]
        hs = Ms @ src.pose.bones[src_hips].head
        for tn in order:  # parents first: each bone's head follows its already-posed parent
            pb = rig.pose.bones[tn]
            bpy.context.view_layer.update()
            head = pb.matrix.translation.copy()
            if tn == hips:
                head = Mt.inverted() @ (ht0 + (hs - hs0) * k)
            R = Mt.inverted().to_3x3().normalized() @ world[tn]
            pb.matrix = Matrix.Translation(head) @ R.to_4x4()
        bpy.context.view_layer.update()
        for tn in order:
            pb = rig.pose.bones[tn]
            if i:  # the previous key's side: q and -q are one pose, but an interpolation across them spins the long way
                pb.rotation_quaternion = sampling.compatible(prev[tn], pb.rotation_quaternion)
            prev[tn] = list(pb.rotation_quaternion)
            pb.keyframe_insert('rotation_quaternion', frame=1 + i)
            if tn == hips:
                pb.keyframe_insert('location', frame=1 + i)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'
    return [float(1 + i) for i in range(len(times))]


def facing_turn(rig, feet, posed=False):
    """The turn about Z that makes the body face -Y (as the fitted rigs and the pack camera assume): the toes point
    forward, so the mean heel-to-toe direction on the ground is the facing. `posed` reads the current pose instead of
    the rest pose (a mocap source whose rest pose is not a standing pose, as Bandai's)."""
    M = rig.matrix_world
    bones = rig.pose.bones if posed else rig.data.bones
    at = (lambda b: b.head) if posed else (lambda b: b.head_local)
    d = sum(((M @ at(bones[toe])) - (M @ at(bones[foot])) for foot, toe in feet.values()), Vector())
    if d.xy.length < 1e-6:
        return 0.0
    return math.atan2(-1, 0) - math.atan2(d.y, d.x)


def ground(rig, ob):
    """Stand the rest-pose body on z = 0, where the fitted bodies stand and the camera puts origin_row: a vendor rig's
    origin is its own (Hyper3D's sits near the hips, which left its feet under the ground). Returns the lift."""
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    z = min((ev.matrix_world @ v.co).z for v in me.vertices)
    ev.to_mesh_clear()
    rig.data.pose_position = 'POSE'
    rig.location.z -= z
    bpy.context.view_layer.update()
    return -z


def setup(spec, n):
    """Load the rigged body and its motion. Returns (mesh, rig, sheet-frame times, per-frame (dx, dy) in-place offsets,
    report)."""
    rg, mo = spec['rigged'], spec.get('motion', {})
    ob, rig = load(rg['path'], rg.get('action') if mo.get('kind', 'own') == 'own' else None, rg.get('colour'))
    rig.rotation_mode = 'XYZ'
    pose = mo.get('kind') == 'pose'  # hand-keyed in a body facing -Y: the cell's turn comes after the keys
    rig.rotation_euler.z += facing_turn(rig, rg['feet']) + (0 if pose else math.radians(spec.get('rotz', 0)))
    lift = ground(rig, ob)  # before the copy: it reads the target's hip height from the grounded rest pose
    loop = mo.get('loop', mo.get('clip', 'walk') == 'walk')
    rep = {'rig': os.path.basename(rg['path']), 'kind': mo.get('kind', 'own'), 'sample': mo.get('sample', 'even'),
           'lift': lift}
    if pose:  # hand-keyed: no source clip, keyed 1..n in place
        import handpose
        w = spec.get('weapon') or {}
        roll = w.get('roll', weapon_roll(rig, w['bone']) if w else 0.0)
        axis = (Matrix.Rotation(math.radians(roll), 3, 'Y') @ Matrix.Rotation(math.radians(w.get('pitch', 0)), 3, 'Z')
                @ Vector((1, 0, 0)))
        zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
        ts = handpose.build(rig, spec, n, axis, max(zs) - min(zs))
        rig.rotation_euler.z += math.radians(spec.get('rotz', 0))
        bpy.context.view_layer.update()
        rep |= {'keys': len(mo['keys']), 'times': ts}
        return ob, rig, ts, [(0.0, 0.0)] * n, rep
    if mo.get('kind', 'own') == 'own':
        act = rig.animation_data.action
        f0, f1 = mo.get('frames') or act.frame_range
        ts = sampling.frames(mo, n, f0, f1, loop)
        rep |= {'action': act.name, 'frames': [f0, f1], 'times': ts}
        driver = rig
    else:
        new, src_actions = _import(mo['path'])
        src = next(o for o in new if o.type == 'ARMATURE')
        for o in new:
            if o is not src:
                bpy.data.objects.remove(o)
        src.animation_data_create()
        if mo.get('action'):
            src.animation_data.action = _action(mo['action'], src_actions)
        src.rotation_mode = 'XYZ'
        act = src.animation_data.action
        f0, f1 = mo.get('frames') or act.frame_range
        bpy.context.scene.frame_set(int(f0))
        src_feet = {k: [mo['map'][f], mo['map'][t]] for k, (f, t) in rg['feet'].items()}
        src.rotation_euler.z += facing_turn(src, src_feet, posed=True) + math.radians(mo.get('rotz', 0))
        bpy.context.view_layer.update()
        src_ts = sampling.frames(mo, n, f0, f1, loop)
        ts = copy_rotations(src, rig, mo['map'], mo['src_hips'], rg['hips'], src_ts)
        rep |= {'source': os.path.basename(mo['path']), 'action': act.name, 'frames': [f0, f1], 'times': src_ts,
                'map': mo['map']}
        driver = src
    offsets = [(0.0, 0.0)] * n
    if mo.get('in_place'):
        sc = bpy.context.scene
        hb = rig.pose.bones[rg['hips']]

        def track(t):
            sc.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
            p = rig.matrix_basis @ hb.head  # the hips in the rig's parent space, where its location lives
            return p.x, p.y
        if driver is rig:
            offsets = sampling.in_place(track, ts, f0, f1)
        else:  # copy: a held key pose must stay put through its hold
            offsets = sampling.in_place_keyed(track, src_ts, ts)
        rep['in_place'] = True
    if driver is not rig:
        bpy.data.objects.remove(driver)
    return ob, rig, ts, offsets, rep


def goto(rig, base, t, off):
    sc = bpy.context.scene
    sc.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
    rig.location = base + Vector((off[0], off[1], 0))


def foot_points(rig, feet):
    out = {}
    for s, (foot, toe) in feet.items():
        out[s] = {'heel': rig.matrix_world @ rig.pose.bones[foot].head, 'ball': rig.matrix_world @ rig.pose.bones[toe].head}
    return out


def weapon_roll(rig, bone):
    """Degrees about the hand bone that point a weapon held across the fist forward (-Y) in the rest pose: a vendor
    rig's hand roll is arbitrary, where the fitted rig's puts bone X across the fist."""
    R = (rig.matrix_world @ rig.data.bones[bone].matrix_local).to_3x3().normalized()
    t = R.inverted() @ Vector((0, -1, 0))
    return math.degrees(math.atan2(-t.z, t.x))


def weapon_length(rig, ob, length, body=1.8):
    """A weapon `length` sized for the fitted 1.8 m body, in the rig's units for this body: vendor rigs arrive at their
    own scale (Hyper3D's is about 1 m tall) and the weapon mesh inherits the armature's scale through its hand bone."""
    zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
    return length * (max(zs) - min(zs)) / body / rig.matrix_world.to_scale().z
