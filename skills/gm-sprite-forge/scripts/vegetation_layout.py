"""Seeded, renderer-independent layouts for procedural vegetation.

Coordinates are in rig world units. This module does not render or export assets;
style-specific geometry and materials are fitted separately against their references.
"""
from dataclasses import dataclass
import math
import random


@dataclass(frozen=True)
class Branch:
    start: tuple[float, float, float]
    end: tuple[float, float, float]
    radius: float
    depth: int


@dataclass(frozen=True)
class Placement:
    x: float
    y: float
    rotation: float
    scale: float


def organic_bare_branches(seed: int, *, height: float = 1.0, radius: float = 0.07) -> list[Branch]:
    """Build a seeded trunk, roots and tapering multi-segment bare limbs."""
    if not all(math.isfinite(v) and v > 0 for v in (height, radius)):
        raise ValueError('height and radius must be positive and finite')
    rng = random.Random(seed)
    result = [Branch((0, 0, 0), (.02, 0, height), radius, 0)]
    for i in range(6):
        angle = i * math.tau / 6
        result.append(Branch((0, 0, .06), (math.cos(angle) * .16, math.sin(angle) * .16, -.03), radius * .32, 1))
    for i in range(20):
        z = height * (.24 + i * .033)
        angle = i * 2.399 + rng.uniform(-.65, .65)
        length = height * (.62 - .27 * i / 19) * rng.uniform(.82, 1.15)
        start = (.02 * z / height, 0, z)
        previous = start
        for j in range(1, 5):
            t = j / 4
            point = (start[0] + math.cos(angle) * length * t,
                     start[1] + math.sin(angle) * length * t,
                     z + length * (.18 * t + .38 * t * t))
            r = radius * (.55 * (1 - t) + .08)
            result.append(Branch(previous, point, r, 1))
            previous = point
            for direction in (-1, 1):
                a = angle + direction * rng.uniform(.35, .8)
                size = length * rng.uniform(.15, .31)
                end = (point[0] + math.cos(a) * size, point[1] + math.sin(a) * size,
                       point[2] + size * rng.uniform(.35, .85))
                result.append(Branch(point, end, r * .48, 2))
                tip = (end[0] + math.cos(a + direction * .25) * size * .4,
                       end[1] + math.sin(a + direction * .25) * size * .4,
                       end[2] + size * .35)
                result.append(Branch(end, tip, r * .24, 3))
    return result


def branches(seed: int, *, height: float = 1.0, radius: float = 0.07,
             lean: float = 0.1, levels: int = 3, fanout: int = 2,
             spread: tuple[float, float] = (0.55, 0.85), attachment_min: float = 0.55) -> list[Branch]:
    """Make a connected branching skeleton; each child starts on its parent."""
    if (not all(math.isfinite(v) for v in (height, radius, lean, *spread, attachment_min))
            or height <= 0 or radius <= 0 or lean < 0
            or not 0 <= attachment_min <= 0.95
            or not isinstance(levels, int) or not 0 <= levels <= 5
            or not isinstance(fanout, int) or not 1 <= fanout <= 4
            or not 0 <= spread[0] <= spread[1] < 1):
        raise ValueError('invalid tree dimensions, levels, fanout, or spread')
    rng = random.Random(seed)
    root = Branch((0.0, 0.0, 0.0), (rng.uniform(-lean, lean), rng.uniform(-lean, lean), height), radius, 0)
    result = [root]
    frontier = [root]
    for depth in range(1, levels + 1):
        children = []
        for parent in frontier:
            length = math.dist(parent.start, parent.end) * rng.uniform(0.48, 0.68)
            for _ in range(fanout):
                t = rng.uniform(attachment_min, 0.95)
                start = tuple(a + t * (b - a) for a, b in zip(parent.start, parent.end))
                angle = rng.uniform(0, math.tau)
                radial = rng.uniform(*spread)
                end = (start[0] + length * radial * math.cos(angle),
                       start[1] + length * radial * math.sin(angle),
                       start[2] + length * math.sqrt(1 - radial * radial))
                children.append(Branch(start, end, parent.radius * 0.6, depth))
        result.extend(children)
        frontier = children
    return result


def placements(seed: int, count: int, *, extent: float = 0.5,
               min_scale: float = 0.8, max_scale: float = 1.2) -> list[Placement]:
    """Place independently rotated plants within a square tile or cluster."""
    if (not isinstance(count, int) or count < 0
            or not all(math.isfinite(v) for v in (extent, min_scale, max_scale))
            or extent < 0 or min_scale <= 0 or max_scale < min_scale):
        raise ValueError('invalid placement count, extent, or scale range')
    rng = random.Random(seed)
    return [Placement(rng.uniform(-extent, extent), rng.uniform(-extent, extent),
                      rng.uniform(0, math.tau), rng.uniform(min_scale, max_scale))
            for _ in range(count)]


def clustered_placements(seed: int, count: int, *, extent: float = 0.5,
                         batch_size: int = 1, batch_radius: float = 0.05) -> list[Placement]:
    """Scatter small groups within a tile, with an independent rotation per plant."""
    if (not isinstance(batch_size, int) or not 1 <= batch_size <= 16
            or not math.isfinite(batch_radius) or batch_radius < 0):
        raise ValueError('invalid batch size or radius')
    if batch_size == 1:
        return placements(seed, count, extent=extent)
    # placements validates count and extent even when no groups are needed.
    placements(seed, 0 if count == 0 else count, extent=extent)
    centres = placements(seed, (count + batch_size - 1) // batch_size, extent=extent)
    rng = random.Random(seed ^ 0xBA7C)
    result = []
    for centre in centres:
        for _ in range(min(batch_size, count - len(result))):
            angle = rng.uniform(0, math.tau)
            distance = batch_radius * math.sqrt(rng.random())
            x = max(-extent, min(extent, centre.x + math.cos(angle) * distance))
            y = max(-extent, min(extent, centre.y + math.sin(angle) * distance))
            result.append(Placement(x, y, rng.uniform(0, math.tau), rng.uniform(0.8, 1.2)))
    return result
