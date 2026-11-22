"""Review matrix for the #1202 rig/motion spike: the pack's own animation in column 1, then each rig/motion cell.

Usage: matrix_media.py <out_dir> <pack_sheet.png> <title> <cell_dir> ... [--rows 1,2] [--fps 15] [--loops 4]
Each cell_dir holds out/sheet.png, scores.json (score_cell.py) and recipe.json (kind, model, cost, skill, arm,
motion, licence). Writes, per sheet row (direction) and zoom (1x, 4x): matrix_<dir>_<zoom>x.gif (loops forever) and
.mp4 (H.264 Main 4.1, yuv420p, constant frame rate, for the phone), plus matrix.json with every cell's label and scores.
Cells are nearest-neighbour enlarged; a loop's frames start at its scored phase so all columns step together.
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
BG = (58, 58, 68, 255)
FG = (235, 235, 240, 255)
DIM = (170, 170, 185, 255)


def font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def frames(sheet, row, shift=0, cell=128):
    im = Image.open(sheet).convert('RGBA')
    fr = [im.crop((c * cell, row * cell, c * cell + cell, row * cell + cell)) for c in range(im.width // cell)]
    return fr[shift:] + fr[:shift]


def label_lines(rec, sc):
    if rec is None:
        return ['Pack original', 'SmallScaleInt sheet', '']
    def fmt(x):
        return 'n/a' if x is None else f'{x:.2f}'
    return [rec['name'],
            f"{rec['kind']} · {rec['model']} · ${rec['cost_usd']:.2f}",
            f"{rec['skill']} · {rec['motion_licence']}",
            f"corr {fmt(sc['motion_corr'])} · IoU {fmt(sc['silhouette_iou'])} · slide {fmt(sc['foot_slide']['mean_px'])} px"
            f" · {sc['render_minutes']:.0f} min"]


def compose(cols, labels, zoom, crop):
    """cols: list of frame lists; returns list of composed RGBA frames."""
    w = max((crop[2] - crop[0]) * zoom, 230 if zoom > 1 else 200)
    h = (crop[3] - crop[1]) * zoom
    fs = 13 if zoom > 1 else 10
    f = font(fs)
    head = (fs + 4) * max(len(x) for x in labels) + 6
    out = []
    for i in range(len(cols[0])):
        canvas = Image.new('RGBA', (w * len(cols), h + head), BG)
        d = ImageDraw.Draw(canvas)
        for c, (col, lab) in enumerate(zip(cols, labels)):
            for k, line in enumerate(lab):
                d.text((c * w + 6, 4 + k * (fs + 4)), line, font=f, fill=FG if k == 0 else DIM)
            cell = col[i % len(col)].crop(crop)
            cell = cell.resize((cell.width * zoom, cell.height * zoom), Image.NEAREST)
            canvas.alpha_composite(cell, (c * w + (w - cell.width) // 2, head))
        out.append(canvas)
    return out


def write(frames_, base, fps, loops):
    rgb = [Image.alpha_composite(Image.new('RGBA', f.size, BG), f).convert('RGB') for f in frames_]
    rgb[0].save(f'{base}.gif', save_all=True, append_images=rgb[1:], duration=round(1000 / fps), loop=0, disposal=2)
    with tempfile.TemporaryDirectory() as t:
        for i in range(len(rgb) * loops):
            rgb[i % len(rgb)].save(f'{t}/f{i:04d}.png')
        w, h = rgb[0].size
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', f'{t}/f%04d.png',
                        '-vf', f'scale={w + w % 2}:{h + h % 2}:flags=neighbor', '-c:v', 'libx264', '-profile:v', 'main',
                        '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-r', str(fps), '-movflags', '+faststart',
                        f'{base}.mp4'], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path)
    ap.add_argument('pack')
    ap.add_argument('title')
    ap.add_argument('cells', nargs='+', type=Path)
    ap.add_argument('--rows', default='1,2')
    ap.add_argument('--fps', type=int, default=15)
    ap.add_argument('--loops', type=int, default=4)
    a = ap.parse_args()
    if len(a.cells) > 6:
        ap.error('at most 6 cells beside the pack')
    a.out.mkdir(parents=True, exist_ok=True)
    recs = [json.loads((c / 'recipe.json').read_text()) for c in a.cells]
    scs = [json.loads((c / 'scores.json').read_text()) for c in a.cells]
    index = {'title': a.title, 'pack': Path(a.pack).name, 'cells': [], 'media': []}
    for row in (int(r) for r in a.rows.split(',')):
        cols = [frames(a.pack, row)] + [frames(c / 'out/sheet.png', row, sc.get('phase_shift', 0))
                                         for c, sc in zip(a.cells, scs)]
        box = None
        for col in cols:  # one crop for every column: the union of all frames' boxes, so sizes stay comparable
            for im in col:
                b = im.getbbox()
                if b:
                    box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        box = (max(0, box[0] - 3), max(0, box[1] - 3), min(128, box[2] + 3), min(128, box[3] + 3))
        labels = [label_lines(None, None)] + [label_lines(r, s) for r, s in zip(recs, scs)]
        for zoom in (1, 4):
            base = a.out / f'matrix_{DIRS[row]}_{zoom}x'
            write(compose(cols, labels, zoom, box), base, a.fps, a.loops)
            index['media'] += [f'{base.name}.gif', f'{base.name}.mp4']
    index['cells'] = [{'dir': str(c), 'recipe': r, 'scores': {k: v for k, v in s.items() if k != 'foot_slide'} |
                       {'foot_slide_px': s['foot_slide']['mean_px']}} for c, r, s in zip(a.cells, recs, scs)]
    (a.out / 'matrix.json').write_text(json.dumps(index, indent=1))
    print('\n'.join(index['media']))


if __name__ == '__main__':
    main()
