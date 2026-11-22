"""Base-body colour pass (hero base bodies, #1202): finish_base.py <sheet.png> <pack sheet> <out.png>

A hero base body is bare skin and white undergarments. The pack L/a*b* histogram match (gpu_bake_finish --colour-ref)
maps the pack character's dark trousers and boots onto the bare legs as dark blotches, so this pass matches only the
skin: skin pixels are histogram-matched in CIELAB to the pack sheet's skin pixels (its light warm pixels), and the
undergarments keep their own shading, made off-white and never brighter than rendered. Run it on a gpu_bake_finish
output made without --colour-ref. Use the pack class's Idle sheet as the reference: effect pixels (fire, sparks) in
an attack sheet are light and warm too.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab
from skimage.exposure import match_histograms

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402


def pack_skin(lab):
    """Skin is the light warm pixels; dark warm ones are coats and leather."""
    return (lab[..., 1] > 6) & (lab[..., 2] > 6) & (lab[..., 0] > 48)


def base_pass(sheet, ref):
    """sheet, ref: RGBA uint8 arrays. Returns the recoloured sheet and (skin, garment) pixel counts."""
    a = sheet.copy()
    rl = rgb2lab(ref[sm.mask(ref)][:, :3][None] / 255)[0]
    rs = rl[pack_skin(rl)]
    obj = sm.mask(a)
    al = rgb2lab(a[obj][:, :3][None] / 255)[0]
    C = np.hypot(al[:, 1], al[:, 2])
    garment = (C < np.percentile(C, 45)) & (al[:, 0] > np.percentile(al[:, 0], 30))  # least chroma, not shadow
    sk = ~garment
    out = al.copy()
    out[sk] = match_histograms(al[sk][None], rs[None], channel_axis=-1)[0]
    ratio = np.median(out[sk][:, 0]) / max(1e-3, np.median(al[sk][:, 0]))
    out[garment, 0] = np.clip(al[garment, 0] * min(ratio, 1.0) * 0.9, 0, 100)
    out[garment, 1:] *= 0.6
    a[obj, :3] = (np.clip(lab2rgb(out[None])[0], 0, 1) * 255).round().astype(np.uint8)
    return a, (int(sk.sum()), int(garment.sum()))


def main():
    out, (skin, garment) = base_pass(sm.load(sys.argv[1]), sm.load(sys.argv[2]))
    Image.fromarray(out).save(sys.argv[3])
    print('skin', skin, 'garment', garment)


if __name__ == '__main__':
    main()
