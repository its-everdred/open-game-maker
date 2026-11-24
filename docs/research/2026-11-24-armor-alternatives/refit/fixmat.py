"""fixmat.py -- <in.glb> <out.glb>: outfit materials non-metallic (Quaternius ORM read as metal renders near black in Cycles)."""
import sys, bpy
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None or not m.name.startswith('MI_'):
        continue
    print('MAT', m.name, 'metallic linked', bool(b.inputs['Metallic'].links), round(b.inputs['Metallic'].default_value, 2))
    for l in list(b.inputs['Metallic'].links):
        m.node_tree.links.remove(l)
    b.inputs['Metallic'].default_value = 0.0
    tex = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and 'BaseColor' in (n.image.name if n.image else '')), None)
    if tex is not None:
        for l in list(b.inputs['Base Color'].links):
            m.node_tree.links.remove(l)
        m.node_tree.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        print('  base colour straight from', tex.image.name)
for o in bpy.data.objects:
    if o.type == 'MESH':
        while len(o.data.color_attributes):
            o.data.color_attributes.remove(o.data.color_attributes[0])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', export_animations=False, export_vertex_color='NONE')
