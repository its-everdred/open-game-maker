"""Experimental seeded foliage geometry for the calibrated Blender rig."""
import math
import random

import bpy
from mathutils import Vector


def make_canopy(seed, material, *, height=1.35, leaf_count=24000, offset=(0, 0, 0),
                shape=(1.0, 1.0, 1.0), fine=False):
    """Build an irregular crown as a single mesh with grouped leaf shades."""
    if not math.isfinite(height) or height <= 0 or not isinstance(leaf_count, int) or not 1 <= leaf_count <= 100000:
        raise ValueError('height must be positive and leaf count must be 1..100000')
    if len(shape) != 3 or any(not math.isfinite(v) or v <= 0 for v in shape):
        raise ValueError('canopy shape needs three positive finite scales')
    if not material.use_nodes or material.node_tree is None:
        raise ValueError('foliage material must use nodes')
    rng = random.Random(seed + 7291)
    centres = []
    for _ in range(28):
        direction = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
        direction.normalize()
        radial = rng.random() ** (1 / 3)
        centres.append(Vector((direction.x * radial * height * 0.52 * shape[0] + offset[0],
                               direction.y * radial * height * 0.46 * shape[1] + offset[1],
                               direction.z * radial * height * 0.48 * shape[2] + height + offset[2])))
    vertices, faces = [], []
    for i in range(leaf_count):
        direction = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
        direction.normalize()
        point = centres[i % len(centres)] + direction * rng.random() ** (1 / 3) * height * (0.27 if fine else 0.23)
        size = height * rng.uniform(*((0.012, 0.022) if fine else (0.018, 0.035)))
        n = len(vertices)
        vertices.extend([point + Vector((size, 0, 0)), point + Vector((-size, 0, 0)),
                         point + Vector((0, size, 0)), point + Vector((0, -size, 0)),
                         point + Vector((0, 0, size)), point + Vector((0, 0, -size))])
        faces.extend([tuple(n + j for j in face) for face in
                      ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
                       (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5))])
    mesh = bpy.data.meshes.new('dense-crown')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    crown = bpy.data.objects.new('dense-crown', mesh)
    bpy.context.scene.collection.objects.link(crown)
    shades = (0.38, 0.50, 0.62, 0.74, 0.95, 1.25) if fine else (0.30, 0.42, 0.56, 0.70, 0.84, 1.0)
    for factor in shades:
        shade = material.copy()
        for node in shade.node_tree.nodes:
            if node.type == 'VALTORGB':
                for element in node.color_ramp.elements:
                    c = element.color
                    rgb = tuple(c[i] * factor for i in range(3))
                    if fine:
                        rgb = tuple(min(value, 1) for value in rgb)
                    element.color = (*rgb, 1)
        mesh.materials.append(shade)
    cluster_shades = [rng.randrange(len(shades)) for _ in centres]
    for face in mesh.polygons:
        face.material_index = cluster_shades[(face.index // 8) % len(centres)]
    return crown
