"""Clone-based 2D variants of SmallScaleInt fantasy set pieces, for scene variety (#1201 pilot).

Every variant is rebuilt from pack originals by one deterministic operation and written as four facings on the
pack's own 256x256 canvas with its ground anchor at (128, 208), so the isometric adapter places it like an original.
Pixels are only copied or recoloured to colours already present in a named pack sprite: nothing is scaled, filtered
or generated, so pixel density and palette stay the pack's.

Operations:
  cut        remove whole stakes or pickets (columns between two tips), optionally leaving a broken stump
  recolour   map the source's colours by luminance rank onto a donor sprite's colours (weathered wood, ...)
  moss       recolour the top few pixels of each column toward a vegetation donor, through a seeded blotch mask
  decal      a pack-authored patch silhouette filled with the top-face texture of a pack ground tile
  compose    several pack sprites placed at sub-cell offsets in one cell, rotated per facing, back to front

Run with the forge Python (Pillow and NumPy):

    gm py -- scripts/assets/env_variety_pilot.py <pack Environment dir> <out dir> [--only id ...]

The out dir receives ``<id>/{N,E,S,W}.png`` and ``<id>/recipe.json`` per variant. The script refuses an out dir
inside a pack directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image

FACINGS = ("N", "E", "S", "W")
CANVAS = 256
ANCHOR = (128, 208)
SHADOW_MAX_RGB = 40  # cast-shadow pixels are partial-alpha near-black


# --- helpers -----------------------------------------------------------------------------------------------------


def load(env: Path, item: str, facing: str) -> np.ndarray:
    with Image.open(env / f"{item}_{facing}.png") as image:
        return np.asarray(image.convert("RGBA")).copy()


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def body_mask(rgba: np.ndarray) -> np.ndarray:
    """Opaque object pixels, excluding the cast shadow."""
    return rgba[..., 3] == 255


def shadow_mask(rgba: np.ndarray) -> np.ndarray:
    alpha = rgba[..., 3]
    return (alpha > 0) & (alpha < 255) & (rgba[..., :3].max(axis=-1) <= SHADOW_MAX_RGB)


def colours(rgba: np.ndarray) -> np.ndarray:
    """Distinct opaque colours sorted dark to light."""
    unique = np.unique(rgba[body_mask(rgba)][:, :3], axis=0)
    return unique[np.argsort(luminance(unique.astype(float)), kind="stable")]


def rank_map(source: np.ndarray, donor: np.ndarray) -> dict[tuple, np.ndarray]:
    """Source colour -> donor colour at the same luminance quantile."""
    if len(source) == 0 or len(donor) == 0:
        return {}
    quantiles = np.linspace(0, 1, len(source))
    picks = np.round(quantiles * (len(donor) - 1)).astype(int)
    return {tuple(colour): donor[pick] for colour, pick in zip(source.tolist(), picks)}


def apply_map(rgba: np.ndarray, mapping: dict[tuple, np.ndarray], where: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    ys, xs = np.nonzero(where)
    for y, x in zip(ys, xs):
        key = tuple(int(v) for v in rgba[y, x, :3])
        if key in mapping:
            out[y, x, :3] = mapping[key]
    return out


def seeded(seed: str) -> np.random.Generator:
    return np.random.default_rng(int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16))


def clumps(rng: np.random.Generator, sigma: float) -> np.ndarray:
    """Uniform 0-1 values over the canvas with organic clumps (blurred noise, rank-normalised)."""
    from scipy import ndimage

    noise = ndimage.gaussian_filter(rng.random((CANVAS, CANVAS)), sigma)
    return (np.argsort(np.argsort(noise, axis=None)) / noise.size).reshape(noise.shape)


# --- operations --------------------------------------------------------------------------------------------------


def stakes(rgba: np.ndarray) -> list[tuple[int, int]]:
    """Column spans of individual stakes/pickets: split the top contour at its valleys between tips."""
    mask = body_mask(rgba)
    cols = np.nonzero(mask.any(axis=0))[0]
    if len(cols) == 0:
        return []
    top = np.array([np.argmax(mask[:, x]) if mask[:, x].any() else CANVAS for x in range(CANVAS)])
    spans, start = [], cols[0]
    for x in range(cols[0] + 1, cols[-1]):
        if top[x] > top[x - 1] and top[x] >= top[x + 1] and top[x] - min(top[start : x + 1]) >= 3:
            spans.append((start, x))
            start = x + 1
    spans.append((start, cols[-1] + 1))
    return [span for span in spans if span[1] - span[0] >= 2]


def cut(rgba: np.ndarray, remove: list[int], stump: int = 0, min_fragment: int = 12) -> np.ndarray:
    """Remove stakes by index (from the left), leaving the bottom ``stump`` body rows as a broken stump.

    Disconnected fragments under ``min_fragment`` pixels (slivers of a neighbour, orphaned shadow) are dropped.
    """
    from scipy import ndimage

    out = rgba.copy()
    mask, shadow = body_mask(rgba), shadow_mask(rgba)
    spans = stakes(rgba)
    for index in remove:
        if index >= len(spans):
            raise ValueError(f"stake {index} does not exist ({len(spans)} found)")
        x0, x1 = spans[index]
        for x in range(x0, x1):
            ys = np.nonzero(mask[:, x])[0]
            keep_from = ys[-1] + 1 - stump if len(ys) else CANVAS
            out[:keep_from, x][mask[:keep_from, x]] = 0
        # the stake's cast shadow falls down-left of it on the ground plane
        lo = max(0, x0 - 12)
        region = shadow[:, lo:x1]
        out[:, lo:x1][region] = 0
    labels, count = ndimage.label(out[..., 3] > 0)
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
    for label, size in enumerate(sizes, start=1):
        if size < min_fragment:
            out[labels == label] = 0
    return out


def recolour(rgba: np.ndarray, donor: np.ndarray) -> np.ndarray:
    mapping = rank_map(colours(rgba), colours(donor))
    return apply_map(rgba, mapping, body_mask(rgba))


def moss(rgba: np.ndarray, donor: np.ndarray, rng: np.random.Generator, depth: float, cover: float) -> np.ndarray:
    """Moss caps on the lit upper ``depth`` share of the body, thinning downward.

    The rock's tones collapse to three donor greens (dark, mid, light) in soft clumps: a full rank map carried the
    rock's fine tonal noise into the greens and read as static at play zoom.
    """
    mask = body_mask(rgba)
    ys = np.nonzero(mask.any(axis=1))[0]
    span = max(1, int((ys[-1] - ys[0]) * depth))
    fade = np.clip(1 - (np.arange(CANVAS) - ys[0]) / span, 0, 1)[:, None]
    field = clumps(rng, sigma=2.5)
    lum = luminance(rgba[..., :3].astype(float))
    lit = lum >= np.percentile(lum[mask], 35)
    where = mask & lit & (field < cover * fade)
    greens = colours(donor)
    bands = greens[[len(greens) // 5, len(greens) // 2, (len(greens) * 3) // 4]]
    edges = np.percentile(lum[where], [33, 66]) if where.any() else [0, 0]
    out = rgba.copy()
    out[where, :3] = bands[np.digitize(lum[where], edges)]
    return out


def decal(shape: np.ndarray, texture: np.ndarray, close: int = 1) -> np.ndarray:
    """``shape``'s visible pixels (optionally closed by ``close`` px) filled from ``texture`` at the same position."""
    mask = shape[..., 3] > 0
    for _ in range(close):
        grown = mask.copy()
        grown[1:] |= mask[:-1]
        grown[:-1] |= mask[1:]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        mask = grown
    for _ in range(close):
        shrunk = mask.copy()
        shrunk[1:] &= mask[:-1]
        shrunk[:-1] &= mask[1:]
        shrunk[:, 1:] &= mask[:, :-1]
        shrunk[:, :-1] &= mask[:, 1:]
        mask = shrunk | (shape[..., 3] > 0)
    ys, xs = np.mgrid[0:CANVAS, 0:CANVAS]
    top_face = np.abs(xs - ANCHOR[0]) / 64 + np.abs(ys - ANCHOR[1]) / 32 <= 1  # the tile's top diamond only
    mask &= body_mask(texture) & top_face
    out = np.zeros_like(texture)
    out[mask] = texture[mask]
    return out


