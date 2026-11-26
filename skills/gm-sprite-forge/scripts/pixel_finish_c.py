"""Finish C (#1338): crisp 3D-to-pixel to match SmallScaleInt (SSI) sprites. Replaces finish B's soft k-means look.

Usage: pixel_finish_c.py <raw.png> <alb.png> <depth.png> <out.png> --preset presets/finish-c.json [--variant C1]
                         [--ssi ref.png ...] [--ss 4]
pixel_preview.py --finish C, pixel_lineup.py and run_cells.py ("pixel": {"finish": "C"}) call finish_c() directly.
Inputs come from pixel_preview_rig.py with ss=4 passes=1: the colour render, the diffuse-colour (albedo) pass and the
16-bit depth pass, all at ss x the sprite size and unfiltered (0.01 px pixel filter, so no anti-aliasing).

1. Downsample ss x ss blocks by majority vote, never by averaging: alpha is on when >= alpha_cov of the block is
   opaque (hard alpha), the material is the block's most common one, its shade the median of that material's samples.
2. Materials: albedo clustered in Lab (k-means, at most `materials`, centroids closer than `merge_de` merged). KayKit
   models are one material on a colour atlas, so the albedo, not the Blender material, separates stone from water.
   `cloth_split`: finish B's cloth rule on the albedo (sRGB saturation < 0.16 and value > 0.5) is clustered on its own,
   so the white undergarments never merge into pale skin (they did at merge_de 14). `ids` (e.g. the hero cells' cloth
   and weapon masks) replace the albedo clustering; without an albedo pass the lit colour stands in for it.
3. Shade bands: per material, the lit/albedo lightness ratio (`band_source` "shade"; "lit" uses the lit lightness, so
   painted texture gradients band too) cut into `bands` hard levels (1-D k-means), then
   isolated band pixels folded into their neighbours (`orphans`).
4. Colour per (material, band): `palette` = "own" (the render's median colour per band, band lightness spread by
   `contrast`, shadows hue-shifted cool and lights warm by `hue_shift`; `chroma_source` "albedo" retains painted hue
   in shadow), "ssi" (ramps measured from the --ssi
   sprites: each material takes the SSI colour group nearest its albedo, band i -> ramp step i by rank), "ssi_tone"
   (our bands rescaled onto the nearest SSI group's 10-90th lightness range x `ssi_tone_contrast`, in its hue;
   own hue when no group's a*b* is within `ssi_max_de`; the range is clamped to `ssi_span` [min, max] L*), or "snap"
   (own colours snapped to the nearest SSI colour).
5. Lines: 1 px separation lines where materials meet, drawn on the farther pixel (depth) in that material's darkest
   band darkened by `line_dark` (equal depth: the higher material id, so a line is still 1 px); `depth_lines` > 0 also lines depth jumps inside one material (in depth units 0..1).
   `line_space` "ss" finds them on the ss x samples (a pixel is line if any of its samples is: unbroken lines),
   "1x" on the downsampled pixels.
6. Outline: the silhouette's 1 px rim in the local colour darkened by `outline_dark` (0 = none); never black.
Marks nothing in any pack; reads only.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.cluster.vq import kmeans2
from scipy import ndimage
from skimage.color import lab2rgb, rgb2lab

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spritemetrics as sm  # noqa: E402

N4 = ((0, 1), (1, 0), (0, -1), (-1, 0))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def shifted(x, dy, dx, fill):
    """x moved by (dy, dx); cells moved in from outside get `fill`."""
    out = np.full_like(x, fill)
    h, w = x.shape[:2]
    out[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = x[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
    return out


def materials(alb_lab, m, n, merge_de, seed=7, cloth=None):
    """Material id per sample (-1 outside m) from albedo Lab: k-means, then merge centroids closer than merge_de.
    With a cloth mask the cloth and the rest are clustered apart (their ids never shared)."""
    if cloth is not None:
        ids = np.full(m.shape, -1)
        nxt = 0
        for part in (m & ~cloth, m & cloth):
            if part.any():
                sub = materials(alb_lab, part, n, merge_de, seed)
                ids[part] = sub[part] + nxt
                nxt = ids.max() + 1
        return ids
    ids = np.full(m.shape, -1)
    x = alb_lab[m]
    n = max(1, min(n, len(np.unique(x.round(0), axis=0))))
    cent, lab = kmeans2(x, n, minit='++', iter=30, seed=np.random.default_rng(seed))
    parent = list(range(n))  # union-find over close centroids

    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if np.linalg.norm(cent[i] - cent[j]) < merge_de:
                parent[root(j)] = root(i)
    roots = sorted({root(i) for i in range(n)})
    remap = np.array([roots.index(root(i)) for i in range(n)])
    ids[m] = remap[lab]
    return ids


def downsample(raw, alb_lab, depth, ids, ss, alpha_cov):
    """Majority-vote blocks: (alpha, material, shade, lit Lab, albedo Lab, depth) at 1x."""
    H, W = raw.shape[0] // ss, raw.shape[1] // ss
    blk = lambda x: x[:H * ss, :W * ss].reshape(H, ss, W, ss, *x.shape[2:]).swapaxes(1, 2).reshape(H, W, ss * ss, *x.shape[2:])
    lit = rgb2lab(raw[..., :3] / 255)
    shade = lit[..., 0] / np.maximum(alb_lab[..., 0], 1)
    if ss == 1 and 0 < alpha_cov <= 1:
        on = ids >= 0
        return (ids.copy(), np.where(on, shade, 0), np.where(on[..., None], lit, 0),
                np.where(on[..., None], alb_lab, 0), np.where(on, depth, 1))
    bi, bl, ba, bd, bs = blk(ids), blk(lit), blk(alb_lab), blk(depth), blk(shade)
    on = (bi >= 0).mean(-1) >= alpha_cov
    mid = np.full((H, W), -1)
    out_lit, out_alb = np.zeros((H, W, 3)), np.zeros((H, W, 3))
    out_d, out_s = np.ones((H, W)), np.zeros((H, W))
    for y, x in zip(*np.nonzero(on)):
        v = bi[y, x]
        vals, cnt = np.unique(v[v >= 0], return_counts=True)
        k = vals[cnt.argmax()]
        sel = v == k
        mid[y, x] = k
        out_lit[y, x] = np.median(bl[y, x][sel], 0)
        out_alb[y, x] = np.median(ba[y, x][sel], 0)
        out_d[y, x] = bd[y, x][sel].min()
        out_s[y, x] = np.median(bs[y, x][sel])
    return mid, out_s, out_lit, out_alb, out_d


def bands_of(shade, mid, n, seed=7):
    """Band index per pixel (0 = darkest) per material: 1-D k-means of the shade ratio."""
    band = np.full(mid.shape, -1)
    for k in np.unique(mid[mid >= 0]):
        sel = mid == k
        v = shade[sel]
        nk = max(1, min(n, len(np.unique(v.round(3)))))
        if nk == 1:
            band[sel] = 0
            continue
        cent, lab = kmeans2(v[:, None], nk, minit='++', iter=30, seed=np.random.default_rng(seed))
        order = np.argsort(np.argsort(cent[:, 0]))
        band[sel] = order[lab]
    return band


def fold_orphans(mid, band, passes):
    """A (material, band) pixel with no 8-neighbour of the same pair takes its neighbours' most common pair."""
    key = np.where(mid >= 0, mid * 16 + band, -1)
    for _ in range(int(passes)):
        nb = np.stack([shifted(key, dy, dx, -1) for dy, dx in N8])
        lonely = (key >= 0) & ~(nb == key).any(0)
        if not lonely.any():
            break
        for y, x in zip(*np.nonzero(lonely)):
            v = nb[:, y, x]
            v = v[v >= 0]
            if len(v):
                vals, cnt = np.unique(v, return_counts=True)
                key[y, x] = vals[cnt.argmax()]
    return np.where(key >= 0, key // 16, -1), np.where(key >= 0, key % 16, -1)


def ssi_ramps(paths, groups, steps, l_weight=0.5, seed=7):
    """Colour groups (by chroma and lightness) measured from SSI sprites, each a dark-to-light ramp of Lab steps."""
    px = []
    for p in paths:
        a = sm.load(p)
        px.append(rgb2lab(a[..., :3][sm.mask(a)] / 255))
    x = np.concatenate(px)
    feat = x * np.array([l_weight, 1.0, 1.0])  # group on hue/chroma more than lightness
    cent, lab = kmeans2(feat, groups, minit='++', iter=40, seed=np.random.default_rng(seed))
    ramps = []
    for g in range(groups):
        c = x[lab == g]
        if len(c) < steps:
            continue
        cc, cl = kmeans2(c[:, :1], steps, minit='++', iter=30, seed=np.random.default_rng(seed))
        ramp = [np.median(c[cl == i], 0) for i in np.argsort(cc[:, 0]) if (cl == i).any()]
        ramps.append({'mean': c.mean(0), 'ramp': np.array(ramp), 'n': len(c),
                      'lo': np.percentile(c[:, 0], 10), 'hi': np.percentile(c[:, 0], 90)})
    return ramps


def palette_for(mid, band, lit, alb, P, ramps):
    """Lab colour per (material, band)."""
    pal = {}
    for k in np.unique(mid[mid >= 0]):
        sel_k = mid == k
        bs = sorted(np.unique(band[sel_k]))
        own = np.array([np.median(lit[sel_k & (band == b)], 0) for b in bs])
        if P['palette'] in ('own', 'snap'):
            Lm = own[:, 0].mean()
            own[:, 0] = np.clip(Lm + (own[:, 0] - Lm) * P['contrast'], 3, 98)
            if len(bs) > 1:
                t = np.linspace(-1, 1, len(bs))
                own[:, 2] += t * P['hue_shift']        # b*: lights warmer, shadows cooler
                own[:, 1] -= t * P['hue_shift'] * 0.3  # a*: a touch of violet in the shadows
        if P['palette'] == 'ssi' and ramps:
            am = np.median(alb[sel_k], 0)
            d = [np.linalg.norm((r['mean'] - am) * np.array([P['ssi_l_weight'], 1, 1])) for r in ramps]
            r = ramps[int(np.argmin(d))]['ramp']
            idx = np.round(np.linspace(0, len(r) - 1, len(bs))).astype(int) if len(bs) > 1 else [len(r) // 2]
            own = r[idx].copy()
        elif P['palette'] == 'ssi_tone' and ramps:
            am = np.median(alb[sel_k], 0)
            d = [np.linalg.norm((r['mean'] - am) * np.array([P['ssi_l_weight'], 1, 1])) for r in ramps]
            g = ramps[int(np.argmin(d))]
            if np.linalg.norm(g['mean'][1:] - am[1:]) > P['ssi_max_de']:  # no SSI colour near it: keep its own hue
                g = dict(g, mean=np.r_[g['mean'][0], np.median(lit[sel_k], 0)[1:]])
            lo, hi = own[:, 0].min(), own[:, 0].max()
            t = (own[:, 0] - lo) / max(hi - lo, 1e-6) - 0.5 if hi > lo else np.zeros(len(own))
            mid_l = (g['lo'] + g['hi']) / 2
            span = np.clip(g['hi'] - g['lo'], *P['ssi_span'])
            own[:, 0] = np.clip(mid_l + t * span * P['ssi_tone_contrast'], 3, 98)
            own[:, 1:] = g['mean'][1:] + (own[:, 1:] - own[:, 1:].mean(0))
        elif P['palette'] == 'snap' and ramps:
            allc = np.concatenate([r['ramp'] for r in ramps])
            own = allc[np.argmin(((own[:, None] - allc[None]) ** 2).sum(-1), 1)]
        for b, c in zip(bs, own):
            pal[(k, b)] = c
    return pal


def boundary(ids, dep, depth_lines):
    """Pixels on the farther side of a material boundary, or of a depth jump > depth_lines inside one material."""
    on = ids >= 0
    line = np.zeros(ids.shape, bool)
    for dy, dx in N4:
        om, od = shifted(ids, dy, dx, -1), shifted(dep, dy, dx, 1.0)
        diff_mat = on & (om >= 0) & (om != ids)
        jump = on & (om == ids) & (depth_lines > 0) & (dep - od > depth_lines)
        line |= (diff_mat & ((dep > od) | ((dep == od) & (ids > om)))) | jump
    return line


def darker(lab, f):
    c = lab.copy()
    c[0] *= (1 - f)
    c[1:] *= (1 - f * 0.3)
    return c


def cloth_rule(alb):
    """finish B's cloth rule (render_motion.mask_materials) on an sRGB albedo: pale and unsaturated."""
    rgb = alb[..., :3].astype(float) / 255
    v, lo = rgb.max(-1), rgb.min(-1)
    return ((v - lo) / np.maximum(v, 1e-6) < 0.16) & (v > 0.5)


def finish_c(raw, alb, depth, P, ssi=(), ss=4, ids=None):
    """raw RGBA, alb RGB (or None: the lit colour), depth uint16 (or None: flat) at ss x; P: one preset variant dict;
    ids: optional int material ids at ss x (<0 outside), used instead of the albedo clustering.
    Returns RGBA uint8 at 1x and debug maps."""
    m4 = raw[..., 3] >= 128
    if not m4.any():  # nothing rendered (a transparent material): an empty sprite, not a crash for the whole batch
        return np.zeros((raw.shape[0] // ss, raw.shape[1] // ss, 4), np.uint8), {'materials': 0, 'line_px': 0, 'rim_px': 0}
    alb = raw[..., :3] if alb is None else alb
    if P.get('chroma_source') == 'albedo':
        # Blender's diffuse-colour pass is black for unlit/emission materials.
        missing = (alb[..., :3].max(-1) <= 3) & (raw[..., :3].max(-1) > 3) & m4
        alb = np.where(missing[..., None], raw[..., :3], alb[..., :3])
    alb_lab = rgb2lab(alb[..., :3] / 255)
    if ids is not None:
        ids = np.where(m4, np.where(ids < 0, 0, ids), -1)
        if P.get('cluster_ids'):
            # A body/cloth/weapon mask is too coarse to preserve faces and trim.
            partition = ids.copy()
            next_id = 0
            for part in np.unique(partition[m4]):
                mask = m4 & (partition == part)
                sub = materials(alb_lab, mask, P['materials'], P['merge_de'])
                ids[mask] = sub[mask] + next_id
                next_id = int(ids[mask].max()) + 1
    else:
        cloth = cloth_rule(alb) if P.get('cloth_split') else None
        ids = materials(alb_lab, m4, P['materials'], P['merge_de'], cloth=cloth)
    d = np.zeros(m4.shape) if depth is None else depth.astype(float) / 65535
    mid, shade, lit, albd, dep = downsample(raw, alb_lab, d, ids, ss, P['alpha_cov'])
    band = bands_of(shade if P['band_source'] == 'shade' else lit[..., 0], mid, P['bands'])
    mid, band = fold_orphans(mid, band, P['orphans'])
    ramps = ssi_ramps(ssi, P['ssi_groups'], P['ssi_steps'], P['ssi_group_l']) if ssi and P['palette'] != 'own' else []
    pal = palette_for(mid, band, lit, albd, P, ramps)
    on = mid >= 0
    out_lab = np.zeros(mid.shape + (3,))
    for (k, b), c in pal.items():
        out_lab[(mid == k) & (band == b)] = c
    if P.get('chroma_source') == 'albedo':
        # A small face can share a cluster with grey armour; retain its own hue.
        out_lab[..., 1:][on] = albd[..., 1:][on]
    dark = {k: min((c for (kk, b), c in pal.items() if kk == k), key=lambda c: c[0]) for k in np.unique(mid[on])}
    line = np.zeros(mid.shape, bool)
    if P['line_dark'] > 0:
        if P['line_space'] == 'ss':  # find lines on the ss x samples, then a pixel is line if any sample is
            l4 = boundary(ids, d, P['depth_lines'])
            H, W = mid.shape
            line = on & l4[:H * ss, :W * ss].reshape(H, ss, W, ss).any((1, 3))
        else:
            line = boundary(mid, dep, P['depth_lines'])
        for k, c in dark.items():
            out_lab[line & (mid == k)] = darker(c, P['line_dark'])
    rim = sm.edge(on)
    if P['outline_dark'] > 0:
        for y, x in zip(*np.nonzero(rim)):
            base = dark[mid[y, x]] if P['outline_from'] == 'darkest' else out_lab[y, x]
            out_lab[y, x] = darker(base, P['outline_dark'])
    rgb = (np.clip(lab2rgb(out_lab), 0, 1) * 255).round().astype(np.uint8)
    out = np.zeros(mid.shape + (4,), np.uint8)
    out[..., :3] = np.where(on[..., None], rgb, 0)
    out[..., 3] = np.where(on, 255, 0)
    return out, {'materials': int(mid.max() + 1), 'line_px': int(line.sum()), 'rim_px': int(rim.sum())}


def pick_resize(raw, w, h, *extra):
    """raw (and same-sized `extra` maps) at w x h without averaging: a target pixel is opaque when most of its source
    block is, and takes every map's value at the opaque source pixel nearest the block centre."""
    H, W = raw.shape[:2]
    on = raw[..., 3] >= 128
    outs = [np.zeros((h, w) + x.shape[2:], x.dtype) for x in (raw,) + extra]
    for ty in range(h):
        y0 = int(ty * H / h)
        y1 = max(y0 + 1, int(round((ty + 1) * H / h)))
        for tx in range(w):
            x0 = int(tx * W / w)
            x1 = max(x0 + 1, int(round((tx + 1) * W / w)))
            blk = on[y0:y1, x0:x1]
            if blk.sum() * 2 < blk.size:
                continue
            ys, xs = np.nonzero(blk)
            k = ((ys - (y1 - y0 - 1) / 2) ** 2 + (xs - (x1 - x0 - 1) / 2) ** 2).argmin()
            for o, x in zip(outs, (raw,) + extra):
                o[ty, tx] = x[y0 + ys[k], x0 + xs[k]]
    return outs


PRESET = Path(__file__).resolve().parent.parent / 'presets' / 'finish-c.json'


def needs_ssi(P):
    """The pack-palette variants need --ssi sprites: without them finish_c keeps the render's own colours, unstretched."""
    return P['palette'] in ('ssi', 'ssi_tone', 'snap')


def load_preset(path, variant):
    pre = json.loads(Path(path).read_text())
    P = dict(pre['defaults'])
    variant = variant or pre.get('default_variant')
    if variant:
        P.update(pre['variants'][variant])
    return P


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('raw')
    ap.add_argument('alb')
    ap.add_argument('depth')
    ap.add_argument('out')
    ap.add_argument('--preset', default=str(PRESET))
    ap.add_argument('--variant')
    ap.add_argument('--ssi', nargs='*', default=[])
    ap.add_argument('--ss', type=int, default=4)
    a = ap.parse_args()
    P = load_preset(a.preset, a.variant)
    if needs_ssi(P) and not a.ssi:
        ap.error(f"finish C {a.variant or 'default'} uses the {P['palette']} palette: add --ssi <pack sprites>")
    out, info = finish_c(sm.load(a.raw), np.asarray(Image.open(a.alb).convert('RGB')), np.asarray(Image.open(a.depth)),
                         P, a.ssi, a.ss)
    Image.fromarray(out).save(a.out)
    print(json.dumps(info))


if __name__ == '__main__':
    main()
