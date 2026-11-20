import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import compare


def test_round_layout_and_per_view_difference_floor(tmp_path, monkeypatch):
    base = np.zeros((10, 10, 4), dtype=np.uint8)
    base[:] = [20, 30, 40, 255]
    changed = base.copy()
    changed[0, :4] = [200, 30, 40, 255]
    paths = []
    for name, pixels in [('original', base), ('image', changed), ('pipeline', changed), ('previous', base)]:
        path = tmp_path / f'{name}.png'
        Image.fromarray(pixels).save(path)
        paths.append(path)
    original, image, pipeline, previous = paths
    output = tmp_path / 'round.png'
    labels = []
    draw_text = compare.ImageDraw.ImageDraw.text
    def capture(self, xy, text, *args, **kwargs):
        labels.append((xy, text))
        return draw_text(self, xy, text, *args, **kwargs)
    monkeypatch.setattr(compare.ImageDraw.ImageDraw, 'text', capture)
    result = compare.review_round([(original, image, pipeline, previous, previous)], ['N'], output, 4)
    assert result['N'] == {'image gen': 0.04, '3D pipeline': 0.04}
    assert ((10, 18), 'original') in labels
    assert ((170, 18), 'image gen') in labels
    assert ((330, 18), '3D pipeline') in labels
    assert ((10, 76), 'previous image gen') in labels
    assert ((170, 76), 'this image gen') in labels
    sheet = np.array(Image.open(output))
    assert tuple(sheet[36, 10]) == (20, 30, 40)
    assert tuple(sheet[36, 170]) == (200, 30, 40)
    assert tuple(sheet[36, 330]) == (200, 30, 40)
    output.unlink()
    with pytest.raises(ValueError, match='S 3D pipeline'):
        compare.review_round([(original, image, pipeline, previous, previous),
                              (original, image, previous, previous, previous)], ['N', 'S'], output, 4)
    assert not output.exists()
    with pytest.raises(ValueError, match='at least 4'):
        compare.review_round([(original, image, pipeline)], ['N'], output, 3, first_round=True)


def test_round_rejects_exactly_three_percent(tmp_path):
    base = np.full((10, 10, 4), 255, dtype=np.uint8)
    changed = base.copy()
    changed[0, :3, 0] = 0
    old, new = tmp_path / 'old.png', tmp_path / 'new.png'
    Image.fromarray(base).save(old)
    Image.fromarray(changed).save(new)
    with pytest.raises(ValueError, match='must exceed 3%'):
        compare.review_round([(old, new, new, old, old)], ['N'], tmp_path / 'out.png', 4)


def test_first_round_cli_and_hidden_pixels(tmp_path):
    base = np.zeros((10, 10, 4), dtype=np.uint8)
    changed = base.copy()
    changed[:, :, :3] = 255  # Invisible RGB is not a visible change.
    old, new, output = (tmp_path / name for name in ('old.png', 'new.png', 'out.png'))
    Image.fromarray(base).save(old)
    Image.fromarray(changed).save(new)
    script = Path(compare.__file__)
    subprocess.run([sys.executable, str(script), 'round', '--first-round', '--views',
                    f'{old}:{new}:{new}', '--labels', 'N', '--out', str(output)], check=True)
    assert output.is_file()
    with pytest.raises(ValueError, match='must exceed 3%'):
        compare.review_round([(old, new, new, old, old)], ['N'], output, 4)


def test_identical_heatmap_is_green_and_still_has_gate_text(tmp_path, monkeypatch):
    pixels = np.zeros((8, 8, 4), dtype=np.uint8)
    pixels[2:6, 2:6] = [100, 80, 60, 255]
    assert np.all(np.array(compare.diff_img(pixels, pixels, 1)) == [0, 255, 0, 255])
    source = tmp_path / 'source.png'
    Image.fromarray(pixels).save(source)
    lines = []
    original = compare.ImageDraw.ImageDraw.text
    def capture(self, xy, text, *args, **kwargs):
        lines.append(text)
        return original(self, xy, text, *args, **kwargs)
    monkeypatch.setattr(compare.ImageDraw.ImageDraw, 'text', capture)
    result = compare.still([(source, source)] * 4, ['N', 'E', 'S', 'W'], tmp_path / 'still.png', 1)
    assert result['N']['pass']
    assert any('Gate: prop  PASS' in line for line in lines)
    assert any('silhouette_iou: 1.000 (min 0.9) PASS' in line for line in lines)
    assert (tmp_path / 'still.png').is_file()