def rotate(offset: tuple[float, float], turns: int) -> tuple[float, float]:
    x, y = offset
    for _ in range(turns % 4):
        x, y = -y, x
    return x, y


def compose(parts: list[tuple[np.ndarray, tuple[float, float]]]) -> np.ndarray:
    """Place sprites (anchor at ANCHOR) at tile-unit offsets, back to front by projected depth.

    Pixels are copied, never blended: a part's opaque pixels overwrite what is behind them, and its partial-alpha
    pixels (cast shadows) only fill empty canvas. Alpha blending a shadow over another part makes colours that no
    pack sprite has.
    """
    pad = CANVAS
    canvas = np.zeros((3 * CANVAS, 3 * CANVAS, 4), dtype=np.uint8)
    for rgba, (dx, dy) in sorted(parts, key=lambda part: part[1][0] + part[1][1]):
        px, py = int(round(64 * (dx - dy))), int(round(32 * (dx + dy)))
        region = canvas[pad + py : pad + py + CANVAS, pad + px : pad + px + CANVAS]
        alpha = rgba[..., 3]
        opaque = alpha == 255
        partial = (alpha > 0) & ~opaque & (region[..., 3] == 0)
        region[opaque | partial] = rgba[opaque | partial]
    return canvas[pad : pad + CANVAS, pad : pad + CANVAS].copy()


