"""Local Blender cloth helper for baking a pinned mesh over collision objects.

Import from a Blender Python script; this module never opens or saves a file.
The caller owns the mesh, material, frame geometry, and output path.
"""
import bpy


def drape(obj, pin_indices, colliders, *, frames=45, quality=8, thickness=0.01):
    """Simulate and apply cloth on a mesh, returning the same object.

    Pin indices refer to vertices in the supplied mesh. Colliders must be mesh
    objects in the current scene. A caller should construct the cloth above the
    frame, with enough subdivisions to form folds, before invoking this helper.
    """
    pins = tuple(pin_indices)
    colliders = tuple(colliders)
    if obj.type != 'MESH' or obj.name not in bpy.context.scene.objects:
        raise ValueError('cloth must be a mesh in the current scene')
    if not pins or any(not isinstance(i, int) or i < 0 or i >= len(obj.data.vertices) for i in pins):
        raise ValueError('pin indices must name existing mesh vertices')
    if frames < 2 or quality < 1 or thickness <= 0:
        raise ValueError('frames must be >= 2, quality >= 1, and thickness > 0')
    if len(set(colliders)) != len(colliders):
        raise ValueError('colliders must be unique')
    if any(c == obj or c.type != 'MESH' or c.name not in bpy.context.scene.objects for c in colliders):
        raise ValueError('colliders must be other meshes in the current scene')
    if any(m.type == 'CLOTH' for m in obj.modifiers):
        raise ValueError('cloth object already has a cloth modifier')
    if any(m.type == 'COLLISION' for c in colliders for m in c.modifiers):
        raise ValueError('colliders must not already have collision modifiers')

    scene = bpy.context.scene
    previous_frame, previous_subframe, previous_end = scene.frame_current, scene.frame_subframe, scene.frame_end
    previous_active = bpy.context.view_layer.objects.active
    selected = list(bpy.context.selected_objects)
    group = obj.vertex_groups.new(name='drape pins')
    group_name = group.name
    added_collisions = []
    cloth = None
    collection = None
    try:
        group.add(list(pins), 1.0, 'REPLACE')
        collection = bpy.data.collections.new('drape colliders')
        scene.collection.children.link(collection)
        for collider in colliders:
            modifier = collider.modifiers.new('drape collision', 'COLLISION')
            old_thickness = collider.collision.thickness_outer
            added_collisions.append((collider, modifier, old_thickness))
            collection.objects.link(collider)
            collider.collision.thickness_outer = thickness
        cloth = obj.modifiers.new('drape cloth', 'CLOTH')
        cloth.settings.vertex_group_mass = group.name
        cloth.settings.quality = quality
        cloth.collision_settings.use_collision = bool(colliders)
        cloth.collision_settings.collection = collection
        cloth.point_cache.frame_start = 1
        cloth.point_cache.frame_end = frames
        scene.frame_end = max(previous_end, frames)
        for frame in range(1, frames + 1):
            scene.frame_set(frame)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=cloth.name)
        cloth = None
    finally:
        if cloth is not None and obj.modifiers.get(cloth.name):
            obj.modifiers.remove(cloth)
        for collider, modifier, old_thickness in added_collisions:
            collider.collision.thickness_outer = old_thickness
            collider.modifiers.remove(modifier)
        if collection is not None:
            bpy.data.collections.remove(collection)
        remaining_group = obj.vertex_groups.get(group_name)
        if remaining_group is not None:
            obj.vertex_groups.remove(remaining_group)
        scene.frame_end = previous_end
        scene.frame_set(previous_frame, subframe=previous_subframe)
        bpy.ops.object.select_all(action='DESELECT')
        for item in selected:
            item.select_set(True)
        bpy.context.view_layer.objects.active = previous_active
    return obj
