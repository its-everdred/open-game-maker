"""Check each pilot variant against the pack sprites it was built from, per facing.

Checks (all must hold for a facing to pass):
  canvas     the variant keeps the pack's 256x256 canvas, so the adapter's (128, 208) anchor and the isometric
             perspective are unchanged
  density    every visible colour already exists in a named source sprite: nothing was scaled,
             filtered or blended, so pixel density and palette are the pack's
  contact    the lowest visible row is within 6 px of the primary source's (ground contact; decals and
             compositions may sit up to 24 px higher, since they cover part of a cell)
  scale      visible width and height stay within 0.5x-1.6x of the primary source's
  clip       no visible pixel touches the canvas edge (a cut-off composition)

``score.py`` (gm-sprite-forge) is also run against the primary source with the prop gates and its numbers are
recorded. Those gates measure a rebuild's fidelity, so a deliberate variant is expected to fail silhouette and pixel
similarity; the style numbers (palette distance, luminance histogram) are the ones to read.

    gm py -- scripts/assets/env_variety_validate.py <pack Environment dir> <variants dir>

Writes ``<variant>/validation.json`` and ``VALIDATION.md`` in the variants dir; exits 1 if any facing fails.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import env_variety_pilot as pilot  # noqa: E402

SCORE = Path(__file__).resolve().parents[2] / "skills" / "gm-sprite-forge" / "scripts" / "score.py"
LOOSE_CONTACT = {"decal", "compose"}


def bounds(rgba: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else None


def palette(rgba: np.ndarray) -> set[tuple[int, int, int]]:
    return set(map(tuple, rgba[rgba[..., 3] > 0][:, :3].tolist()))


def check(variant: np.ndarray, primary: np.ndarray, sources: list[np.ndarray], op: str) -> dict:
    vb, pb = bounds(variant), bounds(primary)
    allowed = set().union(*(palette(source) for source in sources))
    foreign = palette(variant) - allowed
    contact = (vb[3] - pb[3]) if vb and pb else None
    tolerance = 24 if op in LOOSE_CONTACT else 6
    ratio = (
        [round((vb[2] - vb[0]) / (pb[2] - pb[0]), 2), round((vb[3] - vb[1]) / (pb[3] - pb[1]), 2)]
        if vb and pb
        else None
    )
    result = {
        "canvas": variant.shape[:2] == primary.shape[:2] == (pilot.CANVAS, pilot.CANVAS),
        "density": not foreign,
        "foreign_colours": len(foreign),
        "contact_px": contact,
        "contact": contact is not None and -tolerance <= contact <= 6,
        "scale_ratio": ratio,
        "scale": ratio is not None and all(0.5 <= r <= 1.6 for r in ratio),
        "clip": vb is not None and vb[0] > 0 and vb[1] > 0 and vb[2] < pilot.CANVAS and vb[3] < pilot.CANVAS,
    }
    result["pass"] = all(result[key] for key in ("canvas", "density", "contact", "scale", "clip"))
    return result


def primary_of(recipe: dict) -> str:
    params = recipe["params"]
    return (params.get("from") or [params.get("shape") or params["parts"][0][0]])[0]


def score(original: Path, variant: Path) -> dict:
    run = subprocess.run(
        [sys.executable, "-I", str(SCORE), str(original), str(variant), "--gates", "prop"],
        capture_output=True,
        text=True,
    )
    text = run.stdout[: run.stdout.rfind("}") + 1]
    try:
        report = json.loads(text)
    except json.JSONDecodeError:
        return {"error": (run.stderr or run.stdout)[-300:]}
    keep = ("silhouette_iou", "pixel_similarity", "palette_distance", "edge_f1", "lum_hist_l1", "shadow_iou")
    return {key: report.get(key) for key in keep} | {"gates_pass": report.get("pass")}


def number(value) -> str:
    return f"{value:.2f}" if isinstance(value, (int, float)) else "n/a"


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 2:
        print(__doc__)
        return 2
    env, root = Path(args[0]), Path(args[1])
    lines = [
        "# Pilot validation",
        "",
        "| Variant | Op | Facings passing | Contact px | Scale (w, h) | Foreign colours | Palette dist. | Lum. hist. |",
        "|---|---|---|---|---|---|---|---|",
    ]
    failed = False
    for recipe_path in sorted(root.glob("*/recipe.json")):
        recipe = json.loads(recipe_path.read_text())
        op, primary = recipe["op"], primary_of(recipe)
        names = pilot.sources_of({**recipe["params"], "id": recipe["id"]})
        facings = {}
        for facing in pilot.FACINGS:
            variant = np.asarray(Image.open(recipe_path.parent / f"{facing}.png").convert("RGBA"))
            # compositions turn their parts per facing, so any facing of a named source is a legitimate colour
            sources = [pilot.load(env, name, other) for name in names for other in pilot.FACINGS]
            result = check(variant, pilot.load(env, primary, facing), sources, op)
            result["score"] = score(env / f"{primary}_{facing}.png", recipe_path.parent / f"{facing}.png")
            facings[facing] = result
        (recipe_path.parent / "validation.json").write_text(
            json.dumps({"primary_source": primary, "facings": facings}, indent=1) + "\n"
        )
        passing = [facing for facing, result in facings.items() if result["pass"]]
        failed |= len(passing) < len(pilot.FACINGS)
        south = facings["S"]
        lines.append(
            f"| {recipe['id']} | {op} | {''.join(passing) or '-'} | "
            f"{', '.join(str(facings[f]['contact_px']) for f in pilot.FACINGS)} | {south['scale_ratio']} | "
            f"{max(r['foreign_colours'] for r in facings.values())} | "
            f"{number(south['score'].get('palette_distance'))} | {number(south['score'].get('lum_hist_l1'))} |"
        )
    lines += [
        "",
        "Contact: variant minus primary source lowest visible row, per facing N E S W. Scale and score columns are "
        "the S facing against its primary source.",
    ]
    (root / "VALIDATION.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
