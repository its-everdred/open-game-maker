"""Refit a Quaternius outfit (UE-named rig, T-pose) onto one of our hero base bodies on the Meshy mixamo rig.

blender.sh --python refit.py -- <outfit.gltf> <body.glb|meshy> <out.glb> [key=value ...]
  body = 'meshy' uses the Meshy-rigged warrior-m as it is; a static TRELLIS glb is rigged first by stretching the
  Meshy armature to its box and Robust-Weight-Transferring the Meshy skin onto it.
  keys: height=1.8 (body height in rig units), offset=0.012, skin=drop|keep (the outfit's bare-skin arm faces),
        fit=ecf|none, idmesh=<out_id.glb> (also export a flat-ID-colour copy for the finish C material lines)
Steps: pose the outfit's own armature so each mapped joint lands on the body's joint (rotation + stretch), bake it;
Elastic Clothing Fit onto the body surface; Robust Weight Transfer of the body's mixamo weights; export rig + body +
outfit. Never writes into the pack.
"""
import json, math, os, sys
import bpy, numpy as np
from mathutils import Vector, Matrix

T = os.path.expanduser('~/.cache/ogm-armor-test/tools')
sys.path.insert(0, T); sys.path.insert(0, T + '/ecf')
import igl  # noqa: E402
if not hasattr(igl, 'barycentric_coordinates_tri'):
    igl.barycentric_coordinates_tri = igl.barycentric_coordinates
_mq = igl.min_quad_with_fixed
def _mq2(A_, B_, b_, bc_, Aeq_, Beq_, pd_):
    import scipy.sparse as _sp
    if Beq_.ndim == 1:
        Beq_ = np.zeros((0, B_.shape[1]))
    if Aeq_.shape[0] == 0:
        Aeq_ = _sp.csc_matrix((0, A_.shape[0]), dtype=np.float64)
    try:
        r = _mq(_sp.csc_matrix(A_, dtype=np.float64), np.ascontiguousarray(B_, dtype=np.float64), np.ascontiguousarray(b_, dtype=np.int64),
            np.ascontiguousarray(bc_, dtype=np.float64), _sp.csc_matrix(Aeq_, dtype=np.float64), Beq_, pd_)
    except RuntimeError as e:
        print('inpaint failed:', e)
        return False, np.zeros(B_.shape)
    return r if isinstance(r, tuple) else (True, r)
igl.min_quad_with_fixed = _mq2
from rwt import weighttransfer as wt  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
OUTFIT, BODY, OUT = argv[:3]
P = {'height': 1.8, 'offset': 0.012, 'fit_amount': 1.0, 'hide': 0.08, 'push': 2, 'skin': 'drop', 'fit': 'ecf', 'idmesh': ''}
for kv in argv[3:]:
    k, v = kv.split('=', 1); P[k] = v if k in ('skin', 'fit', 'idmesh') else float(v)
A = '/home/orangekid/games/open-game-maker-2000/assets-local/'
MESHY = A + 'experiments/sprite-pipeline/hero-anim/round3/gen/rigged_character_glb.glb'
REPORT = {}

bpy.ops.wm.read_factory_settings(use_empty=True)


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == 'MESH' and o.name.startswith('Icosphere')]:
        bpy.data.objects.remove(o); new.remove(o)
    return new


def box(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(c[i] for c in cs) for i in range(3)]), Vector([max(c[i] for c in cs) for i in range(3)])


