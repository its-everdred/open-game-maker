"""Carve a visual-hull proxy mesh from a prop's four pack views (N/E/S/W) using the calibrated SmallScaleInt camera.

Usage: carve_hull.py <view_N.png> <view_E.png> <view_S.png> <view_W.png> <out.obj> [--res 160]
The camera matches blender_iso_rig.py: ortho, 60 deg from vertical, yaw 45 deg, 1 unit = 128/sqrt(2) px,
world origin at pixel (128, 208) in a 256 x 256 view. Each view is the object turned by a multiple of 90 deg about Z.
The pack's yaw order is unknown, so every cyclic order (both directions, 4 offsets) is tried; the one keeping the most
volume wins (a wrong order carves away most of the object). The OBJ's vertices are in blender_iso_rig world units, Z up.
The hull cannot see concavities: it is a proxy for silhouette, not the final model.
"""
import argparse
import math
import sys
from pathlib import Path

import numpy as np
from skimage import measure

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402

UNIT_PX = 128 / math.sqrt(2)


def rot_z(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def rot_x(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


CAM = rot_z(math.radians(45)) @ rot_x(math.radians(60))  # camera-to-world rotation (Blender XYZ euler)


def project(pts, yaw):
    """World points (N,3) of the object turned by `yaw` -> pixel (x, y)."""
    q = pts @ rot_z(yaw).T
    c = q @ CAM  # world -> camera coords (CAM is orthonormal: inverse = transpose)
    return 128 + c[:, 0] * UNIT_PX, 208 - c[:, 1] * UNIT_PX


def carve(masks, yaws, grid):
    keep = np.ones(len(grid), bool)
    for m, yaw in zip(masks, yaws):
        x, y = project(grid, yaw)
        xi, yi = np.round(x).astype(int), np.round(y).astype(int)
        inside = (xi >= 0) & (xi < 256) & (yi >= 0) & (yi < 256)
        ok = np.zeros(len(grid), bool)
        ok[inside] = m[yi[inside], xi[inside]]
        keep &= ok
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('views', nargs=4)
    ap.add_argument('out')
    ap.add_argument('--res', type=int, default=160)
    a = ap.parse_args()
    masks = [sm.mask(sm.load(v)) for v in a.views]
    n = a.res
    xs = np.linspace(-1.0, 1.0, n)
    zs = np.linspace(0.0, 1.6, n)
    gx, gy, gz = np.meshgrid(xs, xs, zs, indexing='ij')
    grid = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], 1)
    best = None
    for direction in (1, -1):
        for offset in range(4):
            yaws = [math.radians(90 * ((offset + direction * i) % 4)) for i in range(4)]
            keep = carve(masks, yaws, grid)
            if best is None or keep.sum() > best[0].sum():
                best = (keep, yaws, direction, offset)
    keep, yaws, direction, offset = best
    vol = keep.reshape(n, n, n).astype(np.float32)
    verts, faces, _, _ = measure.marching_cubes(np.pad(vol, 1), 0.5)
    step = np.array([xs[1] - xs[0], xs[1] - xs[0], zs[1] - zs[0]])
    verts = (verts - 1) * step + np.array([-1.0, -1.0, 0.0])
    with open(a.out, 'w') as f:
        for v in verts:
            f.write(f'v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n')
        for t in faces + 1:
            f.write(f'f {t[0]} {t[2]} {t[1]}\n')
    print(f'voxels kept {int(keep.sum())}, order direction={direction} offset={offset}, '
          f'yaws(deg) N,E,S,W = {[round(math.degrees(y)) for y in yaws]}, verts {len(verts)}')


if __name__ == '__main__':
    main()
