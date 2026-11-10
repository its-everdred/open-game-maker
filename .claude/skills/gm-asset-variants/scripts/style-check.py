#!/usr/bin/env python3
"""Flag added meshes in a variant GLB that won't match their pack's style.

Usage: style-check.py <variant.glb> [<source.glb> ...]
Meshes that also appear in a source GLB (same name) are the pack's own. Every other mesh is "added" and gets checked
against the pack's numbers:
  - shading: vertices per triangle. Pack meshes share vertices (KayKit 0.7-1.0) and so shade smooth and round. Above
    1.5 means mostly unshared vertices: flat facets that read as rigid and boxy (3.00 = fully flat).
  - colour: a pack that colours from a texture atlas gets atlas-textured parts, not new flat-colour materials.
  - density: triangles per unit of bounding-box area, against the pack meshes' median. Far below means a coarse,
    blocky silhouette.
Exits 1 when any added mesh fails. It doesn't replace the close-up; it catches the faults that make a part look added.
"""
import json
import statistics
import struct
import sys


def load(path):
    data = open(path, 'rb').read()
    if not data.startswith(b'glTF'):
        return json.loads(data)
    length = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + length])


def meshes(doc):
    acc, mats = doc['accessors'], doc.get('materials', [])
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            pos = acc[prim['attributes']['POSITION']]
            tris = (acc[prim['indices']]['count'] if 'indices' in prim else pos['count']) // 3
            mat = mats[prim['material']] if 'material' in prim else {}
            textured = 'baseColorTexture' in mat.get('pbrMetallicRoughness', {})
            size = [hi - lo for hi, lo in zip(pos['max'], pos['min'])]
            area = 2 * (size[0] * size[1] + size[1] * size[2] + size[0] * size[2]) or 1e-9
            yield {'name': mesh.get('name') or '?', 'tris': tris, 'vpt': pos['count'] / max(tris, 1),
                   'textured': textured, 'density': tris / area}


def main(variant, sources):
    pack_names = {m['name'] for s in sources for m in meshes(load(s))}
    rows = list(meshes(load(variant)))
    pack = [r for r in rows if r['name'] in pack_names] or rows
    added = [r for r in rows if r['name'] not in pack_names] if sources else []
    atlas = any(r['textured'] for r in pack)
    median_density = statistics.median(r['density'] for r in pack)
    print(f"pack meshes: {len(pack)}, verts/tri {min(r['vpt'] for r in pack):.2f}-{max(r['vpt'] for r in pack):.2f}, "
          f"{'atlas texture' if atlas else 'flat colours'}, median density {median_density:.0f}")
    failed = False
    for r in added:
        faults = []
        if r['vpt'] > 1.5:
            faults.append(f"flat-shaded ({r['vpt']:.2f} verts/tri): merge vertices and smooth the normals")
        if atlas and not r['textured']:
            faults.append('flat-colour material: UV-map onto swatches of the pack atlas instead')
        if r['density'] < 0.25 * median_density:
            faults.append(f"coarse ({r['density']:.0f} vs {median_density:.0f}): add segments or bevels")
        failed |= bool(faults)
        print(f"{'FAIL' if faults else 'ok  '} {r['name']} ({r['tris']} tris)" + ''.join(f"\n     - {f}" for f in faults))
    if not sources:
        print('no source GLB given: pass the pack model(s) the variant was made from to check the added meshes')
    return 1 if failed else 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2:]))