def apply_all(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def arrs(o):
    me = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    me.calc_loop_triangles()
    V = np.array([o.matrix_world @ v.co for v in me.vertices], dtype=np.float64)
    N = np.array([(o.matrix_world.to_3x3() @ v.normal).normalized() for v in me.vertices], dtype=np.float64)
    F = np.array([t.vertices[:] for t in me.loop_triangles], dtype=np.int64)
    o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    N = np.nan_to_num(N); N[np.linalg.norm(N, axis=1) == 0] = (0, 0, 1)
    return V, F, N


def weights_of(o):
    W = np.zeros((len(o.data.vertices), len(o.vertex_groups)))
    for v in o.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    return W


def rwt(src, dst, maxd=0.06, ang=35.0):
    """Robust Weight Transfer (closest-surface match + weight inpainting + smoothing + 4-bone limit), src -> dst."""
    Vs, Fs, Ns = arrs(src); Vd, Fd, Nd = arrs(dst)
    Ws = weights_of(src)
    matched, W = wt.find_matches_closest_surface(Vs, Fs, Ns, Vd, Nd, Ws, maxd ** 2, ang, True)
    W0 = np.asarray(W, dtype=np.float64)
    ok, W = wt.inpaint(Vd, Fd, W0, matched, False)
    REPORT.setdefault('inpaint', []).append('mesh' if ok else 'mesh failed')
    if not ok:
        ok, W = wt.inpaint(Vd, Fd, W0, matched, True)
        REPORT['inpaint'].append('point' if ok else 'point failed: closest-surface weights')
    if not ok:
        W, matched = W0, np.ones(len(Vd), bool)
    import scipy.sparse as sp
    me = dst.data
    ed = np.array([e.vertices[:] for e in me.edges], dtype=np.int64)
    n = len(me.vertices)
    adj = sp.coo_matrix((np.ones(len(ed) * 2), (np.r_[ed[:, 0], ed[:, 1]], np.r_[ed[:, 1], ed[:, 0]])), shape=(n, n)).tocsr()
    adj = sp.csr_array(adj + sp.identity(n, format='csr'))
    adjl = [[] for _ in range(n)]
    for a, b in ed:
        adjl[a].append(b); adjl[b].append(a)
    W = np.asarray(wt.smooth_weigths(Vd, W, matched, adj, adjl, 4, 0.2, maxd))
    W[W <= 1e-4] = 0
    mask = wt.limit_mask(W, adj, limit_num=4)
    W = (1 - mask) * W; W[W <= 1e-4] = 0
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-8)
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    for i, g in enumerate(src.vertex_groups):
        col = W[:, i]
        nz = np.nonzero(col)[0]
        if len(nz) == 0:
            continue
        vg = dst.vertex_groups.new(name=g.name)
        for vi in nz:
            vg.add([int(vi)], float(col[vi]), 'REPLACE')
    return float(matched.mean())


# ---------------------------------------------------------------- body on the Meshy rig
mesh_new = imp(MESHY)
rig = next(o for o in mesh_new if o.type == 'ARMATURE')
donor = next(o for o in mesh_new if o.type == 'MESH')
bpy.context.view_layer.update()
dmn, dmx = box(donor)
if BODY == 'meshy':
    body = donor
else:
    body = next(o for o in imp(BODY) if o.type == 'MESH')
    apply_all(body)
    bmn, bmx = box(body)
    s = P['height'] / (bmx.z - bmn.z)
    body.scale = (s, s, s); apply_all(body)
    bmn, bmx = box(body)
    dc = (dmn + dmx) / 2
    body.location = (dc.x - (bmn.x + bmx.x) / 2, dc.y - (bmn.y + bmx.y) / 2, dmn.z - bmn.z); apply_all(body)
    bmn, bmx = box(body)
    # stretch the Meshy armature and skin to this body's box (about the donor's centre, feet fixed)
    S = Vector(((bmx.x - bmn.x) / (dmx.x - dmn.x), (bmx.y - bmn.y) / (dmx.y - dmn.y), (bmx.z - bmn.z) / (dmx.z - dmn.z)))
    REPORT['rig_stretch'] = [round(x, 3) for x in S]
    M = Matrix.Translation(Vector((dc.x, dc.y, dmn.z))) @ Matrix.Diagonal((*S, 1)) @ Matrix.Translation(-Vector((dc.x, dc.y, dmn.z)))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in rig.data.edit_bones:
        eb.head = rig.matrix_world.inverted() @ (M @ (rig.matrix_world @ eb.head))
        eb.tail = rig.matrix_world.inverted() @ (M @ (rig.matrix_world @ eb.tail))
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in donor.data.vertices:
        v.co = donor.matrix_world.inverted() @ (M @ (donor.matrix_world @ v.co))
    donor.data.update()
    for m in [m for m in donor.modifiers if m.type == 'ARMATURE']:
        m.show_viewport = False
    REPORT['body_skin_matched'] = rwt(donor, body)
    bpy.data.objects.remove(donor)
    body.parent = rig
    md = body.modifiers.new('Armature', 'ARMATURE'); md.object = rig
bpy.context.view_layer.update()
bmn, bmx = box(body)
REPORT['body_box'] = [[round(x, 3) for x in bmn], [round(x, 3) for x in bmx]]


def jw(arm, name, end='head'):
    b = arm.data.bones[name]
    return arm.matrix_world @ (b.head_local if end == 'head' else b.tail_local)


# ---------------------------------------------------------------- outfit: pose its rig onto the body's joints
onew = imp(OUTFIT)
qarm = next(o for o in onew if o.type == 'ARMATURE')
parts = [o for o in onew if o.type == 'MESH']
mx = 'mixamorig:'
# outfit bone -> (body joint at its head, body joint at its tail or None = keep the body bone's own direction)
MAP = {'pelvis': ('Hips', 'Spine'), 'spine_01': ('Spine', 'Spine1'), 'spine_02': ('Spine1', 'Spine2'),
       'spine_03': ('Spine2', 'Neck'), 'neck_01': ('Neck', 'Head'), 'Head': ('Head', None)}
