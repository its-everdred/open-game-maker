"""Blender-side assertions for vegetation blockout geometry."""
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_mesh import bush, cluster, conifer, tree
from vegetation_canopy import make_canopy
from vegetation_leaves import leaf_clusters
from vegetation_conifer import conifer_boughs
from vegetation_bush_detail import leaf_cards

bpy.ops.wm.read_factory_settings(use_empty=True)
bark = bpy.data.materials.new('bark')
foliage = bpy.data.materials.new('foliage')
objects = tree(7, bark, foliage, levels=2)
assert len(objects) == 11  # seven branches, four terminal canopy objects
assert sum(bark in list(obj.data.materials) for obj in objects) == 7
assert sum(foliage in list(obj.data.materials) for obj in objects) == 4
wide_tree = tree(7, bark, foliage, levels=1, fanout=3, spread=(0.7, 0.8))
assert len(wide_tree) == 7  # trunk, three branches, three canopies
assert len(conifer(7, bark, foliage, tiers=5)) == 6
assert len(bush(7, foliage)) == 9
compact = bush(7, foliage, count=15, mass_radius=.12)
assert len(compact) == 15
assert max(v.co.length for v in compact[0].data.vertices) < max(v.co.length for v in bush(7, foliage)[0].data.vertices)
shrub = bush(7, foliage)
detail = leaf_cards(shrub, (foliage, foliage, foliage), 7, per_mass=12)
assert len(detail.data.polygons) == 12 * len(shrub)
assert detail.visible_shadow is False
detail_again = leaf_cards(shrub, (foliage, foliage, foliage), 7, per_mass=12)
assert list(detail.data.vertices[0].co) == list(detail_again.data.vertices[0].co)
bare = tree(7, bark, foliage, levels=2, bare=True)
assert len(bare) == 7 and all(bark in list(obj.data.materials) for obj in bare)
foliage.use_nodes = True
first = make_canopy(7, foliage, leaf_count=32)
second = make_canopy(7, foliage, leaf_count=32)
other = make_canopy(8, foliage, leaf_count=32)
wide = make_canopy(7, foliage, leaf_count=32, shape=(2, 1, 1))
assert list(first.data.vertices[0].co) != list(wide.data.vertices[0].co)
dense_tree = tree(7, bark, foliage, levels=1, dense=True, leaf_count=32)
assert len(dense_tree) == 10 and len(dense_tree[-1].data.polygons) == 256
assert all(bark in list(obj.data.materials) for obj in dense_tree[3:9])
assert len(first.data.vertices) == 192 and len(first.data.polygons) == 256
assert list(first.data.vertices[0].co) == list(second.data.vertices[0].co)
assert list(first.data.vertices[0].co) != list(other.data.vertices[0].co)
leafy = leaf_clusters(7, foliage, count=3, extent=0.25, leaves_per_cluster=8)
repeat = leaf_clusters(7, foliage, count=3, extent=0.25, leaves_per_cluster=8)
narrow = leaf_clusters(7, foliage, count=3, extent=0.25, leaves_per_cluster=8, leaf_width=0.25)
different = leaf_clusters(8, foliage, count=3, extent=0.25, leaves_per_cluster=8)
assert len(leafy) == 3 and len(leafy[0].data.vertices) == 40 and len(leafy[0].data.polygons) == 32
assert list(leafy[0].data.vertices[0].co) == list(repeat[0].data.vertices[0].co)
assert list(leafy[0].data.vertices[1].co) != list(narrow[0].data.vertices[1].co)
assert list(leafy[0].data.vertices[0].co) != list(different[0].data.vertices[0].co)
foliage.node_tree.nodes.new('ShaderNodeValToRGB')
fir = conifer_boughs(7, bark, foliage, height=1, lean=0.1, tiers=4, spokes=5)
fir_repeat = conifer_boughs(7, bark, foliage, height=1, lean=0.1, tiers=4, spokes=5)
fir_other = conifer_boughs(8, bark, foliage, height=1, lean=0.1, tiers=4, spokes=5)
assert len(fir) == 2 and len(fir[1].data.polygons) == 4 * 5 * 4
assert list(fir[1].data.vertices[2].co) == list(fir_repeat[1].data.vertices[2].co)
assert list(fir[1].data.vertices[2].co) != list(fir_other[1].data.vertices[2].co)
assert len(set(face.material_index for face in fir[1].data.polygons)) > 1
shaded = leaf_clusters(7, foliage, count=3, extent=0.25, leaves_per_cluster=8, shade_variation=True)
shaded_again = leaf_clusters(7, foliage, count=3, extent=0.25, leaves_per_cluster=8, shade_variation=True)
assert list(leafy[0].data.vertices[0].co) == list(shaded[0].data.vertices[0].co)
indices = [face.material_index for face in shaded[0].data.polygons]
assert len(set(indices)) > 1
assert indices == [face.material_index for face in shaded_again[0].data.polygons]
assert all(len(set(indices[i:i+4])) == 1 for i in range(0, len(indices), 4))
assert len(cluster(7, foliage, count=5, leafy=True, leaves_per_cluster=8, batch_size=3, batch_radius=0.04)) == 5
assert leaf_clusters(7, foliage, count=0) == []
plants = cluster(7, foliage, count=6, extent=0.25)
assert len(plants) == 6
assert all(abs(obj.location.x) <= 0.25 and abs(obj.location.y) <= 0.25 for obj in plants)
