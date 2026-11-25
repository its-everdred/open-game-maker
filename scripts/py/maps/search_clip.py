"""Rank indexed, vision-authorized map embeddings using a cached local CLIP text encoder."""
import json
import math
import sys
from pathlib import Path

MODEL = "openai/clip-vit-large-patch14"


def score(vector, views):
    """Mean cosine similarity over the stored whole-image and centre embeddings."""
    length = math.sqrt(sum(x * x for x in vector))
    if not length or not all(math.isfinite(x) for x in vector):
        return None
    scores = []
    for view in views:
        if len(view) != len(vector) or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in view):
            return None
        magnitude = math.sqrt(sum(x * x for x in view))
        if not magnitude:
            return None
        scores.append(sum(a * b for a, b in zip(vector, view)) / (length * magnitude))
    return sum(scores) / len(scores) if scores else None


def scores(root, rows, vector):
    root = Path(root).resolve(strict=True)
    result = {}
    for row in rows:
        try:
            source = Path(row['source_file'])
            collection = Path(row['source_folder'])
            if (source.is_absolute() or collection.is_absolute() or '..' in source.parts or '..' in collection.parts
                    or not source.parts or source.parts[0] != 'maps'
                    or len(collection.parts) != 2 or collection.parts[0] != 'inspiration'):
                continue
            relative = Path(*source.parts[1:]).with_suffix('')
            collection_root = (root / collection).resolve(strict=True)
            if collection_root != root / collection:
                continue
            analysis = (collection_root / 'analysis').resolve(strict=True)
            sidecar = (analysis / (str(relative) + '.analysis.json')).resolve(strict=True)
            if not analysis.is_relative_to(collection_root) or not sidecar.is_relative_to(analysis):
                continue
            if sidecar.stat().st_size > 1_000_000:
                continue
            data = json.loads(sidecar.read_text())
            if data.get('map') != str(Path(*source.parts[1:])) or 'sha256:' + data.get('sha256', '') != row['content_hash']:
                continue
            clip = data.get('clip', {})
            if clip.get('model') != MODEL:
                continue
            value = score(vector, clip.get('embeddings', []))
            if value is not None:
                result[row['id']] = value
        except (AttributeError, KeyError, OSError, ValueError, TypeError):
            continue
    return result


def main():
    request = json.load(sys.stdin)
    import torch
    from transformers import CLIPModel, CLIPProcessor
    torch.set_num_threads(3)
    model = CLIPModel.from_pretrained(MODEL, local_files_only=True).eval()
    processor = CLIPProcessor.from_pretrained(MODEL, local_files_only=True)
    with torch.no_grad():
        vector = model.get_text_features(**processor(text=[request['query']], return_tensors='pt', padding=True))
    print(json.dumps(scores(request['root'], request['rows'], vector[0].tolist())))


if __name__ == '__main__':
    main()
