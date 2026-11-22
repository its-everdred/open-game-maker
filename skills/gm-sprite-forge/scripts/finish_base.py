"""Base-body colour pass (hero base bodies, #1202): finish_base.py <sheet.png> <pack sheet> <out.png>

A hero base body is bare skin and white undergarments. The pack L/a*b* histogram match (gpu_bake_finish --colour-ref)
maps the pack character's dark trousers and boots onto the bare legs as dark blotches, so this pass matches only the
skin: each pixel's a*b* moves toward the pack skin hue (the pack sheet's light warm pixels) in proportion to its own
chroma, and one global lightness scale matches the skin, so white undergarments stay white. Run it on a gpu_bake_finish
output made without --colour-ref. Use the pack class's Idle sheet as the reference: effect pixels (fire, sparks) in
an attack sheet are light and warm too.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402


def pack_skin(lab):
    """Skin is the light warm pixels; dark warm ones are coats and leather."""
    return (lab[..., 1] > 6) & (lab[..., 2] > 6) & (lab[..., 0] > 48)


def base_pass(sheet, ref):
    """sheet, ref: RGBA uint8 arrays. Returns the recoloured sheet and (warm, visible) pixel counts.

    No skin/cloth classes: a per-pixel split by chroma percentile (v1) sorted pale skin as cloth (grey blotches) and
    some cloth as skin (missing underwear; Kevin, 2026-11-22). Instead a*b* move toward the pack skin's median hue in
    proportion to each pixel's own chroma, so neutral cloth stays neutral and warm skin takes the pack hue, and one
    global L scale (0.85-1.25) matches the clearly warm pixels' median lightness to the pack skin."""
    a = sheet.copy()
    rl = rgb2lab(ref[sm.mask(ref)][:, :3][None] / 255)[0]
    rs = rl[pack_skin(rl)]
    obj = sm.mask(a)
    al = rgb2lab(a[obj][:, :3][None] / 255)[0]
    w = np.clip((np.hypot(al[:, 1], al[:, 2]) - 3) / 6, 0, 1)  # 0 for neutral cloth, 1 for clearly warm skin
    warm = w > 0.8
    ratio = float(np.clip(np.median(rs[:, 0]) / max(1e-3, np.median(al[warm, 0])), 0.85, 1.25))
    out = al.copy()
    out[:, 0] = np.clip(al[:, 0] * ratio, 0, 100)
    for k in (1, 2):
        out[:, k] = al[:, k] + w * (np.median(rs[:, k]) - np.median(al[warm, k]))
    a[obj, :3] = (np.clip(lab2rgb(out[None])[0], 0, 1) * 255).round().astype(np.uint8)
    return a, (int(warm.sum()), int(obj.sum()))


def main():
    out, (warm, visible) = base_pass(sm.load(sys.argv[1]), sm.load(sys.argv[2]))
    Image.fromarray(out).save(sys.argv[3])
    print('warm', warm, 'of', visible)


if __name__ == '__main__':
    main()
