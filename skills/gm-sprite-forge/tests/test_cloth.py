"""Integration test of pinned cloth in Blender."""
from pathlib import Path
import subprocess
import unittest


class ClothTest(unittest.TestCase):
    def test_pinned_cloth_sags_onto_collision_mesh(self):
        script = Path(__file__).parent / 'fixtures' / 'cloth_scene.py'
        subprocess.run(['blender', '-b', '--factory-startup', '--threads', '2',
                        '--python-exit-code', '1', '--python', str(script)],
                       check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    unittest.main()
