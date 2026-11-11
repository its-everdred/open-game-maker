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

    def test_prior_urls_are_sanitized_even_when_removed(self):
        prior = [{'name': 'demo', 'source': 'test/demo', 'status': 'removed', 'url': 'https://github.com/example/demo?token=secret'}]
        result = inventory.discover([], prior, '2026-11-10')
        self.assertIsNone(result[0]['url'])

    def test_source_url_rejects_credentials_and_queries(self):
        self.assertIsNone(inventory.safe_github_url('https://github.com/example/demo.git?token=secret'))
        self.assertIsNone(inventory.safe_github_url('https://name:secret@github.com/example/demo'))
        self.assertIsNone(inventory.safe_github_url('https://github.com:bad/example/demo'))
        self.assertEqual(inventory.safe_github_url('https://github.com/example/demo.git'), 'https://github.com/example/demo')

    def test_plugin_registry_source_and_local_license(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cache = home / 'cache' / 'plugin'
            skill = cache / 'skills' / 'demo'
            skill.mkdir(parents=True)
            (skill / 'SKILL.md').write_text('---\nname: demo\n---\n')
            (cache / 'LICENSE').write_text('MIT License\n')
            registry = home / '.claude/plugins'
            registry.mkdir(parents=True)
            (registry / 'installed_plugins.json').write_text(__import__('json').dumps({'plugins': {'demo@market': [{'installPath': str(cache), 'version': '1', 'installedAt': '2026-11-08T00:00:00Z'}]}}))
            market = home / 'market'
            (market / '.claude-plugin').mkdir(parents=True)
            (market / '.claude-plugin/marketplace.json').write_text(__import__('json').dumps({'plugins': [{'name': 'demo', 'source': {'source': 'url', 'url': 'https://github.com/example/demo.git'}}]}))
            (registry / 'known_marketplaces.json').write_text(__import__('json').dumps({'market': {'installLocation': str(market), 'source': {'source': 'github', 'repo': 'example/market'}}}))
            roots, dates, prefixes, sources = inventory.installed_plugin_roots(home)
            self.assertEqual(len(roots), 1)
            source, _ = roots[0]
            self.assertEqual(sources[source][1], 'https://github.com/example/demo')
            self.assertEqual(inventory.identify_license(skill, cache), 'MIT')
            self.assertEqual(dates[source], '2026-11-08')
            self.assertEqual(prefixes, ['claude-installed'])
            (market / '.claude-plugin/marketplace.json').write_text(__import__('json').dumps({'plugins': [{'name': 'demo', 'source': '../outside'}]}))
            self.assertEqual(inventory.plugin_source_url('demo', {'installLocation': str(market), 'source': {'source': 'github', 'repo': 'example/market'}}), (True, None))
            self.assertEqual(inventory.plugin_source_url('demo', {}), (False, None))

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
