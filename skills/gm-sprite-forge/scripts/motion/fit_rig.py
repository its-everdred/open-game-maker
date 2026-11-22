"""Fit a Rigify basic-human metarig to a character mesh (Blender 4.3 module; arm A of the #1202 rig spike).

load_mesh(path, rotz) imports a GLB, joins it, faces it to -Y and normalises it to HEIGHT with the feet at z = 0.
landmarks(ob) finds joints from surface samples: the crotch from the gap between the legs, knees and ankles from leg
cross-sections, shoulders from the width jump below the head, elbows and wrists along each arm's own component.
metarig(lm) places the metarig bones on those joints; bind(ob, rig) skins with bone heat and, where heat leaves
vertices unweighted (non-manifold or fused meshes), re-solves on a voxel-remeshed proxy and transfers the weights.
"""
import math

import bmesh
import bpy
import mathutils
import numpy as np

HEIGHT = 1.8  # human scale: bone heat fails to solve on tiny meshes; the render rescales to the pack's pixel height


def load_mesh(path, rotz=0.0, max_faces=60000):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return prepare([o for o in bpy.data.objects if o not in before], rotz, max_faces)[0]


def prepare(new, rotz=0.0, max_faces=60000, apply_pose=False):
    """Join imported objects into one mesh, front -Y, feet at z = 0, height HEIGHT. Returns (mesh, matrix) where
    matrix maps the imported world space onto the normalised space (used to compare against a source skeleton)."""
    names = [o.name for o in new]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:  # we fit our own rig: drop the imported one, keeping its current pose only when asked
        for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
            if apply_pose:
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=m.name)
            else:
                o.modifiers.remove(m)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for name in names:  # joined meshes are already gone; remove the rest (armatures, empties)
        if name != ob.name and name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name])
    ob.vertex_groups.clear()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(ob.data.polygons) > max_faces:
        dec = ob.modifiers.new('dec', 'DECIMATE')
        dec.ratio = max_faces / len(ob.data.polygons)
        bpy.ops.object.modifier_apply(modifier='dec')
    rot = mathutils.Matrix.Rotation(math.radians(rotz), 4, 'Z')
    ob.data.transform(rot)
    v = verts(ob)
    lo, hi = v.min(0), v.max(0)
    s = HEIGHT / (hi[2] - lo[2])
    norm = mathutils.Matrix.Scale(s, 4) @ mathutils.Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
    ob.data.transform(norm)
    return ob, norm @ rot


def verts(ob):
    a = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def surface_samples(ob, n=200000, seed=0):
    """Area-weighted points on the surface: slices of a ring are filled in x, unlike sparse vertex bands."""
    me = ob.data
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, int)
    me.loop_triangles.foreach_get('vertices', tri)
    v = verts(ob)[tri.reshape(-1, 3)]
    area = np.linalg.norm(np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]), axis=1)
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(v), n, p=area / area.sum())
    r1, r2 = rng.random(n), rng.random(n)
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    t = v[pick]
    return t[:, 0] + r1[:, None] * (t[:, 1] - t[:, 0]) + r2[:, None] * (t[:, 2] - t[:, 0])


def _runs(occ):
    """(start, end) index pairs of the True runs in a 1-D boolean array."""
    out, start = [], None
    for i, o in enumerate(list(occ) + [False]):
        if o and start is None:
            start = i
        elif not o and start is not None:
            out.append((start, i - 1))
            start = None
    return out