for s, S_ in (('l', 'Left'), ('r', 'Right')):
    MAP.update({f'clavicle_{s}': (f'{S_}Shoulder', f'{S_}Arm'), f'upperarm_{s}': (f'{S_}Arm', f'{S_}ForeArm'),
                f'lowerarm_{s}': (f'{S_}ForeArm', f'{S_}Hand'), f'hand_{s}': (f'{S_}Hand', None),
                f'thigh_{s}': (f'{S_}UpLeg', f'{S_}Leg'), f'calf_{s}': (f'{S_}Leg', f'{S_}Foot'),
                f'foot_{s}': (f'{S_}Foot', f'{S_}ToeBase'), f'ball_{s}': (f'{S_}ToeBase', None)})
# which side is the outfit's left? compare x signs of the two rigs' left upper arms
qside = jw(qarm, 'upperarm_l').x; bside = jw(rig, mx + 'LeftArm').x
REPORT['outfit_left_x'], REPORT['body_left_x'] = round(qside, 3), round(bside, 3)
flip_lr = (qside > 0) != (bside > 0)
REPORT['flip_lr'] = flip_lr
if flip_lr:
    MAP = {k: tuple((x.replace('Left', '#').replace('Right', 'Left').replace('#', 'Right') if x else x) for x in v)
           for k, v in MAP.items()}
bpy.context.view_layer.objects.active = qarm
bpy.ops.object.mode_set(mode='EDIT')
for eb in qarm.data.edit_bones:
    eb.inherit_scale = 'NONE'
bpy.ops.object.mode_set(mode='POSE')
order = [b.name for b in qarm.data.bones]  # parents come before children
qinv = qarm.matrix_world.inverted()
for name in order:
    if name not in MAP:
        continue
    h, t = MAP[name]
    pb = qarm.pose.bones[name]
    rest = pb.bone.matrix_local  # armature space
    rh, rt = rest.translation, rest @ Vector((0, pb.bone.length, 0))
    nh = qinv @ jw(rig, mx + h)
    if t:
        nt = qinv @ jw(rig, mx + t)
        L = (nt - nh).length / pb.bone.length
    else:
        d = (jw(rig, mx + h, 'tail') - jw(rig, mx + h)).normalized()
        nt = nh + (qinv.to_3x3() @ d) * pb.bone.length
        L = 1.0
    old = (rt - rh).normalized(); new = (nt - nh).normalized()
    R = old.rotation_difference(new).to_matrix().to_4x4()
    rot = R @ rest.to_3x3().to_4x4()
    Sc = Matrix.Diagonal((1, L, 1, 1)) if t else Matrix.Identity(4)
    pb.matrix = Matrix.Translation(nh) @ rot @ Sc
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')
REPORT['outfit_parts'] = [o.name for o in parts]
for o in parts:
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=m.name)
    o.parent = None
    o.matrix_world = o.matrix_world  # keep world
    apply_all(o)
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
bpy.data.objects.remove(qarm)
# the outfit's bare-skin faces (Quaternius base-body skin material) go: our body shows its own skin
if P['skin'] == 'drop':
    import bmesh
    for o in parts:
        idx = [i for i, m in enumerate(o.data.materials) if m and 'Regular' in m.name]
        if not idx:
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(o.data); bm.free()
        REPORT.setdefault('skin_dropped', []).append(o.name)
parts = [o for o in parts if len(o.data.vertices)]
# layer order (inner -> outer): each part remembers its layer so the push-out stacks shells instead of z-fighting
LAYER = (('Legs', 1.0), ('Feet', 1.6), ('Boots', 1.6), ('Arms_Bracer', 2.6), ('Arms', 1.6), ('Body_Belt', 3.4),
         ('Body', 2.2), ('Hood', 2.2), ('Pauldron', 3.4))
