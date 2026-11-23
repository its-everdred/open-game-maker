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

    def test_records_the_enforced_cap_so_the_energy_menu_shows_the_same_one(self):
        json.dump({'stop_usd': 20.0, 'calls': []}, open(self.ledger, 'w'))
        replies = iter([{'request_id': 'r', 'status_url': 's', 'response_url': 'u'}, {'status': 'COMPLETED'}, {}])
        self.fal.call = lambda url, data=None: next(replies)
        self.fal.save = lambda res, out: []
        self.fal.run('fal-ai/trellis-2', os.path.join(self.tmp.name, 'out'), [], 0.25)
        self.assertEqual(json.load(open(self.ledger))['stop_usd'], 9.0)

    def test_counts_spend_already_booked_by_other_arms(self):
        json.dump({'calls': [{'usd': 3.04}, {'usd': 0.5}]}, open(self.ledger, 'w'))
        self.assertEqual(self.fal.total(self.fal.ledger()), 3.54)

    def test_defaults_to_the_one_ledger_the_api_reads_so_spend_never_splits_across_files(self):
        os.environ.pop('OGM_FAL_LEDGER')
        self.assertEqual(self.fal.ledger_path(), os.path.expanduser('~/.local/share/ogm/fal-ledger.json'))


class Fal3dUploadTests(unittest.TestCase):
    """A rigging call uploads our own mesh: sent as an image, fal's rigger cannot read it (the Meshy and Hyper3D arms
    of #1282 upload .glb, and .fbx clips), while reference images must still go up as PNG."""

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.fal = load()
        self.init, self.put = [], []
        self.fal.call = lambda url, data=None: self.init.append(data) or {'upload_url': 'https://upload.invalid/x', 'file_url': 'f'}

        class Resp:
            def read(self):
                return b''

        self.urlopen = self.fal.urllib.request.urlopen  # the real module: put it back for the other tests
        self.fal.urllib.request.urlopen = lambda req, timeout=None: self.put.append(req.get_header('Content-type')) or Resp()

    def tearDown(self):
        self.fal.urllib.request.urlopen = self.urlopen
        self.tmp.cleanup()

    def test_each_file_goes_up_as_its_own_type(self):
        for name, want in (('body.GLB', 'model/gltf-binary'), ('walk.fbx', 'application/octet-stream'),
                           ('ref.png', 'image/png')):
            path = os.path.join(self.tmp.name, name)
            Path(path).write_bytes(b'x')
            self.assertEqual(self.fal.upload(path), 'f')
            self.assertEqual(self.init[-1]['content_type'], want, name)
            self.assertEqual(self.put[-1], want, name)


if __name__ == '__main__':
    unittest.main()
