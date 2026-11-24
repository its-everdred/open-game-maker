"""Checks for efkgen.py and effects.py: agents author Effekseer effects by script, never in the editor GUI.

The headless export (scripts/effekseer.sh) needs the editor binary, which CI lacks, so these check the project XML it
reads: every emitter field the generator sets must exist in the template, or the edit silently lands nowhere.
"""
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / 'scripts'))
import effects  # noqa: E402
from efkgen import ADD, TEMPLATE, Generator  # noqa: E402


def emitters(path):
    root = ET.parse(path).getroot()
    return root, root.findall('Root/Children/Node')


class StarterEffects(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.written = effects.write_all(self.out)

    def tearDown(self):
        self.tmp.cleanup()

    def test_writes_the_four_starter_effects(self):
        self.assertEqual([p.name for p in self.written],
                         ['campfire.efkproj', 'cast.efkproj', 'legendary.efkproj', 'torch.efkproj'])

    def test_textures_land_beside_the_projects(self):
        # The export and the runtime load textures relative to the effect: a missing one draws nothing, with no error.
        for path in self.written:
            _, nodes = emitters(path)
            for node in nodes:
                texture = node.find('RendererCommonValues/ColorTexture').text
                self.assertTrue((self.out / texture).is_file(), f'{path.name}: {texture}')
                self.assertTrue((SKILL / 'effects' / texture).is_file(), f'starter {texture} not shipped')

    def test_cast_is_one_shot_and_campfire_burns_forever(self):
        # A cast that never ended would keep its slot under the scene's effect cap for good.
        _, cast = emitters(self.out / 'cast.efkproj')
        self.assertTrue(all(n.find('CommonValues/MaxGeneration/Infinite').text == 'False' for n in cast))
        _, fire = emitters(self.out / 'campfire.efkproj')
        self.assertTrue(all(n.find('CommonValues/MaxGeneration/Infinite').text == 'True' for n in fire))

    def test_torch_is_a_smaller_campfire(self):
        _, fire = emitters(self.out / 'campfire.efkproj')
        _, torch = emitters(self.out / 'torch.efkproj')
        size = lambda nodes: float(nodes[0].find('ScalingValues/Easing/Start/X/Max').text)
        self.assertLess(size(torch), size(fire))


class Generator_(unittest.TestCase):
    def test_sets_emitter_fields(self):
        g = Generator()
        node = g.node('spark', 'Texture/Star.png', life=(10, 20), every=3, blend=ADD, sphere=(0, 0.5))
        self.assertEqual(node.find('CommonValues/Life/Min').text, '10')
        self.assertEqual(node.find('CommonValues/Life/Center').text, '15.0')
        self.assertEqual(node.find('GenerationLocationValues/Type').text, '1')

    def test_a_template_missing_a_field_fails_loudly(self):
        root = ET.parse(TEMPLATE).getroot()
        sprite = root.find('Root/Children/Node')
        sprite.remove(sprite.find('ScalingValues'))
        with tempfile.NamedTemporaryFile(suffix='.efkproj') as f:
            ET.ElementTree(root).write(f.name)
            with self.assertRaises(KeyError):
                Generator(f.name).node('x', 'Texture/Star.png', life=(1, 1), every=1)


if __name__ == '__main__':
    unittest.main()
