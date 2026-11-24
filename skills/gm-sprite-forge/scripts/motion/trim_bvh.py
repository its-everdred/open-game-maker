"""Cut a window out of a long BVH take, resampled to 30 fps, with LaFAN1 toe names (#1282 round 3).

100STYLE's retargeted takes (Geno skeleton) run at 60 fps for minutes and call the toe `ToeBase`; bvh_track.py and
guard_walk.py expect LaFAN1's 30 fps and `Toe`, and a whole take is minutes of Blender per joint dump.

Usage: trim_bvh.py <in.bvh> <out.bvh> <first> <last> [--fps 30]   (source frames, 0-based, last excluded)
"""
import argparse


def trim(text, first, last, fps=30):
    """The BVH text of source frames [first, last), keeping one frame in every round(source fps / fps)."""
    lines = text.split('\n')
    i = lines.index('MOTION')
    src_dt = float(next(l for l in lines[i:i + 3] if l.startswith('Frame Time:')).split(':')[1])
    step = max(1, round(1 / (src_dt * fps)))
    head = [l.replace('ToeBase', 'Toe') for l in lines[:i + 1]]
    data = [l for l in lines[i + 3:] if l.strip()][first:last:step]
    return '\n'.join(head + [f'Frames: {len(data)}', f'Frame Time: {src_dt * step:.6f}'] + data) + '\n'


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('first', type=int)
    ap.add_argument('last', type=int)
    ap.add_argument('--fps', type=float, default=30)
    a = ap.parse_args()
    with open(a.src) as f:
        out = trim(f.read(), a.first, a.last, a.fps)
    with open(a.dst, 'w') as f:
        f.write(out)
