"""Fit views of a refitted glb: front, side, back, 3/4 at 384 px (Workbench, texture colours), one PNG strip.
blender.sh --python fitview.py -- <in.glb> <out.png>"""
import math, sys
import bpy
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 384
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.65)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
import numpy as np
from PIL import Image
tiles = []
for i, yaw in enumerate((0, 90, 180, 45)):
    r = 5; t = math.radians(yaw)
    cam.location = (r * math.sin(t), -r * math.cos(t), 0.95)
    cam.rotation_euler = (math.radians(90), 0, t)
    sc.render.filepath = f'/home/orangekid/.cache/ogm-armor-test/work/_fv{i}.png'
    bpy.ops.render.render(write_still=True)
    tiles.append(Image.open(sc.render.filepath).convert('RGB'))
W = Image.new('RGB', (384 * 4, 384))
for i, t in enumerate(tiles):
    W.paste(t, (384 * i, 0))
W.save(a[1])