# --- recipes -----------------------------------------------------------------------------------------------------

# (id, gap, op, params). Sources are pack names without the facing suffix.
RECIPES: list[dict] = [
    {"id": "palisade-broken-a", "gap": "palisade", "op": "cut", "from": ["Wall B1"], "remove": [2], "stump": 14},
    {"id": "palisade-broken-b", "gap": "palisade", "op": "cut", "from": ["Wall B1"], "remove": [1, 4], "stump": 22},
    {"id": "palisade-weathered", "gap": "palisade", "op": "recolour", "from": ["Wall B1"], "donor": "Wall G1"},
    {"id": "palisade-low-weathered", "gap": "palisade", "op": "recolour", "from": ["Wall B3"], "donor": "Wall G1"},
    {"id": "fence-picket-gap", "gap": "fence", "op": "cut", "from": ["Wall E16"], "remove": [5, 6]},
    {"id": "fence-picket-weathered", "gap": "fence", "op": "recolour", "from": ["Wall E16"], "donor": "Wall G1"},
    {"id": "rock-mossy-a1", "gap": "rocks", "op": "moss", "from": ["Stone A1"], "donor": "Ground A2",
     "depth": 0.6, "cover": 1.1},
    {"id": "rock-mossy-a2", "gap": "rocks", "op": "moss", "from": ["Stone A2"], "donor": "Ground A2",
     "depth": 0.5, "cover": 1.0},
    {"id": "rock-cluster-a", "gap": "rocks", "op": "compose",
     "parts": [["Stone A12", "S", [-0.15, -0.2]], ["Stone A1", "E", [0.2, 0.1]], ["Ground E12", "S", [0, 0]]]},
    {"id": "rock-cluster-b", "gap": "rocks", "op": "compose",
     "parts": [["Stone A2", "W", [-0.25, 0.05]], ["Stone A12", "N", [0.35, -0.2]], ["Ground E11", "E", [0, 0]],
               ["Flora A1", "S", [0.15, 0.25]]]},
    {"id": "grime-dirt-patch-a", "gap": "grime", "op": "decal", "shape": "Ground A7", "texture": "Ground C5"},
    {"id": "grime-dirt-patch-b", "gap": "grime", "op": "decal", "shape": "Ground A10", "texture": "Ground I6"},
    {"id": "grime-mud-patch", "gap": "grime", "op": "decal", "shape": "Ground A6", "texture": "Ground C3",
     "close": 0},
    {"id": "grime-worn-path", "gap": "grime", "op": "decal", "shape": "Ground J9", "texture": "Ground I1"},
    {"id": "clutter-pots-crates", "gap": "clutter", "op": "compose",
     "parts": [["Misc B2", "S", [-0.2, -0.2]], ["Misc A3", "E", [0.25, -0.05]], ["Misc A2", "S", [0.05, 0.3]]]},
    {"id": "clutter-farmyard", "gap": "clutter", "op": "compose",
     "parts": [["Misc E1", "E", [-0.2, -0.15]], ["Misc B1", "S", [0.25, 0.05]], ["Misc A8", "S", [-0.05, 0.3]],
               ["Misc E9", "S", [0.2, 0.3]]]},
    {"id": "clutter-woodpile", "gap": "clutter", "op": "compose",
     "parts": [["Misc B8", "E", [-0.1, -0.1]], ["Tree E2", "S", [0.2, 0.2]], ["Tree A4", "S", [-0.3, 0.25]]]},
]


