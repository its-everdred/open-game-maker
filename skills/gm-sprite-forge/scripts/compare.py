"""Render local side-by-side sprite review media; see references/review-lane.md."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import GifImagePlugin, Image, ImageDraw

import score
import spritemetrics as sm

BG = (92, 120, 92, 255)
GATES = json.loads((Path(__file__).resolve().parent.parent / 'gates.json').read_text())


def on_bg(a, zoom):
    image = Image.new('RGBA', (a.shape[1], a.shape[0]), BG)
    image.alpha_composite(Image.fromarray(a))
    return image.resize((a.shape[1] * zoom, a.shape[0] * zoom), Image.Resampling.NEAREST)


def diff_img(o, r, zoom):
    delta = np.abs(score.on_grey(o) - score.on_grey(r)).mean(-1)
    heat = np.zeros(o.shape, np.uint8)
    heat[..., 0] = np.clip(delta * 3, 0, 255)
    heat[..., 1] = np.clip(255 - delta * 3, 0, 255)
    heat[..., 3] = 255
    return Image.fromarray(heat).resize((o.shape[1] * zoom, o.shape[0] * zoom), Image.Resampling.NEAREST)


def with_gates(result, gate):
    result['gates'] = score.gate_results(result, GATES[gate])
    result['pass'] = all(item['pass'] for item in result['gates'].values())
    return result


def verdict_lines(result, gate):
    lines = [f"Gate: {gate}  {'PASS' if result['pass'] else 'FAIL'}"]
    for metric, item in result['gates'].items():
        value = item['value']
        value = f'{value:.3f}' if isinstance(value, float) else str(value)
        rule = ', '.join(f'{op} {threshold}' for op, threshold in item['rule'].items())
        lines.append(f"{metric}: {value} ({rule}) {'PASS' if item['pass'] else 'FAIL'}")
    return lines


def still(pairs, labels, out, zoom):
    rows = []
    for (original, rebuild), label in zip(pairs, labels):
        o, r = sm.load(original), sm.load(rebuild)
        if o.shape != r.shape:
            raise ValueError(f'size mismatch: {original} and {rebuild}')
        result = with_gates(score.compare(o, r), 'prop')
        rows.append((label, [on_bg(o, zoom), on_bg(r, zoom), diff_img(o, r, zoom)], result))
    line_height = 15
    width = max(720, max(sum(im.width for im in images) + 40 for _, images, _ in rows))
    height = sum(images[0].height + (len(verdict_lines(result, 'prop')) + 1) * line_height + 10
                 for _, images, result in rows)
    canvas = Image.new('RGB', (width, height), (24, 24, 24))
    draw = ImageDraw.Draw(canvas)
    y = 0
    for label, images, result in rows:
        x = 10
        for image in images:
            canvas.paste(image, (x, y))
            x += image.width + 10
        y += images[0].height + 3
        draw.text((10, y), f'{label}  original | rebuild | diff', fill='white')
        y += line_height
        for line in verdict_lines(result, 'prop'):
            draw.text((10, y), line, fill='white')
            y += line_height
        y += 7
    canvas.save(out)
    return {label: result for label, _, result in rows}


def write_gif(frames, path, fps):
    # Write each frame explicitly: Pillow's save_all merges identical holds.
    with path.open('wb') as output:
        for index, frame in enumerate(frames):
            indexed = frame.convert('P', palette=Image.Palette.ADAPTIVE)
            if index == 0:
                header, _ = GifImagePlugin.getheader(indexed, info={'loop': 0})
                for block in header:
                    output.write(block)
            start = round(index * 100 / fps)
            end = round((index + 1) * 100 / fps)
            for block in GifImagePlugin.getdata(indexed, duration=(end - start) * 10,
                                                 disposal=2, include_color_table=True):
                output.write(block)
        output.write(b';')


def write_mp4(frames, path, fps):
    width, height = frames[0].size
    # Scale down only; pad to even dimensions for yuv420p.
    vf = "scale='min(1280,iw)':-2:flags=neighbor,pad=ceil(iw/2)*2:ceil(ih/2)*2"
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
           '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}', '-framerate', str(fps),
           '-i', '-', '-vf', vf, '-an', '-c:v', 'libx264', '-profile:v', 'main',
           '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(path)]
    subprocess.run(cmd, input=b''.join(frame.tobytes() for frame in frames), check=True)


def sheet_media(orig, rebuild, cell, outdir, zoom, fps, gate):
    o, r = sm.load(orig), sm.load(rebuild)
    if o.shape != r.shape:
        raise ValueError('sheet sizes must match')
    if cell <= 0 or o.shape[0] % cell or o.shape[1] % cell:
        raise ValueError('cell must be positive and divide both sheet dimensions')
    result = with_gates(score.score(orig, rebuild, cell), gate)
    go, gr = sm.cells(o, cell), sm.cells(r, cell)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    lines = verdict_lines(result, gate)
    tiles = Image.new('RGB', (max(720, len(go) * cell * zoom), 2 * cell * zoom + 15 * (len(lines) + 1)), (24, 24, 24))
    for row, (ro, rr) in enumerate(zip(go, gr)):
        tiles.paste(on_bg(ro[0], zoom), (row * cell * zoom, 0))
        tiles.paste(on_bg(rr[0], zoom), (row * cell * zoom, cell * zoom))
        frames = []
        for co, cr in zip(ro, rr):
            frame = Image.new('RGB', (2 * cell * zoom + 8, cell * zoom), (24, 24, 24))
            frame.paste(on_bg(co, zoom), (0, 0))
            frame.paste(on_bg(cr, zoom), (cell * zoom + 8, 0))
            frames.append(frame)
        write_gif(frames, outdir / f'dir{row}.gif', fps)
        write_mp4(frames, outdir / f'dir{row}.mp4', fps)
    draw = ImageDraw.Draw(tiles)
    y = 2 * cell * zoom
    draw.text((0, y), 'original above | rebuild below', fill='white')
    for index, line in enumerate(lines, 1):
        draw.text((0, y + index * 15), line, fill='white')
    tiles.save(outdir / 'still-8dir.png')
    (outdir / 'scores.json').write_text(json.dumps(result, indent=1, allow_nan=False) + '\n')
    return result


def review_sheet(orig, mock, previous, rebuild, cell, out, zoom=4):
    """Make one eight-view, two-track review, rejecting imperceptible changes."""
    if cell <= 4 or zoom < 4:
        raise ValueError('cell must exceed 4 and zoom must be at least 4')
    original, before, after = (sm.load(path) for path in (orig, previous, rebuild))
    if original.shape != before.shape or original.shape != after.shape:
        raise ValueError('original, previous and rebuild sheets must have the same dimensions')
    if original.shape[0] != 8 * cell or original.shape[1] % cell:
        raise ValueError('character sheets must contain eight rows of complete cells')
    generated = Image.open(mock).convert('RGBA')
    if generated.width < 8:
        raise ValueError('image-gen mock must contain eight horizontal views')
    if generated.getchannel('A').getextrema()[0] != 0:
        raise ValueError('image-gen mock must have a transparent background')
    rows = []
    changes = []
    for direction in range(8):
        start = direction * cell
        o, b, a = (sheet[start:start + cell, :cell] for sheet in (original, before, after))
        before_occupied, after_occupied = b[..., 3] >= 128, a[..., 3] >= 128
        occupied = before_occupied | after_occupied
        if not before_occupied.any() or not after_occupied.any():
            raise ValueError(f'direction {direction + 1} has no previous or current sprite')
        changed = np.any(b != a, axis=2) & occupied
        fraction = float(changed.sum() / occupied.sum())
        changes.append(fraction)
        if fraction <= .03:
            raise ValueError(f'direction {direction + 1} changed {fraction:.1%}; more than 3% is required')
        left = round(direction * generated.width / 8)
        right = round((direction + 1) * generated.width / 8)
        view = generated.crop((left, 0, right, generated.height))
        bounds = view.getchannel('A').point(lambda alpha: 255 if alpha >= 128 else 0).getbbox()
        if bounds is None:
            raise ValueError(f'image-gen view {direction + 1} is empty')
        target = Image.fromarray(o).getchannel('A').getbbox()
        if target is None:
            raise ValueError(f'original view {direction + 1} is empty')
        crop = view.crop(bounds)
        width, height = target[2] - target[0], target[3] - target[1]
        scale = min((cell - 4) / crop.width, height / crop.height)
        fitted = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
                             Image.Resampling.NEAREST)
        mock_cell = Image.new('RGBA', (cell, cell))
        x = max(0, min(cell - fitted.width, target[0] + (width - fitted.width) // 2))
        mock_cell.alpha_composite(fitted, (x, target[1] + (height - fitted.height) // 2))
        rows.append((o, np.asarray(mock_cell), b, a))
    tile = cell * zoom
    margin, header, row_gap = 64, 56, 24
    canvas = Image.new('RGB', (margin + 4 * tile, header + 8 * (tile + row_gap)), (24, 24, 24))
    draw = ImageDraw.Draw(canvas)
    for column, label in enumerate(('Original', 'image gen (AI)', 'Previous 3D', '3D pipeline (AI)')):
        draw.text((margin + column * tile + 4, 8), label, fill='white')
    draw.text((margin, 28), 'Image gen is fitted to the original sprite size; previous and current are adjacent.', fill='white')
    for direction, row in enumerate(rows):
        y = header + direction * (tile + row_gap)
        draw.text((4, y + 4), f'View {direction + 1}', fill='white')
        for column, image in enumerate(row):
            canvas.paste(on_bg(image, zoom), (margin + column * tile, y))
    canvas.save(out)
    return {'changed_fraction_by_view': changes, 'zoom': zoom}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    prop = sub.add_parser('still')
    prop.add_argument('--pairs', nargs='+', required=True, metavar='ORIGINAL:REBUILD')
    prop.add_argument('--labels', help='comma-separated view labels')
    prop.add_argument('--out', required=True)
    prop.add_argument('--zoom', type=int, default=4)
    sheet = sub.add_parser('sheet')
    sheet.add_argument('orig')
    sheet.add_argument('rebuild')
    sheet.add_argument('--cell', type=int, required=True)
    sheet.add_argument('--out', required=True)
    sheet.add_argument('--zoom', type=int, default=4)
    sheet.add_argument('--fps', type=int, default=12)
    sheet.add_argument('--gates', choices=['character-64', 'character-128'], required=True)
    review = sub.add_parser('review')
    review.add_argument('orig')
    review.add_argument('mock')
    review.add_argument('previous')
    review.add_argument('rebuild')
    review.add_argument('--cell', type=int, required=True)
    review.add_argument('--out', required=True)
    review.add_argument('--zoom', type=int, default=4)
    args = parser.parse_args()
    if args.zoom <= 0 or (args.mode == 'sheet' and not 1 <= args.fps <= 100):
        parser.error('zoom must be positive and fps must be between 1 and 100')
    if args.mode == 'still':
        pairs = [pair.split(':') for pair in args.pairs]
        labels = args.labels.split(',') if args.labels else [str(i) for i in range(len(pairs))]
        if any(len(pair) != 2 or not all(pair) for pair in pairs) or len(labels) != len(pairs):
            parser.error('provide one ORIGINAL:REBUILD pair per label')
        result = still(pairs, labels, args.out, args.zoom)
    elif args.mode == 'sheet':
        result = sheet_media(args.orig, args.rebuild, args.cell, args.out, args.zoom, args.fps, args.gates)
    else:
        result = review_sheet(args.orig, args.mock, args.previous, args.rebuild, args.cell, args.out, args.zoom)
    print(json.dumps(result, indent=1, allow_nan=False))


if __name__ == '__main__':
    main()
