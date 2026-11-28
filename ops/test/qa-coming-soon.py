#!/usr/bin/env python3
import http.server
import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'bin' / 'ogm-qa-coming-soon'


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/v1/games':
            code = 200 if self.headers.get('Cookie') == 'qa=secret' else 401
        elif self.path.startswith('/api/v1/games/resolve/') or self.path.endswith('/builds') or self.path.endswith('/design'):
            code = 403
        elif self.path.startswith('/g/'):
            code = 403 if self.server.restrict else 200
        else:
            code = 404
        self.send_response(code)
        self.end_headers()
        if self.path == '/api/v1/games' and code == 200:
            self.wfile.write(json.dumps({'games': [{'id': 'g', 'canPlay': False, 'releaseState': 'coming_soon'}]}).encode())

    def log_message(self, *_):
        pass


class ComingSoonCheck(unittest.TestCase):
    def test_requires_valid_qa_session_and_denied_unsigned_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'ogm.sqlite3'
            with sqlite3.connect(db) as conn:
                conn.executescript("""create table games (id text, slug text, release_state text);
                    create table builds (id text, game_id text, status text, created_at text);
                    insert into games values ('g', 'dusk-helm', 'coming_soon');
                    insert into builds values ('b', 'g', 'tested', 'now');""")
            (Path(tmp) / 'qa.env').write_text('OGM_QA_SESSION_COOKIE_NAME=qa\nOGM_QA_SESSION_COOKIE=secret\n')
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.restrict = True
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                origin = f'http://127.0.0.1:{server.server_port}'
                env = {**os.environ, 'OGM_ENV_DIR': tmp}
                command = [str(SCRIPT), '--db', str(db), '--app', origin, '--games', origin]
                result = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('secret', result.stdout + result.stderr)
                server.restrict = False
                result = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 1)
                self.assertIn('unsigned build denied: failed', result.stdout)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
