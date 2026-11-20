"""Keep draft render destinations within a fresh output tree."""
from pathlib import Path


def variant_destination(output, row, variant):
    root = Path(output).resolve()
    target = root / row / f'v{variant}'
    resolved = target.resolve()
    if 'packs' in resolved.parts or not resolved.is_relative_to(root):
        raise ValueError('variant destination escapes the output tree')
    if target.exists() or target.is_symlink():
        raise FileExistsError(f'variant already exists: {target}')
    return resolved
