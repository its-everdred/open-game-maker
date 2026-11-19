"""Post-render finishing to the SmallScaleInt sprite contract (no pack files touched).

Usage: finish.py <in.png> <out.png> [--shadow-alpha A]
- object pixels (alpha >= 128 and not near-black) -> alpha 255 (the pack's objects are hard-edged)
- other coloured partial-alpha pixels -> dropped (alpha 0)
- shadow pixels (near-black partial alpha) -> RGB (0,0,0); --shadow-alpha rescales their mean alpha to A
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402


def finish(a, shadow_alpha=None):
    a = a.copy()
    obj = sm.mask(a)
    al = a[..., 3]
    coloured_partial = (al > 0) & ~obj & (a[..., :3].max(-1) > 8)
    a[..., 3][obj] = 255
    a[coloured_partial] = 0
    sh = sm.shadow_mask(a)
    a[..., :3][sh] = 0
    if shadow_alpha and sh.any():
        f = shadow_alpha / a[..., 3][sh].mean()
        a[..., 3][sh] = np.clip(a[..., 3][sh] * f, 1, 254).astype(np.uint8)
    return a


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('inp')
    ap.add_argument('out')
    ap.add_argument('--shadow-alpha', type=float)
    x = ap.parse_args()
    Image.fromarray(finish(sm.load(x.inp), x.shadow_alpha)).save(x.out)
