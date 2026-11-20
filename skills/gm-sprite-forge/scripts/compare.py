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


def review_round(views, labels, out, zoom, first_round=False):
    """Render both tracks and reject imperceptible follow-up changes."""
    if zoom < 4:
        raise ValueError('review rounds require zoom of at least 4')
    if not views or len(views) != len(labels) or len(set(labels)) != len(labels):
        raise ValueError('provide a unique label for each view')
    rows = []
    for paths, label in zip(views, labels):
        if len(paths) != (3 if first_round else 5):
            raise ValueError(f'{label}: wrong number of images')
        arrays = [sm.load(path) for path in paths]
        if any(a.shape != arrays[0].shape for a in arrays):
            raise ValueError(f'{label}: image sizes must match')
        fractions = {}
        if not first_round:
            for name, previous, current in [('image gen', arrays[3], arrays[1]),
                                             ('3D pipeline', arrays[4], arrays[2])]:
                before = np.asarray(on_bg(previous, 1).convert('RGB'))
                after = np.asarray(on_bg(current, 1).convert('RGB'))
                fraction = float(np.any(before != after, axis=2).mean())
                fractions[name] = fraction
                if fraction <= 0.03:
                    raise ValueError(f'{label} {name}: {fraction:.2%} changed; must exceed 3%')
        rows.append((label, [on_bg(a, zoom) for a in arrays], fractions))
    gap, line = 10, 18
    columns = 3 if first_round else 4
    width = max(720, max(columns * (max(images[0].width, 150) + gap) + gap for _, images, _ in rows))
    height = sum(images[0].height * (1 if first_round else 2) + line * (2 if first_round else 4) + gap
                 for _, images, _ in rows)
    canvas = Image.new('RGB', (width, height), (24, 24, 24))
    draw = ImageDraw.Draw(canvas)
    y = 0
    for label, images, _ in rows:
        step = max(images[0].width, 150) + gap
        draw.text((gap, y), label, fill='white')
        y += line
        x = gap
        for name, image in zip(('original', 'image gen', '3D pipeline'), images[:3]):
            draw.text((x, y), name, fill='white')
            x += step
        y += line
        x = gap
        for image in images[:3]:
            canvas.paste(image, (x, y))
            x += step
        y += images[0].height
        if not first_round:
            x = gap
            for name, image in zip(('previous image gen', 'this image gen', 'previous 3D pipeline', 'this 3D pipeline'),
                                   (images[3], images[1], images[4], images[2])):
                draw.text((x, y), name, fill='white')
                x += step
            y += line
            x = gap
            for image in (images[3], images[1], images[4], images[2]):
                canvas.paste(image, (x, y))
                x += step
            y += images[0].height + line
        y += gap
    canvas.save(out)
    return {label: fractions for label, _, fractions in rows}


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    prop = sub.add_parser('still')
    prop.add_argument('--pairs', nargs='+', required=True, metavar='ORIGINAL:REBUILD')
    prop.add_argument('--labels', help='comma-separated view labels')
    prop.add_argument('--out', required=True)
    prop.add_argument('--zoom', type=int, default=4)
    review = sub.add_parser('round')
    review.add_argument('--views', nargs='+', required=True, metavar='ORIGINAL:IMAGE:PIPELINE[:PREV_IMAGE:PREV_PIPELINE]')
    review.add_argument('--labels', required=True)
    review.add_argument('--out', required=True)
    review.add_argument('--zoom', type=int, default=4)
    review.add_argument('--first-round', action='store_true')
    sheet = sub.add_parser('sheet')
    sheet.add_argument('orig')
    sheet.add_argument('rebuild')
    sheet.add_argument('--cell', type=int, required=True)
    sheet.add_argument('--out', required=True)
    sheet.add_argument('--zoom', type=int, default=4)
    sheet.add_argument('--fps', type=int, default=12)
    sheet.add_argument('--gates', choices=['character-64', 'character-128'], required=True)
    args = parser.parse_args()
    if args.zoom <= 0 or (args.mode == 'sheet' and not 1 <= args.fps <= 100):
        parser.error('zoom must be positive and fps must be between 1 and 100')
    if args.mode == 'round':
        try:
            result = review_round([view.split(':') for view in args.views], args.labels.split(','),
                                  args.out, args.zoom, args.first_round)
        except ValueError as error:
            parser.error(str(error))
    elif args.mode == 'still':
        pairs = [pair.split(':') for pair in args.pairs]
        labels = args.labels.split(',') if args.labels else [str(i) for i in range(len(pairs))]
        if any(len(pair) != 2 or not all(pair) for pair in pairs) or len(labels) != len(pairs):
            parser.error('provide one ORIGINAL:REBUILD pair per label')
        result = still(pairs, labels, args.out, args.zoom)
    else:
        result = sheet_media(args.orig, args.rebuild, args.cell, args.out, args.zoom, args.fps, args.gates)
    print(json.dumps(result, indent=1, allow_nan=False))


if __name__ == '__main__':
    main()