def landmarks(ob, pts=None):
    """Joint positions (world, normalised mesh) keyed by name. Front is -Y, left is +X."""
    p = surface_samples(ob) if pts is None else pts
    H = p[:, 2].max()
    band = 0.006 * H
    binw = 0.005 * H

    def sl(z, lo=None, hi=None):
        m = np.abs(p[:, 2] - z) < band
        if lo is not None:
            m &= p[:, 0] > lo
        if hi is not None:
            m &= p[:, 0] < hi
        return p[m]

    # centre line: midway between the two feet (a fused shield or weapon pulls a torso median off centre)
    soles = p[p[:, 2] < 0.04 * H]
    edges = np.arange(soles[:, 0].min(), soles[:, 0].max() + 2 * binw, binw)
    runs = sorted(_runs(np.histogram(soles[:, 0], edges)[0] > 2), key=lambda r: r[1] - r[0], reverse=True)[:2]
    if len(runs) == 2:
        x0 = float(np.mean([(edges[r[0]] + edges[r[1] + 1]) / 2 for r in runs]))
    else:  # feet touching: the middle of the sole footprint
        x0 = float((edges[runs[0][0]] + edges[runs[0][1] + 1]) / 2)

    def central_run(z, reach=0.3 * H):
        """x extent of the occupied run that contains (or is nearest to) the body centre at height z."""
        s = sl(z, x0 - reach, x0 + reach)
        if not len(s):
            return None
        edges = np.arange(x0 - reach, x0 + reach + binw, binw)
        occ = np.histogram(s[:, 0], edges)[0] > 0
        runs = _runs(occ)
        c = int((x0 - edges[0]) / binw)
        best = min(runs, key=lambda r: 0 if r[0] <= c <= r[1] else min(abs(c - r[0]), abs(c - r[1])))
        return edges[best[0]], edges[best[1] + 1], s

    # crotch: lowest height above the shins where the middle stops being a gap. Fused image-to-3D thighs grow a web
    # whose depth rises slowly from the apex (Warrior: 0.33 H) to a full hip (0.46 H): the middle counts as a gap
    # until it is nearly as deep as a thigh.
    def middle_closed(z):
        s = sl(z, x0 - 0.2 * H, x0 + 0.2 * H)
        mid = s[np.abs(s[:, 0] - x0) < 0.012 * H]
        if len(mid) < 4:
            return False
        sides = [s[(np.abs(s[:, 0] - x0 - sg * 0.06 * H) < 0.02 * H)] for sg in (-1, 1)]
        thigh = min(np.ptp(q[:, 1]) if len(q) > 3 else 0 for q in sides)
        return np.ptp(mid[:, 1]) > 0.85 * thigh
    crotch, filled = None, 0
    for z in np.arange(0.12 * H, 0.65 * H, 0.005 * H):
        filled = filled + 1 if middle_closed(z) else 0
        if filled >= 3:
            crotch = z - 0.01 * H
            break
    if crotch is not None:
        # a skirt or kilt hem also closes the gap: the body flares above a hem but not above a real crotch
        above, below = central_run(crotch + 0.03 * H, 0.3 * H), central_run(crotch - 0.03 * H, 0.3 * H)
        legs = sl(crotch - 0.03 * H, x0 - 0.3 * H, x0 + 0.3 * H)
        if above and len(legs) and (above[1] - above[0]) > 1.25 * (np.ptp(legs[:, 0]) + binw):
            crotch = None
    lm_hem = crotch is None
    if crotch is None:
        crotch = 0.44 * H  # hidden under cloth: adult proportion (hip joint ~0.48 H)
    lm = {'H': H, 'x0': x0, 'crotch': float(crotch), 'crotch_hidden': lm_hem}

    for side, sgn in (('L', 1), ('R', -1)):
        def leg(z):
            s = sl(z, *((x0, x0 + 0.25 * H) if sgn > 0 else (x0 - 0.25 * H, x0)))
            s = s[np.abs(s[:, 0] - x0) < 0.2 * H]
            return s.mean(0) if len(s) else None
        top = leg(crotch - 0.04 * H)
        ank = leg(0.07 * H)
        hip = np.array([top[0], top[1], crotch + 0.04 * H])
        ankle = np.array([ank[0], ank[1], 0.065 * H])
        kz = ankle[2] + 0.53 * (hip[2] - ankle[2])
        k = leg(kz)
        line_y = ankle[1] + (hip[1] - ankle[1]) * 0.5
        knee = np.array([k[0], min(k[1], line_y - 0.004 * H), kz])  # a slight forward bend gives IK its plane
        foot = p[(p[:, 2] < 0.03 * H) & (sgn * (p[:, 0] - x0) > 0) & (np.abs(p[:, 0] - x0) < 0.25 * H)]
        toe_y = foot[:, 1].min() if len(foot) else ankle[1] - 0.08 * H
        heel_y = foot[:, 1].max() if len(foot) else ankle[1] + 0.03 * H
        lm[f'hip.{side}'], lm[f'knee.{side}'], lm[f'ankle.{side}'] = hip, knee, ankle
        lm[f'ball.{side}'] = np.array([ankle[0], ankle[1] + 0.66 * (toe_y - ankle[1]), 0.015 * H])
        lm[f'toe.{side}'] = np.array([ankle[0], toe_y, 0.015 * H])
        lm[f'heel.{side}'] = np.array([ankle[0], heel_y, 0.0])

    # shoulders: below the head the body widens sharply; the top of that jump is the shoulder line
    head_w = np.median([central_run(z, 0.2 * H)[1] - central_run(z, 0.2 * H)[0]
                        for z in np.arange(0.86 * H, 0.94 * H, 0.01 * H) if central_run(z, 0.2 * H)])
    shoulder_top = 0.8 * H
    for z in np.arange(0.95 * H, 0.55 * H, -0.005 * H):
        r = central_run(z, 0.45 * H)
        if r and r[1] - r[0] > 1.7 * head_w:
            shoulder_top = z
            break
    neck = shoulder_top + 0.02 * H
    lm['neck'] = np.array([x0, sl(neck, x0 - 0.1 * H, x0 + 0.1 * H)[:, 1].mean(), neck])
    lm['head_top'] = np.array([x0, lm['neck'][1], H])
    r = central_run(crotch + 0.14 * H, 0.3 * H)
    waist_half = max(r[1] - x0, x0 - r[0]) if r else 0.12 * H
    lm['waist_half'] = float(waist_half)
    chest = central_run(shoulder_top - 0.03 * H, 0.45 * H)
    chest_y = chest[2][:, 1].mean()
    lm['chest'] = np.array([x0, chest_y, shoulder_top - 0.1 * H])

    from scipy import ndimage
    vox = 0.01 * H
    for side, sgn in (('L', 1), ('R', -1)):
        half = (chest[1] - x0) if sgn > 0 else (x0 - chest[0])
        sh = np.array([x0 + sgn * max(half - 0.045 * H, waist_half * 0.8), chest_y, shoulder_top - 0.035 * H])
        # arm points: outside the waist (or outside the legs below the crotch), between the hips and the shoulder
        q = p[(sgn * (p[:, 0] - x0) > waist_half + 0.012 * H) & (p[:, 2] > crotch - 0.2 * H) & (p[:, 2] < shoulder_top)]
        q = q[np.linalg.norm(q - sh, axis=1) < 0.42 * H]  # a fused weapon must not stretch the arm
        if len(q) < 50:
            # arms fused to the torso: fall back to a hanging arm along the body side
            el = sh + np.array([sgn * 0.02 * H, 0.0, -0.16 * H])
            wr = el + np.array([sgn * 0.01 * H, -0.02 * H, -0.15 * H])
        else:
            ijk = np.floor((q - q.min(0)) / vox).astype(int)
            grid = np.zeros(ijk.max(0) + 1, bool)
            grid[tuple(ijk.T)] = True
            lab, _ = ndimage.label(ndimage.binary_dilation(grid))
            ids = lab[tuple(ijk.T)]
            near = ids[np.argsort(np.linalg.norm(q - sh, axis=1))[:30]]
            keep = ids == np.bincount(near[near > 0]).argmax()  # the component that touches the shoulder
            q = q[keep]
            d = np.linalg.norm(q - sh, axis=1)
            tip = d.max()
            wr = q[(d > tip - 0.085 * H) & (d < tip - 0.055 * H)].mean(0)
            dw = np.linalg.norm(wr - sh)
            el = q[np.abs(d - 0.53 * dw) < 0.02 * H].mean(0)  # upper arm a little longer than the forearm
            lm[f'hand_tip.{side}'] = q[d.argmax()]
        lm[f'shoulder.{side}'], lm[f'elbow.{side}'], lm[f'wrist.{side}'] = sh, el, wr
    return lm


