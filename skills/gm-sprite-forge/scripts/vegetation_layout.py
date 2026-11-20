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


def branches(seed: int, *, height: float = 1.0, radius: float = 0.07,
             lean: float = 0.1, levels: int = 3) -> list[Branch]:
    """Make a connected branching skeleton; each child starts on its parent."""
    if height <= 0 or radius <= 0 or lean < 0 or not 0 <= levels <= 5:
        raise ValueError('height and radius must be positive, lean nonnegative, levels 0..5')
    rng = random.Random(seed)
    root = Branch((0.0, 0.0, 0.0), (rng.uniform(-lean, lean), rng.uniform(-lean, lean), height), radius, 0)
    result = [root]
    frontier = [root]
    for depth in range(1, levels + 1):
        children = []
        for parent in frontier:
            length = math.dist(parent.start, parent.end) * rng.uniform(0.48, 0.68)
            for _ in range(2):
                t = rng.uniform(0.55, 0.95)
                start = tuple(a + t * (b - a) for a, b in zip(parent.start, parent.end))
                angle = rng.uniform(0, math.tau)
                spread = rng.uniform(0.55, 0.85)
                end = (start[0] + length * spread * math.cos(angle),
                       start[1] + length * spread * math.sin(angle),
                       start[2] + length * math.sqrt(1 - spread * spread))
                children.append(Branch(start, end, parent.radius * 0.6, depth))
        result.extend(children)
        frontier = children
    return result


def placements(seed: int, count: int, *, extent: float = 0.5,
               min_scale: float = 0.8, max_scale: float = 1.2) -> list[Placement]:
    """Place independently rotated plants within a square tile or cluster."""
    if count < 0 or extent < 0 or min_scale <= 0 or max_scale < min_scale:
        raise ValueError('invalid placement count, extent, or scale range')
    rng = random.Random(seed)
    return [Placement(rng.uniform(-extent, extent), rng.uniform(-extent, extent),
                      rng.uniform(0, math.tau), rng.uniform(min_scale, max_scale))
            for _ in range(count)]
