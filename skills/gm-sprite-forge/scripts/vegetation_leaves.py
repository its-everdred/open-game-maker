"""Seeded, low-growing leaf clusters for the vegetation rig."""
import math
import random

import bpy
from mathutils import Vector

from vegetation_layout import clustered_placements


def leaf_clusters(seed, material, *, count=5, extent=0.2, height=0.18, leaves_per_cluster=12, leaf_width=1.0,
                  shade_variation=False, batch_size=1, batch_radius=0.05):
    """Build independently rotated clumps of folded, pointed leaves."""
    if (not math.isfinite(height) or height <= 0 or not isinstance(leaves_per_cluster, int)
            or not 1 <= leaves_per_cluster <= 64 or not math.isfinite(leaf_width) or leaf_width <= 0):
        raise ValueError('height must be positive and leaves per cluster must be 1..64')
    rng = random.Random(seed ^ 0x1EA5)
    shade_rng = random.Random(seed ^ 0x5ADE)
    shades = [material]
    if shade_variation:
        if not material.use_nodes or material.node_tree is None:
            raise ValueError('shaded foliage requires a node material with a color ramp')
        ramps = [node for node in material.node_tree.nodes if node.type == 'VALTORGB']
        if not ramps:
            raise ValueError('shaded foliage requires a node material with a color ramp')
        shades = []
        for factor in (0.14, 0.25, 0.4, 0.58, 0.76, 1.0):
            shade = material.copy()
            for node in shade.node_tree.nodes:
                if node.type == 'VALTORGB':
                    for element in node.color_ramp.elements:
                        c = element.color
                        element.color = (c[0] * factor, c[1] * factor, c[2] * factor, 1)
            shades.append(shade)
    objects = []
    for index, item in enumerate(clustered_placements(seed, count, extent=extent,
                                                       batch_size=batch_size, batch_radius=batch_radius)):
        vertices, faces, leaf_shades = [], [], []
        for leaf in range(leaves_per_cluster):
            leaf_shades.append(shade_rng.randrange(len(shades)))
            angle = item.rotation + math.tau * (leaf / leaves_per_cluster + rng.uniform(-0.04, 0.04))
            direction = Vector((math.cos(angle), math.sin(angle), 0))
            side = Vector((-direction.y, direction.x, 0))
            length = height * item.scale * rng.uniform(0.65, 1.15)
            width = length * rng.uniform(0.20, 0.34) * leaf_width
            base = Vector((item.x, item.y, height * 0.08))
            middle = base + direction * length * 0.50 + Vector((0, 0, height * rng.uniform(0.22, 0.45)))
            tip = base + direction * length + Vector((0, 0, height * rng.uniform(0.08, 0.30)))
            n = len(vertices)
            vertices.extend((base, middle + side * width, tip, middle - side * width,
                             middle + Vector((0, 0, height * 0.04))))
            faces.extend(((n, n+1, n+4), (n+1, n+2, n+4), (n+2, n+3, n+4), (n+3, n, n+4)))
        mesh = bpy.data.meshes.new(f'leaf-cluster-{index}')
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(f'leaf-cluster-{index}', mesh)
        bpy.context.scene.collection.objects.link(obj)
        for shade in shades:
            mesh.materials.append(shade)
        for face in mesh.polygons:
            face.material_index = leaf_shades[face.index // 4]
        objects.append(obj)
    return objects