def overlay(pts, lm, truth, out):
    """Front (x,z) and side (y,z) views: surface grey, rig joints green, fitted joints red."""
    from PIL import Image, ImageDraw
    S, H = 600, lm['H']
    im = Image.new('RGB', (2 * S, S), (20, 20, 24))
    dr = ImageDraw.Draw(im)
    def px(v, view):
        a = v[0] if view == 0 else v[1]
        return (view * S + S / 2 + a / H * S * 0.9, S - 20 - v[2] / H * S * 0.9)
    for p in pts[::3]:
        for view in (0, 1):
            dr.point(px(p, view), fill=(90, 90, 100))
    for view in (0, 1):
        for k, t in (truth or {}).items():
            x, y = px(t, view)
            dr.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(0, 255, 0))
        for k, v in lm.items():
            if hasattr(v, 'shape') and v.shape == (3,):
                x, y = px(v, view)
                dr.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 40, 40))
        xc = view * S + S / 2 + (lm['x0'] if view == 0 else 0) / H * S * 0.9
        dr.line((xc, 0, xc, S), fill=(40, 40, 120))
        yz = S - 20 - lm['crotch'] / H * S * 0.9
        dr.line((view * S, yz, view * S + S, yz), fill=(200, 200, 0))
    im.save(out)


