"""Reject vegetation candidates whose alpha footprint differs from a reference."""
import argparse
import json
from pathlib import Path

from PIL import Image


def measure(path):
    if isinstance(path, Image.Image):
        rgba = path.convert('RGBA')
    else:
        with Image.open(path) as image:
            rgba = image.convert('RGBA')
    alpha = rgba.getchannel('A')
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError(f'empty alpha mask: {path}')
    histogram = alpha.histogram()
    pixels = rgba.tobytes()
    shadow = sum(1 for r, g, b, a in zip(pixels[0::4], pixels[1::4], pixels[2::4], pixels[3::4])
                 if 0 < a < 255 and max(r, g, b) <= 8)
    return {'width': bbox[2] - bbox[0], 'height': bbox[3] - bbox[1],
            'coverage': sum(histogram[1:]), 'shadow': shadow}


def compare(reference, candidate, tolerance=0.15):
    if not 0 <= tolerance < 1:
        raise ValueError('invalid tolerance')
    base, actual = measure(reference), measure(candidate)
    ratios = {key: (actual[key] / base[key] if base[key] else (1.0 if not actual[key] else None))
              for key in base}
    return {'reference': base, 'candidate': actual, 'ratios': ratios,
            'pass': all(value is not None and 1 - tolerance <= value <= 1 + tolerance
                        for value in ratios.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('candidates', type=Path, nargs='+')
    args = parser.parse_args()
    results = {str(path): compare(args.reference, path) for path in args.candidates}
    print(json.dumps(results, indent=2))
    raise SystemExit(0 if all(result['pass'] for result in results.values()) else 1)


if __name__ == '__main__':
    main()
