"""Synthetic tests for WAV/OGG paired UI sound cards."""
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caseportman_audio as audio


class Cards(unittest.TestCase):
    def test_groups_formats_and_measures_wav(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'extracted'
            wav = root / 'WAV' / 'Click' / 'Click_01.wav'
            wav.parent.mkdir(parents=True)
            with wave.open(str(wav), 'wb') as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(8000)
                out.writeframes(struct.pack('<hhhh', 0, 16384, -16384, 0))
            ogg = root / 'OGG' / 'Click' / 'Click_01.ogg'
            ogg.parent.mkdir(parents=True)
            ogg.write_bytes(b'companion')
            cards = audio.build_cards(root, {'id': 't1:caseportman-test@1', 'schema': 'ogm.asset-card/1.0', 'vocab': '2026-10-27'})
            self.assertEqual(len(cards), 1)
            card = cards[0]
            self.assertEqual([f['format'] for f in card['source']['files']], ['wav', 'ogg'])
            self.assertEqual(card['subkind'], 'sfx/ui')
            self.assertEqual(card['status'], 'tagged')
            self.assertIn('feedback', card['describe']['roles'])
            self.assertAlmostEqual(card['audio']['duration_s'], 4 / 8000)
            self.assertAlmostEqual(card['audio']['peak_dbfs'], -6.0206, places=3)
            page = audio.write_contact(root.parent, root, cards)
            text = page.read_text()
            self.assertIn('Click 01', text)
            self.assertIn('0.001 s', text)
            self.assertIn('<audio', text)


if __name__ == '__main__':
    unittest.main()
