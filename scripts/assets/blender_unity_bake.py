"""Bake Unity base-color expressions using each source texture's UV mapping."""
import math

import bpy
import numpy as np


def expression_material(surface, uv_names):
    """Construct a Cycles emission shader for one resolved base-color expression."""
    material = bpy.data.materials.new('Unity bake source')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    images = []

    def constant(value):
        node = nodes.new('ShaderNodeValue')
        node.outputs[0].default_value = value
        return node.outputs[0]

    def math_node(operation, *inputs):
        node = nodes.new('ShaderNodeMath')
        node.operation = operation
        for index, value in enumerate(inputs):
            links.new(value, node.inputs[index])
        return node.outputs[0]

    def weight(value):
        if isinstance(value, (int, float)):
            if not math.isfinite(value):
                raise ValueError('invalid shader blend weight')
            result = constant(value)
            return [result] * 4
        if 'op' not in value:
            channel = value.get('channel')
            if channel not in (0, 1, 2, 3, 'rgb'):
                raise ValueError('invalid shader blend channel')
            channels = term(value['term'])
            result = channels[:3] + [constant(1)] if channel == 'rgb' else [channels[channel]] * 4
            return [math_node('SUBTRACT', constant(1), item) for item in result] if value.get('invert') else result
        args = [weight(arg) for arg in value['args']]
        op = value['op']
        if op == 'invert' and len(args) == 1:
            return [math_node('SUBTRACT', constant(1), item) for item in args[0]]
        # Cycles defines division by zero differently from the existing CPU
        # evaluator, so only accept a provably nonzero constant divisor.
        if op == 'divide' and (
            len(value['args']) != 2
            or not isinstance(value['args'][1], (int, float))
            or value['args'][1] == 0
        ):
            raise ValueError('unsupported shader division for mesh bake')
        operations = {'add': 'ADD', 'subtract': 'SUBTRACT', 'multiply': 'MULTIPLY', 'divide': 'DIVIDE'}
        if op in operations and len(args) == 2:
            return [math_node(operations[op], a, b) for a, b in zip(*args)]
        if op == 'clamp' and len(args) == 3:
            return [math_node('MINIMUM', math_node('MAXIMUM', a, b), c) for a, b, c in zip(*args)]
        if op == 'contrast' and len(args) == 2:
            midpoint = constant(0.5 ** 2.2)
            return [
                math_node('ADD', math_node('MULTIPLY', math_node('SUBTRACT', a, midpoint), b), midpoint)
                for a, b in zip(*args)
            ]
        raise ValueError('unsupported shader weight operation')

    def term(value):
        textures, paths, spaces = value['textures'], value['texturePaths'], value['textureSrgb']
        if len(textures) != len(paths) or len(textures) != len(spaces):
            raise ValueError('material texture references differ from resolved paths')
        channels = [constant(float(component)) for component in value['color']]
        for texture, path, srgb in zip(textures, paths, spaces):
            channel = texture.get('uv', 0)
            if type(channel) is not int or not 0 <= channel <= 7 or channel >= len(uv_names):
                raise ValueError('missing or unsupported Unity UV channel')
            image = bpy.data.images.load(path, check_existing=False)
            image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
            images.append(image)
            uv = nodes.new('ShaderNodeUVMap')
            uv.uv_map = uv_names[channel]
            coordinates = uv.outputs['UV']
            transform = texture.get('uvTransform')
            if transform is not None:
                if (
                    not isinstance(transform, list) or len(transform) != 6
                    or any(type(value) not in (int, float) or not math.isfinite(value) for value in transform)
                    or texture['scale'] != [1, 1] or texture['offset'] != [0, 0]
                ):
                    raise ValueError('invalid Unity texture UV transform')
                separate_uv = nodes.new('ShaderNodeSeparateXYZ')
                links.new(coordinates, separate_uv.inputs[0])
                combined_uv = nodes.new('ShaderNodeCombineXYZ')
                for row in range(2):
                    a, b, offset = transform[row * 3:row * 3 + 3]
                    first = math_node('MULTIPLY', separate_uv.outputs['X'], constant(a))
                    second = math_node('MULTIPLY', separate_uv.outputs['Y'], constant(b))
                    coordinate = math_node('ADD', math_node('ADD', first, second), constant(offset))
                    links.new(coordinate, combined_uv.inputs[row])
                coordinates = combined_uv.outputs[0]
            mapping = nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = (*texture['scale'], 1)
            mapping.inputs['Location'].default_value = (*texture['offset'], 0)
            links.new(coordinates, mapping.inputs['Vector'])
            sample = nodes.new('ShaderNodeTexImage')
            sample.image = image
            sample.extension = 'REPEAT'
            links.new(mapping.outputs['Vector'], sample.inputs['Vector'])
            separate = nodes.new('ShaderNodeSeparateColor')
            links.new(sample.outputs['Color'], separate.inputs[0])
            rgba = [separate.outputs[i] for i in range(3)] + [sample.outputs['Alpha']]
            channels = [math_node('MULTIPLY', left, right) for left, right in zip(channels, rgba)]
        for product in value.get('products', []):
            channels = [math_node('MULTIPLY', left, right) for left, right in zip(channels, term(product))]
        if 'scalarMask' in value:
            channels = [math_node('MULTIPLY', left, right) for left, right in zip(channels, weight(value['scalarMask']))]
        for blend in value.get('blends', []):
            if isinstance(blend['weight'], (int, float)) and not 0 <= blend['weight'] <= 1:
                raise ValueError('invalid shader blend weight')
            a, b, amount = term(blend['a']), term(blend['b']), weight(blend['weight'])
            channels = [
                math_node(
                    'MULTIPLY', channel,
                    math_node('ADD', math_node('MULTIPLY', left, math_node('SUBTRACT', constant(1), factor)), math_node('MULTIPLY', right, factor)),
                )
                for channel, left, right, factor in zip(channels, a, b, amount)
            ]
        adjustment = value.get('adjustment')
        if adjustment:
            amount = adjustment['amount']
            if adjustment['op'] == 'power' and amount > 0:
                channels[:3] = [math_node('POWER', component, constant(amount)) for component in channels[:3]]
            elif adjustment['op'] == 'saturation' and 0 <= amount <= 1:
                weights = [0.2126729, 0.7151522, 0.0721750]
                weighted = [math_node('MULTIPLY', component, constant(factor)) for component, factor in zip(channels, weights)]
                luma = math_node('ADD', math_node('ADD', weighted[0], weighted[1]), weighted[2])
                channels[:3] = [
                    math_node('ADD', luma, math_node('MULTIPLY', constant(amount), math_node('SUBTRACT', component, luma)))
                    for component in channels[:3]
                ]
            else:
                raise ValueError('unsupported Unity color adjustment')
        return channels

    rgba = term(surface)
    combine = nodes.new('ShaderNodeCombineColor')
    for index in range(3):
        links.new(rgba[index], combine.inputs[index])
    emission = nodes.new('ShaderNodeEmission')
    links.new(combine.outputs[0], emission.inputs['Color'])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(emission.outputs[0], output.inputs['Surface'])
    return material, images


