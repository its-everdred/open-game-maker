"""Seeded, low-growing leaf clusters for the vegetation rig."""
import math
import random

import bpy
from mathutils import Vector

from vegetation_layout import placements


def leaf_clusters(seed, material, *, count=5, extent=0.2, height=0.18, leaves_per_cluster=12):
    """Build independently rotated clumps of folded, pointed leaves."""
    if (not math.isfinite(height) or height <= 0 or not isinstance(leaves_per_cluster, int)
            or not 1 <= leaves_per_cluster <= 64):
        raise ValueError('height must be positive and leaves per cluster must be 1..64')
    rng = random.Random(seed ^ 0x1EA5)
    objects = []
    for index, item in enumerate(placements(seed, count, extent=extent)):
        vertices, faces = [], []
        for leaf in range(leaves_per_cluster):
            angle = item.rotation + math.tau * (leaf / leaves_per_cluster + rng.uniform(-0.04, 0.04))
            direction = Vector((math.cos(angle), math.sin(angle), 0))
            side = Vector((-direction.y, direction.x, 0))
            length = height * item.scale * rng.uniform(0.65, 1.15)
            width = length * rng.uniform(0.20, 0.34)
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
        mesh.materials.append(material)
        objects.append(obj)
    return objects
