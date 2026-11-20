"""Build Blender geometry from vegetation layouts using rig-supplied materials.

This is a blockout primitive, not a fitted or approved pack style.
"""
import math

import bpy
from mathutils import Vector

from vegetation_layout import branches, placements


def tree(seed, bark, foliage, *, height=1.0, lean=0.1, levels=3, canopy_scale=1.0):
    """Create a tree with connected branches and a canopy at each outer tip."""
    skeleton = branches(seed, height=height, lean=lean, levels=levels)
    objects = []
    for branch in skeleton:
        start, end = Vector(branch.start), Vector(branch.end)
        delta = end - start
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=branch.radius,
                                        radius2=branch.radius * 0.6,
                                        depth=delta.length, location=(start + end) / 2)
        obj = bpy.context.object
        obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
        obj.data.materials.append(bark)
        objects.append(obj)
        if branch.depth == levels:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,
                                                  radius=height * 0.18 * canopy_scale,
                                                  location=end)
            obj = bpy.context.object
            obj.data.materials.append(foliage)
            bpy.ops.object.shade_smooth()
            objects.append(obj)
    return objects


def cluster(seed, material, *, count=5, extent=0.2, height=0.18):
    """Create independently rotated plant blades in a cluster or tile scatter."""
    objects = []
    for item in placements(seed, count, extent=extent):
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=height * 0.12 * item.scale,
                                        radius2=0, depth=height * item.scale,
                                        location=(item.x, item.y, height * item.scale / 2))
        obj = bpy.context.object
        obj.rotation_euler = (math.radians(12), 0, item.rotation)
        obj.data.materials.append(material)
        objects.append(obj)
    return objects