for o in parts:
    m = next((v for k, v in LAYER if k in o.name), 1.0)
    vg = o.vertex_groups.new(name='_layer'); vg.add(list(range(len(o.data.vertices))), m / 4.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
cloth = parts[0]; cloth.name = 'Outfit'
REPORT['outfit_verts'] = len(cloth.data.vertices)
cmn, cmx = box(cloth)
REPORT['outfit_box_prefit'] = [[round(x, 3) for x in cmn], [round(x, 3) for x in cmx]]

# ---------------------------------------------------------------- Elastic Clothing Fit
if P['fit'] == 'ecf':
    import elastic_fit
    from elastic_fit import updater as _u
    _u.check_for_update = lambda *a, **k: None
    elastic_fit.register()
    rig.data.pose_position = 'REST'
    p = bpy.context.scene.efit_props
    p.body_obj, p.clothing_obj = body, cloth
    p.offset, p.fit_amount = P['offset'], P['fit_amount']
    bpy.ops.object.select_all(action='DESELECT'); cloth.select_set(True); bpy.context.view_layer.objects.active = cloth
    r = bpy.ops.efit.fit()
    REPORT['ecf_fit'] = list(r)
    r = bpy.ops.efit.preview_apply()
    REPORT['ecf_apply'] = list(r)
    REPORT['ecf_props'] = {k: getattr(p, k) for k in ('offset', 'fit_amount') if hasattr(p, k)}
    for m in list(cloth.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
# push-out: any outfit vertex inside the body (or closer than offset) moves to the body surface + offset, then a light
# smooth over the moved vertices; ECF pulls loose cloth in but leaves cloth that starts inside a bulkier body there
if P['push'] > 0:
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    btree = BVHTree.FromObject(body, dg)
    mw = cloth.matrix_world; mi = mw.inverted()
    moved = 0
    li = cloth.vertex_groups['_layer'].index
    lay = [next((g.weight * 4.0 for g in v.groups if g.group == li), 1.0) for v in cloth.data.vertices]
    for it in range(int(P['push'])):
        for v in cloth.data.vertices:
            off = P['offset'] * lay[v.index]
            co = mw @ v.co
            loc, nrm, idx, d = btree.find_nearest(co, 0.25)
            if loc is None:
                continue
            s_ = (co - loc).dot(nrm)
            if s_ < off:
                v.co = mi @ (loc + nrm * off); moved += 1
        cloth.data.update()
        sm = cloth.modifiers.new('push_smooth', 'CORRECTIVE_SMOOTH'); sm.iterations = 3; sm.factor = 0.5
        bpy.ops.object.select_all(action='DESELECT'); cloth.select_set(True); bpy.context.view_layer.objects.active = cloth
        bpy.ops.object.modifier_apply(modifier=sm.name)
    REPORT['pushed_out'] = moved
cmn, cmx = box(cloth)
REPORT['outfit_box'] = [[round(x, 3) for x in cmn], [round(x, 3) for x in cmx]]

# ---------------------------------------------------------------- skin the outfit to the body's rig
src = body
REPORT['outfit_skin_matched'] = rwt(src, cloth, maxd=0.08, ang=60.0)
# hide body faces under the outfit (Quaternius readme: only the head is meant to show): a body vertex whose outward
# normal ray hits the outfit within `cover` is covered; faces with every vertex covered are deleted
if P['hide'] > 0:
    import bmesh
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(cloth, dg)
    bm = bmesh.new(); bm.from_mesh(body.data)
    mw = body.matrix_world; n3 = mw.to_3x3()
    cov = set()
    for v in bm.verts:
        co = mw @ v.co; nn = (n3 @ v.normal).normalized()
        hit = tree.ray_cast(co - nn * 0.002, nn, P['hide'])
        if hit[0] is None:
            hit = tree.ray_cast(co + nn * 0.002, -nn, P['hide'] * 0.5)
        if hit[0] is not None:
            cov.add(v.index)
    gone = [f for f in bm.faces if all(v.index in cov for v in f.verts)]
    REPORT['body_faces_hidden'] = f'{len(gone)}/{len(bm.faces)}'
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(body.data); bm.free()
cloth.parent = rig
md = cloth.modifiers.new('Armature', 'ARMATURE'); md.object = rig
for m in body.modifiers:
    if m.type == 'ARMATURE':
        m.show_viewport = True
rig.data.pose_position = 'POSE'
REPORT['height'] = round(max(cmx.z, bmx.z) - min(cmn.z, bmn.z), 3)
REPORT['body_height'] = round(bmx.z - bmn.z, 3)

bpy.ops.object.select_all(action='DESELECT')
for o in (rig, body, cloth):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_animations=False)

if P['idmesh']:
    # flat ID colours per material class (body skin, body undergarment, each outfit material) for finish C lines
    pal = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 1), (0, 1, 1), (1, .5, 0), (.5, 0, 1)]
    ids = {}
    def flat(name, c):
        m = bpy.data.materials.new('ID_' + name); m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = (*c, 1); e.inputs[1].default_value = 1
        o_ = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o_.inputs[0])
        return m
    k = 0
    for ob in (body, cloth):
        for i, m in enumerate(ob.data.materials):
            key = f'{ob.name}:{m.name if m else i}'
            ids[key] = pal[k % len(pal)]
            ob.data.materials[i] = flat(key, pal[k % len(pal)]); k += 1
    REPORT['id_colours'] = ids
    bpy.ops.export_scene.gltf(filepath=P['idmesh'], use_selection=True, export_format='GLB', export_animations=False)
print('REFIT ' + json.dumps(REPORT))