def metarig(lm, name='rig'):
    """Rigify basic-human metarig with its deform bones moved onto the landmarks."""
    bpy.ops.preferences.addon_enable(module='rigify')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.armature_basic_human_metarig_add()
    rig = bpy.context.object
    rig.name = name
    H, x0, V = lm['H'], lm['x0'], mathutils.Vector
    pelvis = V(((lm['hip.L'] + lm['hip.R']) / 2).tolist())
    neck, top, chest = V(lm['neck'].tolist()), V(lm['head_top'].tolist()), V(lm['chest'].tolist())
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for nm in ('breast.L', 'breast.R', 'pelvis.L', 'pelvis.R'):
        eb.remove(eb[nm])
    spine = [pelvis + (chest - pelvis) * t for t in (0, 0.33, 0.66, 1.0)] + [neck]
    names = ['spine', 'spine.001', 'spine.002', 'spine.003']
    for i, nm in enumerate(names):
        eb[nm].head, eb[nm].tail = spine[i], spine[i + 1]
    eb['spine.004'].head, eb['spine.004'].tail = neck, neck + (top - neck) * 0.12
    eb['spine.005'].head, eb['spine.005'].tail = eb['spine.004'].tail, neck + (top - neck) * 0.22
    eb['spine.006'].head, eb['spine.006'].tail = eb['spine.005'].tail, top
    for s in ('L', 'R'):
        g = {k: V(lm[f'{k}.{s}'].tolist()) for k in ('hip', 'knee', 'ankle', 'ball', 'toe', 'heel',
                                                     'shoulder', 'elbow', 'wrist')}
        tip = V(lm[f'hand_tip.{s}'].tolist()) if f'hand_tip.{s}' in lm else g['wrist'] + (g['wrist'] - g['elbow']) * 0.35
        eb[f'thigh.{s}'].head, eb[f'thigh.{s}'].tail = g['hip'], g['knee']
        eb[f'shin.{s}'].head, eb[f'shin.{s}'].tail = g['knee'], g['ankle']
        eb[f'foot.{s}'].head, eb[f'foot.{s}'].tail = g['ankle'], g['ball']
        eb[f'toe.{s}'].head, eb[f'toe.{s}'].tail = g['ball'], g['toe']
        w = 0.05 * H * (1 if s == 'L' else -1)
        eb[f'heel.02.{s}'].head, eb[f'heel.02.{s}'].tail = g['heel'] - V((w / 2, 0, 0)), g['heel'] + V((w / 2, 0, 0))
        eb[f'shoulder.{s}'].head = V((x0 + (0.012 if s == 'L' else -0.012) * H, chest.y - 0.02 * H, g['shoulder'].z + 0.01 * H))
        eb[f'shoulder.{s}'].tail = g['shoulder']
        eb[f'upper_arm.{s}'].head, eb[f'upper_arm.{s}'].tail = g['shoulder'], g['elbow']
        eb[f'forearm.{s}'].head, eb[f'forearm.{s}'].tail = g['elbow'], g['wrist']
        eb[f'hand.{s}'].head, eb[f'hand.{s}'].tail = g['wrist'], g['wrist'] + (tip - g['wrist']) * 0.8
    for b in eb:  # rolls: knees and elbows bend about local X
        b.roll = 0
    bpy.ops.armature.select_all(action='SELECT')
    bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Y')  # front is -Y: X axes point sideways for every limb
    eb['heel.02.L'].use_deform = eb['heel.02.R'].use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def unweighted(ob):
    """Vertex indices whose deform weights sum to ~0 (bone heat failed to reach them)."""
    w = np.zeros(len(ob.data.vertices))
    for v in ob.data.vertices:
        w[v.index] = sum(g.weight for g in v.groups)
    return np.nonzero(w < 1e-3)[0]


