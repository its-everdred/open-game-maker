"""Rank rights-eligible local visual previews against a mock crop with cached CLIP.

This is a shortlist, not an asset selection or a game-camera renderer. The
caller must establish that the mock itself permits local vision processing.
"""
import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tag_sheets

MODEL = tag_sheets.CLIP_ID
ENCODERS = {
    "clip": (MODEL, "32bd64288804d66eefd0ccbe215aa642df71cc41"),
    "siglip": ("google/siglip-base-patch16-224", "7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed"),
}
MAX_PIXELS = 25_000_000
MAX_TOTAL_PIXELS = 50_000_000
MAX_MOCK_BYTES = 64 * 1024 * 1024


def encoder_signature(encoder, transformers_version, pillow_version):
    model_id, revision = ENCODERS[encoder]
    return f"{model_id}@{revision}:rgb-brown-v1:transformers-{transformers_version}:pillow-{pillow_version}"


def crop_mock(path, bounds):
    return crop_mock_regions(path, [bounds])[0]


def crop_mock_regions(path, bounds_list):
    return crop_mock_bytes(read_mock_bytes(path), bounds_list)


def read_mock_bytes(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_MOCK_BYTES + 1)
    if len(data) > MAX_MOCK_BYTES:
        raise ValueError("mock exceeds file size limit")
    return data


def crop_mock_bytes(data, bounds_list):
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > MAX_PIXELS:
            raise ValueError("mock exceeds image size limit")
        total_pixels = 0
        for x, y, width, height in bounds_list:
            if min(x, y) < 0 or min(width, height) < 1 or x + width > image.width or y + height > image.height:
                raise ValueError("crop exceeds mock bounds")
            total_pixels += width * height
        if total_pixels > MAX_TOTAL_PIXELS:
            raise ValueError("crops exceed image size limit")
        return [flatten(image.crop((x, y, x + width, y + height))) for x, y, width, height in bounds_list]


def flatten(image):
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (74, 62, 45, 255))
    background.alpha_composite(rgba)
    return background.convert("RGB")


