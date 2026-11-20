"""Seeded three-dimensional leaf cards for rounded shrub masses."""
import math
import random

import bpy
from mathutils import Vector


def leaf_cards(objects, materials, seed, *, per_mass=700):
    """Build small varied cards on the upper surfaces of the supplied shrub masses."""
    if len(materials) != 3 or not isinstance(per_mass, int) or not 1 <= per_mass <= 2000:
        raise ValueError('leaf cards require three materials and 1–2000 cards per mass')
    rng = random.Random(seed + 1539)
    vertices, faces = [], []
    for obj in objects:
        radius = max(v.co.length for v in obj.data.vertices)
        center = obj.location.copy()
        for _ in range(per_mass):
            z = rng.uniform(-.1, 1)
            angle = rng.random() * math.tau
            v = math.sqrt(1 - z * z)
            normal = Vector((v * math.cos(angle), v * math.sin(angle), z))
            tangent = normal.cross(Vector((0, 0, 1)))
            if tangent.length < .001:
                continue
            tangent.normalize()
            other = normal.cross(tangent).normalized()
            angle2 = rng.random() * math.tau
            axis = tangent * math.cos(angle2) + other * math.sin(angle2)
            side = normal.cross(axis).normalized()
            pos = center + normal * radius * 1.04
            length = radius * rng.uniform(.10, .22)
            width = length * rng.uniform(.4, .65)
            start = len(vertices)
            vertices.extend((pos - axis * length * .5, pos + side * width,
                             pos + axis * length * .5, pos - side * width))
            faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new('leaf_detail')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    leaves = bpy.data.objects.new('leaf_detail', mesh)
    bpy.context.scene.collection.objects.link(leaves)
    leaves.visible_shadow = False
    for material in materials:
        mesh.materials.append(material)
    for poly in mesh.polygons:
        poly.material_index = rng.randrange(3)
    return leaves
