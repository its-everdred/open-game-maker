"""Render material colours at the motion rig's camera and poses."""
import math
import os

import bpy


def render_albedo(sc, root, rows, frames, goto, out):
    """Cycles diffuse-colour pass, aligned with the colour frames, even for a workbench render."""
    engine, samples, nodes = sc.render.engine, sc.cycles.samples, sc.use_nodes
    denoise = sc.cycles.use_denoising
    sc.render.engine, sc.cycles.samples = 'CYCLES', 1
    sc.cycles.use_denoising = False
    sc.view_layers[0].use_pass_diffuse_color = True
    sc.use_nodes = True
    tree = sc.node_tree
    tree.nodes.clear()
    layer = tree.nodes.new('CompositorNodeRLayers')
    composite = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(layer.outputs['Image'], composite.inputs['Image'])
    target = tree.nodes.new('CompositorNodeOutputFile')
    target.base_path = os.path.join(out, '.albedo')
    target.format.file_format = 'PNG'
    target.format.color_mode = 'RGB'
    target.file_slots[0].path = 'alb_'
    tree.links.new(layer.outputs['DiffCol'], target.inputs[0])
    for row in rows:
        root.rotation_euler = (0, 0, math.radians(135 - 45 * row))
        for col in range(frames):
            goto(col)
            sc.render.filepath = os.path.join(target.base_path, 'render.png')
            bpy.ops.render.render(write_still=True)
            os.replace(os.path.join(target.base_path, f'alb_{sc.frame_current:04d}.png'),
                       os.path.join(out, f'alb_{row}_{col}.png'))
    sc.use_nodes = nodes
    sc.render.engine, sc.cycles.samples = engine, samples
    sc.cycles.use_denoising = denoise