def eligible(assets_root, pack_id, limit, facing):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", pack_id) or ".." in pack_id:
        raise ValueError("invalid pack id")
    packs = assets_root.resolve() / "packs"
    pack = packs / pack_id
    if packs.is_symlink() or pack.is_symlink() or not pack.is_dir():
        raise ValueError("pack is missing or is a symlink")
    code, failures, _ = tag_sheets.validate(packs, [], [pack_id])
    if code or failures:
        raise ValueError("pack cards failed rights and schema validation")
    rows = tag_sheets.eligible_cards(pack, "sprite", include_reviewed=True, required_uses=("vision-input", "in-game"), facing=facing)
    rows = [row for row in rows if row["card"].get("status") != "quarantined" and row["preview"].is_file()]
    ids = [row["card"].get("id") for row in rows]
    if any(not isinstance(value, str) or not value for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("candidate card ids are missing or duplicated")
    return rows[:limit], len(rows)


def rank(ids, vectors):
    array = np.asarray(vectors, dtype=np.float64)
    if array.ndim != 2 or array.shape[0] != len(ids) + 1 or array.shape[1] == 0 or not np.isfinite(array).all():
        raise ValueError("invalid image embeddings")
    norms = np.linalg.norm(array, axis=1)
    if not np.isfinite(norms).all() or np.any(norms == 0):
        raise ValueError("invalid image embeddings")
    normalized = array / norms[:, None]
    scores = normalized[1:] @ normalized[0]
    return sorted(({"id": name, "similarity": float(score)} for name, score in zip(ids, scores)),
                  key=lambda item: (-item["similarity"], item["id"]))[:3]


def embed(images, encoder):
    import torch
    import transformers
    import PIL

    torch.set_num_threads(2)
    model_id, revision = ENCODERS[encoder]
    if encoder == "siglip":
        from transformers import SiglipImageProcessor, SiglipModel
        model = SiglipModel.from_pretrained(model_id, revision=revision, local_files_only=True).eval()
        processor = SiglipImageProcessor.from_pretrained(model_id, revision=revision, local_files_only=True)
    else:
        from transformers import CLIPModel, CLIPProcessor
        model = CLIPModel.from_pretrained(model_id, revision=revision, local_files_only=True).eval()
        processor = CLIPProcessor.from_pretrained(model_id, revision=revision, local_files_only=True, use_fast=False)
    features = []
    with torch.inference_mode():
        for start in range(0, len(images), 8):
            inputs = processor(images=images[start:start + 8], return_tensors="pt")
            if encoder == "siglip":
                batch = model.get_image_features(pixel_values=inputs["pixel_values"])
            else:
                batch = model.visual_projection(model.vision_model(pixel_values=inputs["pixel_values"]).pooler_output)
            features.extend(batch.cpu().numpy())
            if len(features) % 64 == 0 or len(features) == len(images):
                print(f"scene match: embedded {len(features)} of {len(images)} images", file=sys.stderr, flush=True)
    signature = encoder_signature(encoder, transformers.__version__, PIL.__version__)
    return features, signature


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-root", type=Path, required=True)
    parser.add_argument("--pack", required=True)
    parser.add_argument("--mock", type=Path, required=True)
    parser.add_argument("--crop", required=True, action="append", help="x,y,width,height in pixels; repeat per object")
    parser.add_argument("--facing", required=True, choices=("N", "NE", "E", "SE", "S", "SW", "W", "NW"))
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--encoder", choices=tuple(ENCODERS), default="clip", help="cached local image encoder")
    parser.add_argument("--include-vectors", action="store_true", help="include local embeddings for placement planning")
    args = parser.parse_args()
    if not 1 <= args.limit <= 1000:
        raise ValueError("limit must be between 1 and 1000")
    if len(args.crop) > 32:
        raise ValueError("at most 32 crops may be matched at once")
    bounds_list = []
    for crop in args.crop:
        try:
            bounds = tuple(int(value) for value in crop.split(","))
        except ValueError as error:
            raise ValueError("crop must be x,y,width,height") from error
        if len(bounds) != 4:
            raise ValueError("crop must be x,y,width,height")
        bounds_list.append(bounds)
    rows, total = eligible(args.assets_root, args.pack, args.limit, args.facing)
    if not rows:
        raise ValueError("no eligible preview cards")
    mock_bytes = read_mock_bytes(args.mock)
    images = crop_mock_bytes(mock_bytes, bounds_list)
    total_pixels = sum(image.width * image.height for image in images)
    for row in rows:
        with Image.open(row["preview"]) as image:
            total_pixels += image.width * image.height
            if image.width * image.height > MAX_PIXELS or total_pixels > MAX_TOTAL_PIXELS:
                raise ValueError("previews exceed image size limit")
            images.append(flatten(image))
    vectors, signature = embed(images, args.encoder)
    ids = [row["card"]["id"] for row in rows]
    query_count = len(bounds_list)
    if len(vectors) != query_count + len(ids):
        raise ValueError("encoder returned an unexpected number of embeddings")
    candidates = vectors[query_count:]
    results = [rank(ids, [query, *candidates]) for query in vectors[:query_count]]
    output = {"model": signature, "mock_sha256": hashlib.sha256(mock_bytes).hexdigest(), "matches": results[0], "examined": len(rows), "eligible": total,
              "truncated": len(rows) < total, "preview": f"source facing {args.facing}; camera match not verified"}
    if args.include_vectors:
        output["query"] = {"model": signature, "vector": np.asarray(vectors[0]).tolist()}
        output["candidates"] = [{"id": name, "model": signature, "vector": np.asarray(vector).tolist()}
                                for name, vector in zip(ids, candidates)]
    if query_count > 1:
        output["regions"] = [
            {"crop": list(bounds), "matches": matches, **({"query": {"model": signature, "vector": np.asarray(vector).tolist()}} if args.include_vectors else {})}
            for bounds, matches, vector in zip(bounds_list, results, vectors[:query_count])
        ]
    print(json.dumps(output, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"scene match: {error}", file=sys.stderr)
        sys.exit(1)
