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
