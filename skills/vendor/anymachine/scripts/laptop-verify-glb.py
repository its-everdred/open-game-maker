"""Re-import the exported GLB: list nodes/actions/extras and check the lid tip height at a few open_param times."""
import bpy, sys, json, math
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
print("OBJS", [(o.name, o.type, o.parent.name if o.parent else None, o.parent_bone) for o in bpy.data.objects])
print("ACTIONS", [(a.name, tuple(a.frame_range)) for a in bpy.data.actions])
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
print("EXTRAS", {k: (arm[k] if not isinstance(arm[k], str) else arm[k][:120]) for k in arm.keys()})
lid = bpy.data.objects["lid"]
act = next(a for a in bpy.data.actions if a.name.startswith("open_param"))
arm.animation_data.action = act
for f in (1, 7, 13, 19, 25):
    bpy.context.scene.frame_set(f)
    zs = [(lid.matrix_world @ v.co).z for v in lid.data.vertices]
    print(f"open={(f-1)/24:.2f} lid_top_z={max(zs):.3f}")
