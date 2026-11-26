"""Build a GLB from a validated Unity assembly plan in headless Blender.

Usage: blender --background --factory-startup --python-exit-code 1 --python
scripts/assets/blender_unity_assembly.py -- <plan.json> <output.glb>
"""
import json
from pathlib import Path
import sys
from uuid import uuid4

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


# Unity's left-handed Y-up coordinates become glTF's right-handed Y-up coordinates;
# Blender's exporter rotates its Z-up coordinates into glTF Y-up.
BASIS = Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def transform(node):
    position = Vector(node["position"])
    x, y, z, w = node["rotation"]
    rotation = Quaternion((w, x, y, z))
    if rotation.magnitude < 1e-8:
        raise ValueError("zero Unity rotation quaternion")
    rotation.normalize()
    scale = Matrix.Diagonal((*node["scale"], 1.0))
    return BASIS @ Matrix.Translation(position) @ rotation.to_matrix().to_4x4() @ scale @ BASIS.inverted()


def build_material(surface):
    material = bpy.data.materials.new(Path(surface["path"]).stem)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = surface["color"]
    if surface.get("blends"):
        return build_blended_material(material, surface)
    textures = surface["textures"]
    texture_paths = surface["texturePaths"]
    texture_srgb = surface["textureSrgb"]
    if len(textures) != len(texture_paths) or len(textures) != len(texture_srgb):
        raise ValueError("material texture references differ from resolved paths")
    if textures:
        if any(texture["scale"] != textures[0]["scale"] or texture["offset"] != textures[0]["offset"] for texture in textures):
            raise ValueError("cannot bake shader layers with different UV transforms")
        images = [bpy.data.images.load(path, check_existing=True) for path in texture_paths]
        for image, srgb in zip(images, texture_srgb):
            image.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
        if len(images) == 1 and texture_srgb[0] and surface["color"] == [1, 1, 1, 1]:
            baked = images[0]
        else:
            width = max(image.size[0] for image in images)
            height = max(image.size[1] for image in images)
            if width * height > 16777216:
                raise ValueError("shader layer texture is too large to bake")
            pixels = np.ones(width * height * 4, dtype=np.float32)
            for image, srgb in zip(images, texture_srgb):
                copy = image.copy()
                copy.scale(width, height)
                values = np.empty(width * height * 4, dtype=np.float32)
                copy.pixels.foreach_get(values)
                values = values.reshape((-1, 4))
                if srgb:
                    rgb = values[:, :3]
                    values[:, :3] = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
                pixels *= values.reshape(-1)
                bpy.data.images.remove(copy)
            pixels = pixels.reshape((-1, 4)) * np.asarray(surface["color"], dtype=np.float32)
            rgb = np.clip(pixels[:, :3], 0, 1)
            pixels[:, :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)
            pixels = pixels.reshape(-1)
            baked = bpy.data.images.new("Unity base color", width=width, height=height, alpha=True)
            baked.pixels.foreach_set(pixels)
            baked.update()
        baked.pack()
        image_node = nodes.new("ShaderNodeTexImage")
        image_node.image = baked
        image_node.extension = "REPEAT"
        coords = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (*textures[0]["scale"], 1)
        mapping.inputs["Location"].default_value = (*textures[0]["offset"], 0)
        links = material.node_tree.links
        links.new(coords.outputs["UV"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], image_node.inputs["Vector"])
        links.new(image_node.outputs["Color"], shader.inputs["Base Color"])
    return material


