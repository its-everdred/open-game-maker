"""Do not follow review output symlinks into source packs."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from vegetation_destination import variant_destination


class VegetationDestinationTest(unittest.TestCase):
    def test_rejects_pack_symlink_and_existing_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / 'out'
            output.mkdir()
            pack = root / 'packs' / 'source'
            pack.mkdir(parents=True)
            (output / 'tree').symlink_to(pack, target_is_directory=True)
            with self.assertRaises(ValueError):
                variant_destination(output, 'tree', 1)
            (output / 'other' / 'v1').mkdir(parents=True)
            with self.assertRaises(FileExistsError):
                variant_destination(output, 'other', 1)
