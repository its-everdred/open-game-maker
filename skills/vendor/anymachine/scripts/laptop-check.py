"""Sweep the hinge through its range and check the rig: no lid/base triangle intersections, clearance, limits honoured.

blender -b --python check.py -- --blend out/laptop.blend --out out/check.json [--step 1]
"""
import bpy, sys, json, math, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]


def opt(k, d=None, cast=str):
    return cast(argv[argv.index(k) + 1]) if k in argv else d


bpy.ops.wm.open_mainfile(filepath=os.path.abspath(opt("--blend")))
OUT = os.path.abspath(opt("--out"))
STEP = opt("--step", 1.0, float)
sc = bpy.context.scene
arm = bpy.data.objects["laptop_rig"]
arm.animation_data.action = None  # drive the parameter directly
MAX = arm["max_deg"]
fixed = [bpy.data.objects["base"]]
moving = [bpy.data.objects["lid"], bpy.data.objects["screen"]]


def world_tris(obs):
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in obs:
        oe = o.evaluated_get(dg)
        m = oe.to_mesh()
        mw = oe.matrix_world
        off = len(verts)
        verts += [mw @ v.co for v in m.vertices]
        m.calc_loop_triangles()
        polys += [tuple(off + i for i in t.vertices) for t in m.loop_triangles]
        oe.to_mesh_clear()
    return verts, polys


def set_open(v):
    arm["open"] = v
    arm.update_tag()
    sc.frame_set(1)
    bpy.context.view_layer.update()


def hinge_deg():
    pb = arm.pose.bones["lid_hinge"]
    # evaluated (post-constraint) rotation of the bone relative to its rest, about bone Y (= world X)
    m = (arm.data.bones["lid_hinge"].matrix_local.inverted() @ pb.matrix).to_3x3()
    return -math.degrees(math.atan2(m[0][2], m[2][2]))


bv, bp = world_tris(fixed)
base_bvh = BVHTree.FromPolygons(bv, bp)
rows, worst = [], None
deg = 0.0
while deg <= MAX + 1e-6:
    set_open(deg / MAX)
    mv, mp = world_tris(moving)
    lid_bvh = BVHTree.FromPolygons(mv, mp)
    hits = base_bvh.overlap(lid_bvh)
    # clearance: densely sample the lid's surface (vertices + triangle centroids) against the base
    samples = mv + [(mv[a] + mv[b] + mv[c]) / 3 for a, b, c in mp]
    clear = min(base_bvh.find_nearest(p)[3] for p in samples)
    rows.append({"deg_cmd": round(deg, 1), "deg_actual": round(hinge_deg(), 2), "tri_overlaps": len(hits),
                 "min_clearance_mm": round(clear * 1000, 3)})
    if worst is None or clear < worst["min_clearance_mm"] / 1000:
        worst = rows[-1]
    deg += STEP
# limits: the constraint must clamp a parameter driven past its range
set_open(1.4)
over = hinge_deg()
set_open(-0.3)
under = hinge_deg()
res = {"steps": len(rows), "any_overlap": any(r["tri_overlaps"] for r in rows),
       "overlap_degs": [r["deg_cmd"] for r in rows if r["tri_overlaps"]],
       "min_clearance_mm": min(r["min_clearance_mm"] for r in rows), "worst": worst,
       "clamp_open_1.4_deg": round(over, 2), "clamp_open_-0.3_deg": round(under, 2),
       "max_tracking_error_deg": round(max(abs(r["deg_actual"] - r["deg_cmd"]) for r in rows), 4),
       "rows": rows}
json.dump(res, open(OUT, "w"), indent=1)
print("CHECK", json.dumps({k: v for k, v in res.items() if k != "rows"}), flush=True)