def build_blended_material(material, surface):
    """Bake a material expression in linear light using a shared UV transform."""
    layers = []

    def collect(term):
        textures, paths, spaces = term["textures"], term["texturePaths"], term["textureSrgb"]
        if len(textures) != len(paths) or len(textures) != len(spaces):
            raise ValueError("material texture references differ from resolved paths")
        layers.extend(zip(textures, paths, spaces))
        for blend in term.get("blends", []):
            if not 0 <= blend["weight"] <= 1:
                raise ValueError("invalid shader blend weight")
            collect(blend["a"])
            collect(blend["b"])

    collect(surface)
    if not layers:
        def constant(term):
            value = np.asarray(term["color"], dtype=np.float32)
            for blend in term.get("blends", []):
                weight = blend["weight"]
                value = value * (constant(blend["a"]) * (1 - weight) + constant(blend["b"]) * weight)
            return value
        material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = constant(surface)
        return material
    first = layers[0][0]
    if any(texture["scale"] != first["scale"] or texture["offset"] != first["offset"] for texture, _, _ in layers):
        raise ValueError("cannot bake shader layers with different UV transforms")
    images = [bpy.data.images.load(path, check_existing=True) for _, path, _ in layers]
    width, height = max(image.size[0] for image in images), max(image.size[1] for image in images)
    if width * height > 16777216:
        raise ValueError("shader layer texture is too large to bake")
    pixels_by_layer = iter(zip(images, (srgb for _, _, srgb in layers)))

    def evaluate(term):
        value = np.ones((width * height, 4), dtype=np.float32) * np.asarray(term["color"], dtype=np.float32)
        for _ in term["textures"]:
            image, srgb = next(pixels_by_layer)
            image.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
            copy = image.copy()
            copy.scale(width, height)
            pixels = np.empty(width * height * 4, dtype=np.float32)
            copy.pixels.foreach_get(pixels)
            pixels = pixels.reshape((-1, 4))
            if srgb:
                rgb = pixels[:, :3]
                pixels[:, :3] = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            value *= pixels
            bpy.data.images.remove(copy)
        for blend in term.get("blends", []):
            a, b, weight = evaluate(blend["a"]), evaluate(blend["b"]), blend["weight"]
            value *= a * (1 - weight) + b * weight
        return value

    pixels = evaluate(surface)
    rgb = np.clip(pixels[:, :3], 0, 1)
    pixels[:, :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)
    baked = bpy.data.images.new("Unity blended base color", width=width, height=height, alpha=True)
    baked.pixels.foreach_set(pixels.reshape(-1))
    baked.update()
    baked.pack()
    nodes, links = material.node_tree.nodes, material.node_tree.links
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = baked
    image_node.extension = "REPEAT"
    coords = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (*first["scale"], 1)
    mapping.inputs["Location"].default_value = (*first["offset"], 0)
    links.new(coords.outputs["UV"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], image_node.inputs["Vector"])
    links.new(image_node.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    return material


def import_model(path, cache):
    if path in cache:
        return cache[path]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_image_search=False)
    imported = set(bpy.data.objects) - before
    meshes = [(obj.name, obj.data.name, obj.data.copy(), obj.matrix_world.copy()) for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise ValueError(f"model contains no meshes: {path}")
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    cache[path] = meshes
    return meshes


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) != 2:
        raise ValueError("expected plan.json and output.glb")
    plan = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    if not isinstance(plan, list) or not plan:
        raise ValueError("empty assembly plan")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = {}
    reserved = f"__ogm_{uuid4().hex}_"
    names = []
    by_id = {node["transformId"]: node for node in plan}
    for index, node in enumerate(plan):
        key = node["transformId"]
        if key in objects:
            raise ValueError(f"duplicate transform: {key}")
        obj = bpy.data.objects.new(f"{reserved}transform_{index}", None)
        names.append((obj, node["name"] or key))
        bpy.context.scene.collection.objects.link(obj)
        objects[key] = obj
    for node in plan:
        obj = objects[node["transformId"]]
        parent = node["parentId"]
        if parent:
            obj.parent = objects[parent]
        obj.matrix_basis = transform(node)
    cache = {}
    materials = {}
    count = 0
    exported_meshes = []
    for node in plan:
        if not node.get("model") or not node["rendererActive"]:
            continue
        parent = node
        while parent:
            if not parent["active"]:
                break
            parent_id = parent["parentId"]
            parent = by_id[parent_id] if parent_id else None
        else:
            model = node["model"]
            candidates = [entry for entry in import_model(model["path"], cache) if model["name"] in entry[:2]]
            if len(candidates) != 1:
                raise ValueError(f"mesh name is missing or ambiguous: {model['name']}")
            _, _, mesh, matrix = candidates[0]
            mesh = mesh.copy()
            surfaces = node["surfaces"]
            if len(surfaces) != len(mesh.materials):
                raise ValueError(f"material slot count differs for {model['name']}")
            for index, surface in enumerate(surfaces):
                key = json.dumps(surface, sort_keys=True)
                if key not in materials:
                    materials[key] = build_material(surface)
                mesh.materials[index] = materials[key]
            obj = bpy.data.objects.new(f"{reserved}mesh_{count}", mesh)
            names.append((obj, node["name"] or model["name"]))
            bpy.context.scene.collection.objects.link(obj)
            obj.parent = objects[node["transformId"]]
            obj.matrix_basis = matrix
            exported_meshes.append(obj)
            count += 1
    if not count:
        raise ValueError("assembly contains no active meshes")
    # Rename only after all FBX files have been imported: otherwise Blender
    # suffixes their source object names before we can resolve Unity's mesh name.
    for obj, name in names:
        obj.name = name
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(corner) for obj in exported_meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    offset = Vector((-(minimum.x + maximum.x) / 2, -(minimum.y + maximum.y) / 2, -minimum.z))
    for obj in objects.values():
        if obj.parent is None:
            obj.location += offset
    output = Path(args[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True, export_animations=False)
    if not output.is_file() or not output.stat().st_size:
        raise ValueError("GLB exporter wrote no output")
    print(json.dumps({"meshes": count, "materials": len(materials), "bytes": output.stat().st_size}))


main()
