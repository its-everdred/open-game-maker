# Verify the exports on their own: report what stilt.glb contains (parsed from the file, independent of Blender's
# importer), import it into an empty scene and render a still and turntable frames from the IMPORTED data only,
# then import stilt.fbx into another empty scene and report bones, actions and size.
#   blender --background --python verify_glb.py -- [still] [turn] [fbx] [--frames N]
import bpy, sys, os, json, struct
from math import sin, cos, pi, radians
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
N = int(argv[argv.index('--frames') + 1]) if '--frames' in argv else 120
DO = [a for a in argv if a in ('still', 'turn', 'fbx')] or ['still', 'turn', 'fbx']
GLB = os.path.join(HERE, 'stilt.glb')
OUTD = os.path.join(HERE, 'renders')

with open(GLB, 'rb') as fh:
    fh.read(12)
    ln, _ = struct.unpack('<II', fh.read(8))
    g = json.loads(fh.read(ln))
print('GLB images', len(g.get('images', [])), [i.get('mimeType') for i in g.get('images', [])], 'textures', len(g.get('textures', [])),
      'materials', len(g['materials']), 'meshes', len(g['meshes']), 'joints', len(g['skins'][0]['joints']),
      'animations', [(a.get('name'), len(a['channels'])) for a in g.get('animations', [])])
for m in g['materials']:
    p = m.get('pbrMetallicRoughness', {})
    print('GLB mat %-22s tex=%s orm=%s normal=%s emissive=%s x%s' % (
        m['name'], 'baseColorTexture' in p, 'metallicRoughnessTexture' in p, 'normalTexture' in m,
        [round(v, 2) for v in m.get('emissiveFactor', [0, 0, 0])],
        m.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1)))
used = {t.get('texCoord', 0) for m in g['materials'] for t in
        [m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('normalTexture')] if t}
print('GLB textures read texCoord', sorted(used))


def studio(scn):
    w = bpy.data.worlds.new('World')
    scn.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    bg2 = nt.nodes.new('ShaderNodeBackground')
    mix = nt.nodes.new('ShaderNodeMixShader')
    lp = nt.nodes.new('ShaderNodeLightPath')
    bg.inputs['Color'].default_value = (0.62, 0.64, 0.68, 1)
    bg.inputs['Strength'].default_value = 0.5
    bg2.inputs['Color'].default_value = (0.215, 0.215, 0.215, 1)
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(bg2.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes['World Output'].inputs['Surface'])
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy, sun.angle = 1.8, radians(14)
    so = bpy.data.objects.new('Sun', sun)
    scn.collection.objects.link(so)
    so.rotation_euler = (radians(52), 0, radians(-38))
    cd = bpy.data.cameras.new('Camera')
    cd.clip_start, cd.clip_end = 0.5, 3000
    cam = bpy.data.objects.new('Camera', cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    scn.view_settings.view_transform = 'AgX'
    scn.render.image_settings.file_format = 'PNG'
    return cam, cd


if 'still' in DO or 'turn' in DO:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    scn = bpy.context.scene
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    print('GLB IMPORTED meshes', len(meshes), 'armatures', len([o for o in bpy.data.objects if o.type == 'ARMATURE']),
          'actions', sorted(a.name for a in bpy.data.actions), 'images', sorted(i.name for i in bpy.data.images if i.size[0] > 0),
          'size', [round(v, 2) for v in (hi - lo)])
    for o in bpy.data.objects:                      # rest pose for the pictures
        if o.type == 'ARMATURE' and o.animation_data:
            o.animation_data.action = None
            for tr in o.animation_data.nla_tracks:
                tr.mute = True
            for pb in o.pose.bones:
                pb.location = (0, 0, 0)
                pb.rotation_quaternion = (1, 0, 0, 0)
                pb.scale = (1, 1, 1)
    cam, cd = studio(scn)

    def look(loc, target, lens=50):
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        cd.lens = lens
    scn.render.engine = 'BLENDER_EEVEE'
    try:
        scn.eevee.taa_render_samples = 32
        scn.eevee.use_raytracing = True
    except Exception as e:
        print('eevee opts', e)
    if 'still' in DO:
        scn.render.resolution_x, scn.render.resolution_y = 1200, 1600
        look((52, 44, 7), (0.5, 0, 14.8), 50)
        scn.render.filepath = os.path.join(OUTD, 'stilt_glb_reimport.png')
        bpy.ops.render.render(write_still=True)
        scn.render.resolution_x, scn.render.resolution_y = 1400, 1000
        look((13, 9, 24.5), (2.2, 1.0, 22.6), 45)
        scn.render.filepath = os.path.join(OUTD, 'stilt_glb_reimport_body.png')
        bpy.ops.render.render(write_still=True)
    if 'turn' in DO:
        scn.render.resolution_x, scn.render.resolution_y = 1080, 1350
        fd = os.path.join(OUTD, 'frames_glb')
        os.makedirs(fd, exist_ok=True)
        for f in range(N):
            a = 2 * pi * f / N + 0.7
            k = sin(pi * f / N) ** 2                 # push in on the body half way round
            r = 74 - 44 * k
            look((r * cos(a), r * sin(a), 9 + 13 * k), (0.5 * k, 0, 14.8 + 7.5 * k), 50)
            scn.render.filepath = os.path.join(fd, '%04d.png' % f)
            bpy.ops.render.render(write_still=True)
if 'fbx' in DO and os.path.exists(os.path.join(HERE, 'stilt.fbx')):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(HERE, 'stilt.fbx'))
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    print('FBX IMPORTED meshes', len(meshes), 'bones', len(arm.data.bones), 'armature scale', [round(v, 4) for v in arm.scale],
          'size (scene units)', [round(v, 2) for v in (hi - lo)], 'unit scale', bpy.context.scene.unit_settings.scale_length)
    for a in bpy.data.actions:
        print('FBX action', a.name, [round(v, 1) for v in a.frame_range])
print('VERIFIED', DO)
