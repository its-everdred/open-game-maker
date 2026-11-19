"""Synthetic regression tests for the Drive-drop readers."""
import io
import base64
import json
from pathlib import Path
import tempfile
import unittest
import wave
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_build_collection_cards as fixtures
import build_collection_cards as builder


class DropReaders(unittest.TestCase):
    def test_fx_reader_records_preview_frames(self):
        gif = base64.b64decode('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pack = fixtures.add_pack(root, 'ansimuz-explosion-tutorial', 'ansimuz',
                                     'ansimuz-free-commercial', {'preview.gif': gif})
            self.assertEqual(builder.run(root, only=pack.name)['failures'], {})
            path, = (pack / 'cards').rglob('*.card.json')
            card = json.loads(path.read_text())
            self.assertEqual(card['sprite']['animations'][0]['frames'], [0])
            self.assertTrue(fixtures.validator_ok(path))

    def test_audio_pairs_formats_and_measures_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = io.BytesIO()
            with wave.open(output, 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(8000)
                wav.writeframes(b'\x00\x40' * 4000)
            pack = fixtures.add_pack(root, 'caseportman-cute-cozy-ui-sfx', 'caseportman',
                                     'caseportman-royalty-free',
                                     {'WAV/Click/Click_01.wav': output.getvalue(), 'OGG/Click/Click_01.ogg': b'ogg'})
            self.assertEqual(builder.run(root, only=pack.name)['failures'], {})
            path, = (pack / 'cards').rglob('*.card.json')
            card = json.loads(path.read_text())
            self.assertEqual(card['audio']['duration_s'], 0.5)
            self.assertEqual(card['audio']['sample_rate'], 8000)
            self.assertEqual(card['subkind'], 'sfx/ui')
            self.assertEqual(len(card['source']['files']), 2)
            self.assertTrue(fixtures.validator_ok(path))

    def test_missing_ogg_fails_without_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pack = fixtures.add_pack(root, 'caseportman-cute-cozy-ui-sfx', 'caseportman',
                                     'caseportman-royalty-free', {'WAV/a.wav': b'bad'})
            self.assertIn(pack.name, builder.run(root, only=pack.name)['failures'])
            self.assertFalse((pack / 'collection.card.json').exists())


if __name__ == '__main__':
    unittest.main()
