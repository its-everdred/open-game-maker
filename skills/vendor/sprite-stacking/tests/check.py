"""Self-check for the slicer. Run: python3 tests/check.py"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "sprite-stacking" / "scripts"))
from views_to_slices import (  # noqa: E402
    build_html_viewer,
    compute_normals,
    detect_emissive,
    find_views,
    remove_background,
    thin_runs,
    views_to_slices,
)

RED, DRK, TYR, BARK, LEAF = (210, 40, 50), (40, 50, 70), (30, 30, 34), (110, 70, 40), (60, 150, 70)


def view(w, h, rects):
    a = np.zeros((h, w, 4), np.uint8)
    for x0, y0, x1, y1, c in rects:
        a[y0:y1, x0:x1] = (*c, 255)
    return a


def outlined(v):
    h, w = v.shape[:2]
    o = np.zeros((h + 2, w + 2, 4), np.uint8)
    o[1:-1, 1:-1] = v
    m = o[..., 3] > 0
    p = np.pad(m, 1)
    o[~m & (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:])] = (15, 15, 20, 255)
    return o


def sheet(views, scale=8, gap=40):
    views = [outlined(v) for v in views]
    w = sum(v.shape[1] * scale for v in views) + gap * (len(views) + 1)
    h = max(v.shape[0] * scale for v in views) + gap * 2
    out = Image.new("RGBA", (w, h), (250, 250, 250, 255))
    x = gap
    for v in views:
        im = Image.fromarray(v).resize((v.shape[1] * scale, v.shape[0] * scale), Image.NEAREST)
        out.paste(im, (x, (h - im.height) // 2), im)
        x += im.width + gap
    return np.array(out.convert("RGB").convert("RGBA"))


# Car: 24 wide, 48 long, 18 tall; nose down in TOP, left in SIDE. Cabin agrees across views.
L, W = 48, 24
car_top = view(W, L, [(0, 0, W, L, RED), (4, 10, W - 4, 38, DRK)])
car_side = view(L, 18, [(0, 7, L, 15, RED), (10, 1, 37, 7, DRK), (5, 13, 13, 18, TYR), (35, 13, 43, 18, TYR)])
car_front = view(W, 18, [(0, 7, W, 15, RED), (4, 1, W - 4, 7, DRK), (1, 13, 4, 18, TYR), (W - 4, 13, W - 1, 18, TYR)])
car = [car_top, car_side, car_front, car_front.copy()]

# Tree: round-ish canopy, taller than wide; aspect ratio alone picks the side view as TOP.
tree_top = view(20, 20, [(2, 2, 18, 18, LEAF)])
tree_side = view(20, 40, [(2, 0, 18, 26, LEAF), (8, 26, 12, 40, BARK)])
tree = [tree_top, tree_side, tree_side.copy(), tree_side.copy()]


def box(v):
    """Size on the sheet: alpha bbox, plus the 1px outline, at 8x."""
    ys, xs = np.nonzero(v[..., 3])
    return ((np.ptp(ys) + 3) * 8, (np.ptp(xs) + 3) * 8)


# 1. View order: in reading order, shuffled, and a tall prop.
for name, views, order in (("car", car, [0, 1, 2, 3]), ("car shuffled", car, [1, 2, 0, 3]), ("tree", tree, [0, 1, 2, 3])):
    found = find_views(remove_background(sheet([views[i] for i in order])))
    top, side = found[0].shape[:2], found[1].shape[:2]
    want_top, want_side = (box(views[0]), box(views[1]))
    assert top == want_top, f"{name}: TOP is {top}, want {want_top}"
    assert side == want_side, f"{name}: SIDE is {side}, want {want_side}"

# 2. No body-colour stripe on the cabin walls (slices above the body).
vol, _ = views_to_slices(sheet(car), slices=36)
red = (vol[..., 0] > 150) & (vol[..., 1] < 80) & (vol[..., 3] > 0)
cabin = slice(25, 36)
assert red[cabin].sum() == 0, f"{red[cabin].sum()} body-red pixels on cabin slices"

# 3. No black voxels under an overhang: a cap on a thin stem over a wide base plate.
cap_side = view(24, 24, [(0, 0, 24, 10, RED), (9, 10, 15, 20, BARK), (0, 20, 24, 24, LEAF)])
mush = [view(24, 24, [(0, 0, 24, 24, RED)]), cap_side, cap_side.copy(), cap_side.copy()]
vol, _ = views_to_slices(sheet(mush), slices=26, order="reading")
dark = (vol[..., :3].astype(int).sum(-1) < 60) & (vol[..., 3] > 0)
assert dark.sum() == 0, f"{dark.sum()} black voxels under the cap"

# 4. --round: a thin tower on a wide disc base carves round, not square.
yy, xx = np.mgrid[0:24, 0:24]
disc = view(24, 24, [])
disc[(yy - 11.5) ** 2 + (xx - 11.5) ** 2 < 144] = (*RED, 255)
tower_side = view(24, 30, [(8, 0, 16, 26, RED), (0, 26, 24, 30, LEAF)])
tower = [disc, tower_side, tower_side.copy(), tower_side.copy()]
for round_, want_corner in ((False, True), (True, False)):
    vol, _ = views_to_slices(sheet(tower), slices=32, order="reading", round_=round_)
    mid = vol[16, ..., 3] > 0
    ys, xs = np.nonzero(mid)
    corner = mid[ys.min(), xs.min()]
    assert corner == want_corner, f"round={round_}: tower corner filled={corner}"

# 5. 1px posts are flagged (they blink when rotated); 2px posts and plain domes are not.
def posts(width):
    v = np.zeros((12, 12, 12, 4), np.uint8)
    v[:2, 2:10, 2:10] = (*BARK, 255)  # base
    v[2:10, 2 : 2 + width, 2 : 2 + width] = (*BARK, 255)
    v[2:10, 10 - width : 10, 10 - width : 10] = (*BARK, 255)
    v[10:, 2:10, 2:10] = (*RED, 255)  # roof
    return v

assert thin_runs(posts(1)) == [(2, 9)], thin_runs(posts(1))
assert thin_runs(posts(2)) == []

# 6. 3D normals: shape & alpha match occupancy, top roof points +Z, empty stays 0.
box_vol = np.zeros((10, 12, 12, 4), np.uint8)
box_vol[1:9, 2:10, 2:10] = (*DRK, 255)
norms = compute_normals(box_vol)
assert norms.shape == box_vol.shape
assert np.array_equal(norms[..., 3] > 0, box_vol[..., 3] > 0)
assert norms[8, 6, 6, 2] > 200, f"top center normal z={norms[8, 6, 6, 2]}, expected >200"
assert norms[0, 6, 6, 3] == 0

# 7. Auto-emissive: detects small bright accents, excludes dominant bright body, handles empty.
box_vol[4:6, 2, 4:6] = (255, 245, 160, 255)  # headlights
em = detect_emissive(box_vol)
assert (em[4:6, 2, 4:6, 3] > 0).all(), "expected headlights to be marked emissive"
assert (em[8, 6, 6, 3] == 0), "dark body should not be emissive"

bright_body = np.zeros((10, 12, 12, 4), np.uint8)
bright_body[1:9, 2:10, 2:10] = (250, 250, 250, 255)
assert (detect_emissive(bright_body)[..., 3] == 0).all(), "dominant white body must not glow"
assert (detect_emissive(np.zeros((4, 4, 4, 4), np.uint8))[..., 3] == 0).all()

# 8. Viewer HTML embeds live lighting, Living Diorama Scene, Weather, and Play mode controls.
import tempfile
with tempfile.TemporaryDirectory() as td:
    html_path = Path(td) / "viewer.html"
    build_html_viewer(box_vol, [box_vol[0]] * 4, html_path, "Check")
    viewer_html = html_path.read_text(encoding="utf-8")
for needle in (
    'data-mode="scene"',
    'data-scene="street"',
    'data-scene="island"',
    'data-mode="play"',
    'data-toy="drive"',
    'data-toy="wind"',
    'data-toy="shatter"',
    'data-drive-world="street"',
    'data-weather="rain"',
    'data-weather="snow"',
    'id="timeRange"',
    'id="sunRange"',
    'id="propInput"',
    'drawWetReflection',
    'snowMask',
    'getCachedPropSprite',
):
    assert needle in viewer_html, f"missing {needle} in viewer HTML"

print("ok")
