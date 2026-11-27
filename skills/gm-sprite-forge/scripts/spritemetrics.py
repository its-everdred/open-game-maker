"""Shared sprite measurements for the SmallScaleInt style study and the rebuild scorer.

Requires Pillow, NumPy and SciPy.
All functions take RGBA uint8 arrays (H, W, 4). Nothing here writes to pack files.
"""
import numpy as np
from PIL import Image
from scipy import ndimage


def load(path):
    return np.array(Image.open(path).convert('RGBA'))


def cells(sheet, cell):
    """Split a sheet into a rows x cols grid of cell arrays (row = direction, col = frame)."""
    h, w = sheet.shape[:2]
    return [[sheet[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] for c in range(w // cell)] for r in range(h // cell)]


def mask(a, alpha_min=128):
    """Object pixels: fully opaque, or mostly opaque and not a near-black shadow pixel.
    SmallScaleInt cast shadows are RGB ~(0,0,0) at partial alpha, so they are excluded here (see shadow_mask)."""
    al = a[..., 3]
    return (al == 255) | ((al >= alpha_min) & (a[..., :3].max(-1) > 8))


def shadow_mask(a):
    """Cast-shadow pixels: partial alpha, near-black RGB."""
    al = a[..., 3]
    return (al > 0) & (al < 255) & (a[..., :3].max(-1) <= 8)


def lum(a):
    rgb = a[..., :3].astype(float)
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def palette(a, alpha_min=128):
    m = mask(a, alpha_min)
    if not m.any():
        return np.zeros((0, 3), np.uint8), np.zeros(0, int)
    cols, counts = np.unique(a[..., :3][m].reshape(-1, 3), axis=0, return_counts=True)
    return cols, counts


def colours_for_coverage(a, frac=0.9):
    """How many distinct colours cover `frac` of the opaque pixels (robust palette size)."""
    _, counts = palette(a)
    if not len(counts):
        return 0
    c = np.sort(counts)[::-1].cumsum()
    return int(np.searchsorted(c, frac * c[-1]) + 1)


def edge(m):
    """Opaque pixels with a 4-neighbour outside the mask (the silhouette's 1px rim)."""
    return m & ~ndimage.binary_erosion(m, border_value=0)


def outline_stats(a):
    """Rim darkness: rim mean luminance / interior mean luminance, and the share of rim pixels
    darker than the interior's 10th percentile. A hard dark outline gives ratio << 1 and share near 1."""
    m = mask(a)
    if m.sum() < 9:
        return None
    rim = edge(m)
    inner = m & ~rim
    L = lum(a)
    if not inner.any():
        return None
    p10 = np.percentile(L[inner], 10)
    return {
        'rim_to_interior_lum': float(L[rim].mean() / max(L[inner].mean(), 1e-6)),
        'rim_dark_share': float((L[rim] <= p10).mean()),
        'rim_px': int(rim.sum()),
    }


def light_direction(a):
    """Screen-space light direction: luminance-weighted centroid minus silhouette centroid.
    Returns angle in degrees (0 = right, 90 = up) and strength in px."""
    m = mask(a)
    if m.sum() < 9:
        return None
    ys, xs = np.nonzero(m)
    L = lum(a)[m]
    w = L - L.min() + 1e-6
    dx = (xs * w).sum() / w.sum() - xs.mean()
    dy = (ys * w).sum() / w.sum() - ys.mean()
    return {'angle_deg': float(np.degrees(np.arctan2(-dy, dx)) % 360), 'offset_px': float(np.hypot(dx, dy))}


def bbox(m):
    ys, xs = np.nonzero(m)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def iou(m1, m2):
    u = (m1 | m2).sum()
    return float((m1 & m2).sum() / u) if u else 1.0


def luminance_bands(a, min_share=0.02):
    """Number of luminance levels (quantised to 8) that each hold >= min_share of opaque pixels:
    a proxy for the count of cel-shading bands."""
    m = mask(a)
    if not m.any():
        return 0
    q = (lum(a)[m] // 8).astype(int)
    _, counts = np.unique(q, return_counts=True)
    return int((counts / counts.sum() >= min_share).sum())


def palette_distance(a, b):
    """Symmetric mean nearest-colour distance (RGB, 0-441) between two sprites' palettes, weighted by pixel count."""
    ca, na = palette(a)
    cb, nb = palette(b)
    if not len(ca) or not len(cb):
        return None
    ca, cb = ca.astype(float), cb.astype(float)
    d = np.sqrt(((ca[:, None, :] - cb[None, :, :]) ** 2).sum(-1))
    ab = (d.min(1) * na).sum() / na.sum()
    ba = (d.min(0) * nb).sum() / nb.sum()
    return float((ab + ba) / 2)


def crispness(a, hard_de=20.0):
    """How flat and hard-edged a sprite reads (#1338): `same` is the share of neighbouring object pixel pairs with one
    colour; `hard` is the share of the differing pairs that step by CIE76 dE >= hard_de; `rim_dl` is the mean lightness
    of rim pixels minus their inner 4-neighbours (negative: a darker rim). Pack Idle frames: same 0.46-0.69, hard
    0.13-0.52, rim_dl -0.2 to -4.5; finish B: hard 0.01."""
    from skimage.color import rgb2lab
    m = mask(a)
    if m.sum() < 9:
        return None
    lab = rgb2lab(a[..., :3] / 255)
    d = []
    for s0, s1 in ((np.s_[:, 1:], np.s_[:, :-1]), (np.s_[1:, :], np.s_[:-1, :])):
        both = m[s0] & m[s1]
        d.append(np.linalg.norm(lab[s0] - lab[s1], axis=-1)[both])
    d = np.concatenate(d)
    diff = d[d >= 1]
    rim = edge(m)
    inner = m & ~rim
    L = lab[..., 0]
    tot, cnt = np.zeros(L.shape), np.zeros(L.shape)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sl = np.roll(inner, (dy, dx), (0, 1)), np.roll(L, (dy, dx), (0, 1))
        tot += np.where(sl[0], sl[1], 0)
        cnt += sl[0]
    r = rim & (cnt > 0)
    return {'same': float((d < 1).mean()) if len(d) else 0.0,
            'hard': float((diff >= hard_de).mean()) if len(diff) else 0.0,
            'rim_dl': float((L[r] - tot[r] / cnt[r]).mean()) if r.any() else 0.0}