def test_review_sheet_requires_visible_change_in_every_view(tmp_path):
    sheet = np.zeros((8 * 16, 16, 4), dtype=np.uint8)
    mock = np.zeros((16, 8 * 16, 4), dtype=np.uint8)
    for row in range(8):
        sheet[row * 16 + 2:row * 16 + 12, 2:12] = [67, 67, 67, 255]
        mock[3:13, row * 16 + 3:row * 16 + 13] = [90, 90, 90, 255]
    original = tmp_path / 'original.png'
    previous = tmp_path / 'previous.png'
    generated = tmp_path / 'mock.png'
    candidate = tmp_path / 'candidate.png'
    for path, pixels in ((original, sheet), (previous, sheet), (generated, mock)):
        Image.fromarray(pixels).save(path)
    updated = sheet.copy()
    for row in range(8):
        updated[row * 16 + 2, 2:6] = [1, 1, 1, 255]
    Image.fromarray(updated).save(candidate)
    out = tmp_path / 'review.png'
    result = compare.review_sheet(original, generated, previous, candidate, 16, out)
    assert result['changed_fraction_by_view'] == pytest.approx([.04] * 8)
    assert Image.open(out).size == (64 + 4 * 16 * 4, 56 + 8 * (16 * 4 + 24))
    updated[7 * 16 + 2, 2:6] = sheet[7 * 16 + 2, 2:6]
    Image.fromarray(updated).save(candidate)
    with pytest.raises(ValueError, match='direction 8 changed'):
        compare.review_sheet(original, generated, previous, candidate, 16, tmp_path / 'rejected.png')
    assert not (tmp_path / 'rejected.png').exists()
    with pytest.raises(ValueError, match='zoom must be at least 4'):
        compare.review_sheet(original, generated, previous, candidate, 16, out, zoom=3)


def test_review_sheet_fits_mock_to_visible_original_not_alpha_noise(tmp_path):
    original = np.zeros((8 * 16, 16, 4), dtype=np.uint8)
    generated = np.zeros((16, 8 * 16, 4), dtype=np.uint8)
    for row in range(8):
        original[row * 16, 0] = [1, 1, 1, 1]
        original[row * 16 + 4:row * 16 + 8, 4:8] = [40, 40, 40, 255]
        generated[2:14, row * 16 + 2:row * 16 + 14] = [255, 255, 255, 255]
    updated = original.copy()
    for row in range(8):
        updated[row * 16 + 4, 4:8] = [80, 80, 80, 255]
    paths = [tmp_path / name for name in ('original.png', 'generated.png', 'updated.png')]
    for path, pixels in zip(paths, (original, generated, updated)):
        Image.fromarray(pixels).save(path)
    out = tmp_path / 'comparison.png'
    compare.review_sheet(paths[0], paths[1], paths[0], paths[2], 16, out)
    panel = np.asarray(Image.open(out))[56:120, 128:192, :3]
    white = np.all(panel == 255, axis=2)
    ys, xs = np.where(white)
    assert (xs.min(), ys.min(), xs.max(), ys.max()) == (16, 16, 31, 31)


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='ffmpeg and ffprobe required')
def test_sheet_outputs_phone_safe_media_and_scores(tmp_path):
    pixels = np.zeros((32, 240, 4), dtype=np.uint8)
    for row in range(2):
        for column in range(15):
            pixels[row * 16 + 2:row * 16 + 10, column * 16 + 2:column * 16 + 10] = [100, 80, 120, 255]
    source = tmp_path / 'sheet.png'
    Image.fromarray(pixels).save(source)
    out = tmp_path / 'review'
    compare.sheet_media(source, source, 16, out, 2, 12, 'character-64')
    assert json.loads((out / 'scores.json').read_text())['pass']
    assert (out / 'still-8dir.png').is_file()
    for row in range(2):
        with Image.open(out / f'dir{row}.gif') as gif:
            assert gif.n_frames == 15
            durations = []
            for frame in range(gif.n_frames):
                gif.seek(frame)
                durations.append(gif.info['duration'])
            assert sum(durations) == 1250
        probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                                '-show_entries', 'stream=profile,pix_fmt,width,height,level,nb_read_frames',
                                '-of', 'json', str(out / f'dir{row}.mp4')], capture_output=True, text=True, check=True)
        stream = json.loads(probe.stdout)['streams'][0]
        assert stream['profile'] == 'Main'
        assert stream['pix_fmt'] == 'yuv420p'
        assert stream['width'] <= 1280 and stream['width'] % 2 == stream['height'] % 2 == 0
        assert stream['level'] <= 41
        assert stream['nb_read_frames'] == '15'
