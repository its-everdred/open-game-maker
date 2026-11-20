"""Build Blender geometry from vegetation layouts using rig-supplied materials.

This is a blockout primitive, not a fitted or approved pack style.
"""
import math
import random

import bpy
from mathutils import Vector

from vegetation_layout import branches, clustered_placements, placements


def tree(seed, bark, foliage, *, height=1.0, lean=0.1, levels=3, canopy_scale=1.0, branch_radius=0.07, attachment_min=0.55,
         fanout=2, spread=(0.55, 0.85), bare=False, dense=False, leaf_count=24000, crown_shape=(1.0, 1.0, 1.0)):
    """Create a tree with connected branches and a canopy at each outer tip."""
    skeleton = branches(seed, height=height, radius=branch_radius, lean=lean, levels=levels, fanout=fanout, spread=spread, attachment_min=attachment_min)
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
        if branch.depth == levels and not bare and not dense:
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,
                                                  radius=height * 0.18 * canopy_scale,
                                                  location=end)
            obj = bpy.context.object
            obj.data.materials.append(foliage)
            bpy.ops.object.shade_smooth()
            objects.append(obj)
    if dense and not bare:
        from vegetation_canopy import make_canopy
        rng = random.Random(seed + 4181)
        for i in range(6):
            angle = math.tau * (i / 6 + rng.uniform(-0.04, 0.04))
            end = Vector((math.cos(angle) * height * rng.uniform(0.12, 0.20),
                          math.sin(angle) * height * rng.uniform(0.12, 0.20), 0.02))
            start = Vector((0, 0, height * 0.10))
            delta = end - start
            bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=height * 0.045, radius2=0,
                                            depth=delta.length, location=(start + end) / 2)
            root = bpy.context.object
            root.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
            root.data.materials.append(bark)
            objects.append(root)
        objects.append(make_canopy(seed, foliage, height=height, leaf_count=leaf_count,
                                   offset=skeleton[0].end[:2] + (0,),
                                   shape=tuple(canopy_scale * v for v in crown_shape)))
    return objects


def cluster(seed, material, *, count=5, extent=0.2, height=0.18, leafy=False, leaves_per_cluster=12, leaf_width=1.0, leaf_shading=False, batch_size=1, batch_radius=0.05):
    """Create independently rotated plant blades in a cluster or tile scatter."""
    if leafy:
        from vegetation_leaves import leaf_clusters
        return leaf_clusters(seed, material, count=count, extent=extent, height=height,
                             leaves_per_cluster=leaves_per_cluster, leaf_width=leaf_width, shade_variation=leaf_shading,
                             batch_size=batch_size, batch_radius=batch_radius)
    objects = []
    for item in clustered_placements(seed, count, extent=extent,
                                      batch_size=batch_size, batch_radius=batch_radius):
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=height * 0.12 * item.scale,
                                        radius2=0, depth=height * item.scale,
                                        location=(item.x, item.y, height * item.scale / 2))
        obj = bpy.context.object
        obj.rotation_euler = (math.radians(12), 0, item.rotation)
        obj.data.materials.append(material)
        objects.append(obj)
    return objects


def conifer(seed, bark, foliage, *, height=1.2, lean=0.1, tiers=5):
    """Build a seeded tapered conifer from overlapping, rotated crown tiers."""
    import random
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=height * 0.055,
                                    radius2=height * 0.025, depth=height,
                                    location=(0, 0, height / 2))
    trunk = bpy.context.object
    trunk.rotation_euler.y = lean
    trunk.data.materials.append(bark)
    objects = [trunk]
    for i in range(tiers):
        z = height * (0.32 + 0.12 * i)
        radius = height * (0.31 - i * 0.045) * rng.uniform(0.86, 1.12)
        bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=radius, radius2=0,
                                        depth=height * 0.42, location=(lean * z, 0, z))
        obj = bpy.context.object
        obj.rotation_euler.z = rng.uniform(0, math.tau)
        obj.data.materials.append(foliage)
        objects.append(obj)
    return objects


def bush(seed, foliage, *, scale=1.0):
    """Build a small seeded cluster of overlapping rounded shrub masses."""
    objects = []
    for item in placements(seed, 9, extent=0.16 * scale, min_scale=0.7, max_scale=1.2):
        radius = 0.15 * scale * item.scale
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius,
                                              location=(item.x, item.y, radius * 0.8))
        obj = bpy.context.object
        obj.data.materials.append(foliage)
        bpy.ops.object.shade_smooth()
        objects.append(obj)
    return objects