def build(recipe: dict, env: Path, facing: str) -> np.ndarray:
    op = recipe["op"]
    if op == "cut":
        return cut(load(env, recipe["from"][0], facing), recipe["remove"], recipe.get("stump", 0))
    if op == "recolour":
        return recolour(load(env, recipe["from"][0], facing), load(env, recipe["donor"], facing))
    if op == "moss":
        rng = seeded(f"{recipe['id']}:{facing}")
        donor = load(env, recipe["donor"], facing)
        return moss(load(env, recipe["from"][0], facing), donor, rng, recipe["depth"], recipe["cover"])
    if op == "decal":
        return decal(load(env, recipe["shape"], facing), load(env, recipe["texture"], facing), recipe.get("close", 1))
    if op == "compose":
        turns = FACINGS.index(facing)
        parts = []
        for item, base, offset in recipe["parts"]:
            part_facing = FACINGS[(FACINGS.index(base) + turns) % 4]
            parts.append((load(env, item, part_facing), rotate(tuple(offset), turns)))
        return compose(parts)
    raise ValueError(f"unknown op {op}")


def sources_of(recipe: dict) -> list[str]:
    names = list(recipe.get("from", []))
    names += [recipe[key] for key in ("donor", "shape", "texture") if key in recipe]
    names += [part[0] for part in recipe.get("parts", [])]
    return sorted(set(names))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("env", type=Path, help="the pack's Environment directory (read only)")
    parser.add_argument("out", type=Path)
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args(argv)
    env, out = args.env.resolve(), args.out.resolve()
    if "packs" in out.parts:
        parser.error("refusing to write variants inside a pack directory")
    unknown = sorted(set(args.only or []) - {recipe["id"] for recipe in RECIPES})
    if unknown:
        parser.error(f"unknown variant ids: {', '.join(unknown)}")
    pack_root = env
    while pack_root.parent != pack_root and pack_root.parent.name != "packs":
        pack_root = pack_root.parent
    for recipe in RECIPES:
        if args.only and recipe["id"] not in args.only:
            continue
        target = out / recipe["id"]
        target.mkdir(parents=True, exist_ok=True)
        for facing in FACINGS:
            Image.fromarray(build(recipe, env, facing)).save(target / f"{facing}.png")
        (target / "recipe.json").write_text(
            json.dumps(
                {
                    "id": recipe["id"],
                    "gap": recipe["gap"],
                    "kind": "clone variant (2D, pack pixels only)",
                    "op": recipe["op"],
                    "params": {k: v for k, v in recipe.items() if k not in ("id", "gap", "op")},
                    "derived_from": [f"{pack_root.name}/Environment/{name}_<N|E|S|W>.png" for name in sources_of(recipe)],
                    "generator": "scripts/assets/env_variety_pilot.py",
                    "model": None,
                    "cost_usd": 0,
                    "ai_generated": False,
                    "usage_rights": "inherits the source pack's rights (personal use, no redistribution)",
                    "made": date.today().isoformat(),
                },
                indent=1,
            )
            + "\n"
        )
        print(recipe["id"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
