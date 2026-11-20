"""Experimental seeded conifer bough geometry for the Blender rig."""
import math
import random

import bpy
from mathutils import Vector


def conifer_boughs(seed, bark, foliage, *, height=1.2, lean=0.1, tiers=14, spokes=8):
    """Build tapered trunk and overlapping, independently shaded radial boughs."""
    if (not all(math.isfinite(v) for v in (height, lean)) or height <= 0 or lean < 0
            or not isinstance(tiers, int) or not 2 <= tiers <= 24
            or not isinstance(spokes, int) or not 3 <= spokes <= 32):
        raise ValueError('invalid conifer dimensions, tiers or spokes')
    if not foliage.use_nodes or foliage.node_tree is None or not any(
            node.type == 'VALTORGB' for node in foliage.node_tree.nodes):
        raise ValueError('conifer foliage requires a node material with a color ramp')
    rng = random.Random(seed)
    trunk_start, trunk_end = Vector((0, 0, 0)), Vector((lean * height, 0, height))
    delta = trunk_end - trunk_start
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=height * 0.035, radius2=height * 0.008,
                                    depth=delta.length, location=(trunk_start + trunk_end) / 2)
    trunk = bpy.context.object
    trunk.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    trunk.data.materials.append(bark)
    vertices, faces = [], []
    for i in range(tiers):
        t = i / (tiers - 1)
        z = height * (0.16 + 0.83 * t)
        radius = height * (0.22 * (1 - t) + 0.018)
        for j in range(spokes):
            angle = math.tau * (j / spokes + (i % 2) / (2 * spokes) + rng.uniform(-0.025, 0.025))
            radial = Vector((math.cos(angle), math.sin(angle), 0))
            side = Vector((-radial.y, radial.x, 0))
            base = Vector((lean * z, 0, z))
            distance = radius * rng.uniform(0.8, 1.2)
            tip = base + radial * distance + Vector((0, 0, -height * 0.08 * (1 - t)))
            midpoint = base + radial * distance * 0.53
            width = distance * 0.55
            n = len(vertices)
            vertices.extend((base, midpoint + side * width, tip, midpoint - side * width,
                             midpoint + Vector((0, 0, height * 0.025))))
            faces.extend(((n, n+1, n+4), (n+1, n+2, n+4), (n+2, n+3, n+4), (n+3, n, n+4)))
    mesh = bpy.data.meshes.new('conifer-boughs')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('conifer-boughs', mesh)
    bpy.context.scene.collection.objects.link(obj)
    for factor in (0.3, 0.5, 0.7, 1.0):
        shade = foliage.copy()
        for node in shade.node_tree.nodes:
            if node.type == 'VALTORGB':
                for element in node.color_ramp.elements:
                    c = element.color
                    element.color = (c[0] * factor, c[1] * factor, c[2] * factor, 1)
        mesh.materials.append(shade)
    shade_rng = random.Random(seed ^ 0xF1A)
    choices = [shade_rng.randrange(4) for _ in range(len(faces) // 4)]
    for face in mesh.polygons:
        face.material_index = choices[face.index // 4]
    return [trunk, obj]