def _heat(ob, rig):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def side_clean(ob, lm):
    """Fused legs: below the crotch, move the other leg's thigh/shin/foot/toe weight onto this side's bone."""
    x0, cz = lm['x0'], lm['crotch']
    idx = {g.name: g.index for g in ob.vertex_groups}
    name = {g.index: g.name for g in ob.vertex_groups}
    leg = {'thigh', 'shin', 'foot', 'toe'}
    for v in ob.data.vertices:
        if v.co.z > cz:
            continue
        own, other = ('L', 'R') if v.co.x > x0 else ('R', 'L')
        moves = [(e.group, e.weight) for e in v.groups if name[e.group].endswith('.' + other) and name[e.group][:-2] in leg]
        for gi, w in moves:
            ob.vertex_groups[gi].remove([v.index])
            mine = idx.get(name[gi][:-2] + '.' + own)
            if mine is not None:
                ob.vertex_groups[mine].add([v.index], w, 'ADD')


def bind(ob, rig, lm=None, voxel=None):
    """Bone-heat skin. Returns a report dict: method and how many vertices bone heat left unweighted."""
    _heat(ob, rig)
    miss = unweighted(ob)
    report = {'method': 'bone_heat', 'unweighted_after_heat': int(len(miss)), 'verts': len(ob.data.vertices)}
    if len(miss) > 0.002 * len(ob.data.vertices):
        # proxy: a closed voxel remesh, bone heat on it, weights transferred back by nearest face
        proxy = ob.copy()
        proxy.data = ob.data.copy()
        bpy.context.collection.objects.link(proxy)
        proxy.parent = None
        proxy.modifiers.clear()
        proxy.vertex_groups.clear()
        rm = proxy.modifiers.new('rm', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = voxel or 0.006 * HEIGHT
        bpy.context.view_layer.objects.active = proxy
        bpy.ops.object.modifier_apply(modifier='rm')
        _heat(proxy, rig)
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        for g in proxy.vertex_groups:
            ob.vertex_groups.new(name=g.name)
        dt = ob.modifiers.new('dt', 'DATA_TRANSFER')
        dt.object = proxy
        dt.use_vert_data = True
        dt.data_types_verts = {'VGROUP_WEIGHTS'}
        dt.vert_mapping = 'POLYINTERP_NEAREST'
        dt.layers_vgroup_select_src = 'ALL'
        dt.layers_vgroup_select_dst = 'NAME'
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_move_to_index(modifier='dt', index=0)
        bpy.ops.object.modifier_apply(modifier='dt')
        bpy.data.objects.remove(proxy)
        report.update(method='voxel_proxy_heat', unweighted_after_proxy=int(len(unweighted(ob))))
    if lm is not None:
        side_clean(ob, lm)
        report['side_clean'] = True
    return report


def fit(path, rotz=0.0, debug=None):
    ob = load_mesh(path, rotz)
    pts = surface_samples(ob)
    lm = landmarks(ob, pts)
    if debug:
        overlay(pts[::4], lm, None, debug)
    rig = metarig(lm)
    rep = bind(ob, rig, lm)
    return ob, rig, lm, rep