def requires_mesh_bake(surfaces):
    """Return whether any one surface samples differing UV mappings."""
    def layers(term):
        result = list(term['textures'])
        for product in term.get('products', []):
            result.extend(layers(product))
        if 'scalarMask' in term:
            result.extend(weight_layers(term['scalarMask']))
        for blend in term.get('blends', []):
            result.extend(layers(blend['a']))
            result.extend(layers(blend['b']))
            result.extend(weight_layers(blend['weight']))
        return result

    def weight_layers(value):
        if isinstance(value, (int, float)):
            return []
        if 'op' in value:
            return [texture for arg in value['args'] for texture in weight_layers(arg)]
        return layers(value['term'])

    for surface in surfaces:
        textures = layers(surface)
        if surface.get('opacity'):
            textures.extend(layers(surface['opacity']))
        if textures:
            if any(texture.get('uvTransform') is not None for texture in textures):
                return True
            first = textures[0]
            if any(
                texture.get('uv', 0) != first.get('uv', 0)
                or texture['scale'] != first['scale']
                or texture['offset'] != first['offset']
                for texture in textures[1:]
            ):
                return True
    return False


def bake_mesh(obj, surfaces):
    """Bake all slots to a new non-overlapping UV layer, unique to this mesh."""
    if any(surface.get('opacity') for surface in surfaces):
        raise ValueError('unsupported transparent Unity material with mixed UV mappings')
    mesh = obj.data
    uv_names = [layer.name for layer in mesh.uv_layers]
    if not uv_names:
        raise ValueError('missing or unsupported Unity UV channel')
    if len(uv_names) >= 8:
        raise ValueError('mesh bake requires a spare UV layer')
    # Capture source layer names before adding a new layer or entering edit mode:
    # Blender can invalidate RNA layer handles during either operation.
    sources = [expression_material(surface, uv_names) for surface in surfaces]
    for _, images in sources:
        for image in images:
            if image.size[0] * image.size[1] > 16777216:
                raise ValueError('shader layer texture is too large to bake')
    bake_layer = mesh.uv_layers.new(name='OGM baked UV')
    if bake_layer is None:
        raise ValueError('cannot add a Unity mesh bake UV layer')
    bake_name = bake_layer.name
    mesh.uv_layers.active = bake_layer
    mesh.uv_layers[bake_name].active_render = True
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')
    outputs = []
    for index, (source, images) in enumerate(sources):
        width = max([256] + [image.size[0] for image in images])
        height = max([256] + [image.size[1] for image in images])
        if width * height > 16777216:
            raise ValueError('shader layer texture is too large to bake')
        image = bpy.data.images.new('Unity baked base color', width=width, height=height, alpha=True)
        image.colorspace_settings.name = 'Non-Color'
        target = source.node_tree.nodes.new('ShaderNodeTexImage')
        target.image = image
        source.node_tree.nodes.active = target
        mesh.materials[index] = source
        outputs.append(image)
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 1
    bpy.ops.object.bake(type='EMIT', margin=4, uv_layer=bake_name)
    for index, image in enumerate(outputs):
        pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape((-1, 4))
        if not np.all(np.isfinite(pixels)):
            raise ValueError('non-finite shader blend result')
        rgb = np.clip(pixels[:, :3], 0, 1)
        pixels[:, :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)
        image.colorspace_settings.name = 'sRGB'
        image.pixels.foreach_set(pixels.reshape(-1))
        image.update()
        image.pack()
        material = bpy.data.materials.new('Unity baked material')
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = bake_name
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        links.new(uv.outputs['UV'], texture.inputs['Vector'])
        links.new(texture.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
        mesh.materials[index] = material
    for source, images in sources:
        bpy.data.materials.remove(source)
        for image in images:
            bpy.data.images.remove(image)
    for name in uv_names:
        mesh.uv_layers.remove(mesh.uv_layers[name])
    mesh.uv_layers[bake_name].active_render = True
