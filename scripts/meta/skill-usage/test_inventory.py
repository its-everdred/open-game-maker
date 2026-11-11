import datetime
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('inventory.py'))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class InventoryTest(unittest.TestCase):
    def test_discovery_preserves_metadata_and_marks_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill = root / 'demo' / 'SKILL.md'
            skill.parent.mkdir()
            skill.write_text('---\nname: demo\ndescription: A useful skill\n---\n')
            rows = inventory.discover([('test', root)], [], '2026-11-10')
            self.assertEqual(rows[0]['purpose'], 'A useful skill')
            rows[0]['license'] = 'MIT'
            skill.unlink()
            removed = inventory.discover([('test', root)], rows, '2026-11-11')
            self.assertEqual(removed[0]['status'], 'removed')
            self.assertEqual(removed[0]['removed_date'], '2026-11-11')
            self.assertEqual(removed[0]['license'], 'MIT')
            self.assertEqual(removed[0]['first_seen'], '2026-11-10')
            self.assertIn('demo', inventory.markdown(removed))

    def test_new_discovery_gets_date_without_backdating_existing_skills(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('first', 'second'):
                folder = root / name
                folder.mkdir()
                (folder / 'SKILL.md').write_text(f'---\nname: {name}\n---\n')
            existing = inventory.discover([('test', root)], [], '2026-11-08')[:1]
            rows = inventory.discover([('test', root)], existing, '2026-11-10')
            self.assertIsNone(rows[0]['date_added'])
            self.assertEqual(rows[1]['date_added'], '2026-11-10')
            self.assertEqual(rows[1]['date_added_basis'], 'first detected')

    def test_removed_plugin_registry_entry_is_retained_as_removed(self):
        prior = [{'name': 'demo', 'source': 'claude-installed/demo/1/skills/demo', 'status': 'installed'}]
        rows = inventory.discover([], prior, '2026-11-10', ['claude-installed'])
        self.assertEqual(rows[0]['status'], 'removed')
        self.assertEqual(rows[0]['removed_date'], '2026-11-10')

    def test_unavailable_root_does_not_mark_skills_removed(self):
        prior = [{'name': 'demo', 'source': 'test/demo', 'status': 'installed'}]
        self.assertEqual(inventory.discover([('test', Path('/nonexistent/skill-root'))], prior, '2026-11-10'), prior)


if __name__ == '__main__':
    unittest.main()
