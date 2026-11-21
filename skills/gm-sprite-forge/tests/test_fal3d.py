"""The fal ledger is the only thing between a bake-off loop and the creator's money: these tests pin the cap."""
import importlib.util
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'fal3d.py'


def load():
    spec = importlib.util.spec_from_file_location('fal3d', SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Fal3dLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.ledger = os.path.join(self.tmp.name, 'ledger.json')
        os.environ['OGM_FAL_LEDGER'] = self.ledger
        self.fal = load()
        self.sent = []
        self.fal.call = lambda url, data=None: self.sent.append(url) or self.fail('network reached')

    def tearDown(self):
        os.environ.pop('OGM_FAL_LEDGER', None)
        self.tmp.cleanup()

    def test_refuses_a_call_that_would_pass_the_cap_before_sending_anything(self):
        json.dump({'calls': [{'endpoint': 'x', 'usd': 8.7}]}, open(self.ledger, 'w'))
        with self.assertRaises(SystemExit) as stop:
            self.fal.run('fal-ai/trellis-2', os.path.join(self.tmp.name, 'out'), ['image_url=@missing.png'], 0.35)
        self.assertIn('would pass 9.0', str(stop.exception))
        self.assertEqual(self.sent, [])

    def test_counts_spend_already_booked_by_other_arms(self):
        json.dump({'calls': [{'usd': 3.04}, {'usd': 0.5}]}, open(self.ledger, 'w'))
        self.assertEqual(self.fal.total(self.fal.ledger()), 3.54)

    def test_has_no_default_ledger_so_spend_never_splits_across_files(self):
        os.environ.pop('OGM_FAL_LEDGER')
        with self.assertRaises(SystemExit):
            self.fal.ledger()


if __name__ == '__main__':
    unittest.main()
