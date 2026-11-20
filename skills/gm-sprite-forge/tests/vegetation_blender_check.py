"""Blender-side assertions for vegetation blockout geometry."""
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_mesh import cluster, tree

bpy.ops.wm.read_factory_settings(use_empty=True)
bark = bpy.data.materials.new('bark')
foliage = bpy.data.materials.new('foliage')
objects = tree(7, bark, foliage, levels=2)
assert len(objects) == 11  # seven branches, four terminal canopy objects
assert sum(bark in list(obj.data.materials) for obj in objects) == 7
assert sum(foliage in list(obj.data.materials) for obj in objects) == 4
plants = cluster(7, foliage, count=6, extent=0.25)
assert len(plants) == 6
assert all(abs(obj.location.x) <= 0.25 and abs(obj.location.y) <= 0.25 for obj in plants)
