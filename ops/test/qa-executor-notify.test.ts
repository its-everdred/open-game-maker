import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../bin/ogm-qa-executor-notify', import.meta.url));
function run(dir: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(script, [], { env: { ...process.env, OGM_ENV_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('posts a unique notice with Aiur write headers and observes its row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-notify-test-'));
  const db = new DatabaseSync(join(dir, 'ogm.sqlite3'));
  db.exec('CREATE TABLE notifications (kind TEXT, body TEXT)');
  let observed: { path?: string; auth?: string; origin?: string; request?: string; kind?: string; text?: string } = {};
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as { kind: string; text: string };
    observed = {
      path: req.url,
      auth: req.headers.authorization,
      origin: req.headers.origin,
      request: req.headers['x-aiur-request'] as string,
      ...body,
    };
    db.prepare('INSERT INTO notifications VALUES (?, ?)').run('executor.notify', body.text);
    res.writeHead(202).end();
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    writeFileSync(join(dir, 'api.env'), `AIUR_API_URL=${base}\nAIUR_API_TOKEN=test-token\nOGM_DATA_DIR=${dir}\n`);
    const result = await run(dir);
    assert.equal(result.code, 0, result.output);
    assert.equal(observed.path, '/api/v1/operator/notify');
    assert.equal(observed.auth, 'Bearer test-token');
    assert.equal(observed.origin, base);
    assert.equal(observed.request, '1');
    assert.equal(observed.kind, 'info');
    assert.match(observed.text ?? '', /^OGM notification QA /);
  } finally {
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a non-loopback daemon without exposing its token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-notify-test-'));
  try {
    writeFileSync(
      join(dir, 'api.env'),
      `AIUR_API_URL=https://example.test\nAIUR_API_TOKEN=test-token\nOGM_DATA_DIR=${dir}\n`,
    );
    const result = await run(dir);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.output, /test-token/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
