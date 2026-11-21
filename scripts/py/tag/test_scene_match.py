import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import scene_match as scene


def test_encoder_signature_pins_model_and_preprocessing_versions():
    value = scene.encoder_signature("siglip", "4.57.6", "11.0.0")
    assert value == "google/siglip-base-patch16-224@7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed:rgb-brown-v1:transformers-4.57.6:pillow-11.0.0"
    assert value != scene.encoder_signature("siglip", "4.57.7", "11.0.0")
    assert value != scene.encoder_signature("siglip", "4.57.6", "11.0.1")


def test_rank_uses_visual_similarity_and_reports_three_stable_matches():
    result = scene.rank(["far", "near", "exact", "middle"], [[1, 0], [-1, 0], [2, 1], [5, 0], [0, 1]])
    assert [item["id"] for item in result] == ["exact", "near", "middle"]
    assert result[0]["similarity"] == pytest.approx(1)
    with pytest.raises(ValueError, match="embeddings"):
        scene.rank(["bad"], [[1, 0], [float("nan"), 1]])


def test_mock_crop_checks_bounds_and_composites_alpha(tmp_path):
    path = tmp_path / "mock.png"
    Image.new("RGBA", (4, 4), (255, 0, 0, 0)).save(path)
    crop = scene.crop_mock(path, (1, 1, 2, 2))
    assert crop.size == (2, 2)
    assert crop.getpixel((0, 0)) == (74, 62, 45)
    with pytest.raises(ValueError, match="bounds"):
        scene.crop_mock(path, (3, 3, 2, 2))


def test_catalog_search_rejects_invalid_pack_and_validation_failure(tmp_path, monkeypatch):
    (tmp_path / "packs" / "pack").mkdir(parents=True)
    with pytest.raises(ValueError, match="invalid pack"):
        scene.eligible(tmp_path, "../pack", 10, "E")
    monkeypatch.setattr(scene.tag_sheets, "validate", lambda *args: (1, ["FAIL"], ""))
    with pytest.raises(ValueError, match="rights and schema"):
        scene.eligible(tmp_path, "pack", 10, "E")


def test_worker_outputs_vectors_for_placement_and_marks_truncation(tmp_path, monkeypatch, capsys):
    import json

    mock = tmp_path / "mock.png"
    sprite = tmp_path / "sprite.png"
    Image.new("RGBA", (4, 4), (10, 20, 30, 255)).save(mock)
    Image.new("RGBA", (2, 2), (30, 20, 10, 255)).save(sprite)
    monkeypatch.setattr(scene, "eligible", lambda *args: ([{"card": {"id": "asset"}, "preview": sprite}], 2))
    signature = "clip@revision:rgb-brown-v1:transformers-test:pillow-test"
    monkeypatch.setattr(scene, "embed", lambda images, encoder: ([[1, 0], [2, 1]], signature))
    monkeypatch.setattr(sys, "argv", ["scene_match.py", "--assets-root", str(tmp_path), "--pack", "pack", "--mock", str(mock), "--crop", "0,0,4,4", "--facing", "E", "--include-vectors"])
    scene.main()
    output = json.loads(capsys.readouterr().out)
    assert output["truncated"] is True
    assert output["query"] == {"model": signature, "vector": [1, 0]}
    assert output["candidates"][0] == {"id": "asset", "model": signature, "vector": [2, 1]}
    assert output["matches"][0]["id"] == "asset"


def test_worker_identifies_the_requested_local_encoder(tmp_path, monkeypatch, capsys):
    import json

    mock = tmp_path / "mock.png"
    sprite = tmp_path / "sprite.png"
    Image.new("RGB", (2, 2), (10, 20, 30)).save(mock)
    Image.new("RGB", (2, 2), (30, 20, 10)).save(sprite)
    monkeypatch.setattr(scene, "eligible", lambda *args: ([{"card": {"id": "asset"}, "preview": sprite}], 1))
    seen = []
    def fake_embed(images, encoder):
        seen.append(encoder)
        return [[1, 0], [1, 0]], "siglip@revision:rgb-brown-v1:transformers-test:pillow-test"
    monkeypatch.setattr(scene, "embed", fake_embed)
    monkeypatch.setattr(sys, "argv", ["scene_match.py", "--assets-root", str(tmp_path), "--pack", "pack", "--mock", str(mock), "--crop", "0,0,2,2", "--facing", "E", "--encoder", "siglip", "--include-vectors"])
    scene.main()
    output = json.loads(capsys.readouterr().out)
    assert seen == ["siglip"]
    assert output["model"] == "siglip@revision:rgb-brown-v1:transformers-test:pillow-test"
    assert output["query"]["model"] == output["candidates"][0]["model"] == output["model"]
