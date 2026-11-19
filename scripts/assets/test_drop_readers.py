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
import drop_contact_sheets


class DropReaders(unittest.TestCase):
    def test_fx_reader_records_preview_frames(self):
        gif = base64.b64decode('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pack = fixtures.add_pack(root, 'ansimuz-explosion-tutorial', 'ansimuz',
                                     'ansimuz-free-commercial', {'preview.gif': gif, 'spritesheet.png': fixtures.png(1, 1)})
            self.assertEqual(builder.run(root, only=pack.name)['failures'], {})
            path, = (pack / 'cards').rglob('*.card.json')
            card = json.loads(path.read_text())
            self.assertEqual(card['sprite']['animations'][0]['frames'], [0])
            self.assertEqual(card['sprite']['animations'][0]['sheets'][0]['path'], 'spritesheet.png')
            self.assertTrue(fixtures.validator_ok(path))
            sheet = drop_contact_sheets.write(pack).read_text()
            self.assertIn('../1.0/extracted/preview.gif', sheet)
            self.assertIn('Explosion tutorial: 1', sheet)

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
            self.assertAlmostEqual(card['audio']['peak_dbfs'], -6.0206, places=3)
            self.assertEqual(card['subkind'], 'sfx/ui')
            self.assertEqual(card['status'], 'tagged')
            self.assertEqual(len(card['source']['files']), 2)
            self.assertTrue(fixtures.validator_ok(path))
            sheet = drop_contact_sheets.write(pack).read_text()
            self.assertIn('Click 01 — 0.50s', sheet)

    def test_missing_ogg_fails_without_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = io.BytesIO()
            with wave.open(output, 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(8000)
                wav.writeframes(b'\0\0')
            pack = fixtures.add_pack(root, 'caseportman-cute-cozy-ui-sfx', 'caseportman',
                                     'caseportman-royalty-free', {'WAV/a.wav': output.getvalue()})
            self.assertEqual(builder.run(root, only=pack.name)['failures'][pack.name], ['missing OGG for a.wav'])
            self.assertFalse((pack / 'collection.card.json').exists())


if __name__ == '__main__':
    unittest.main()
