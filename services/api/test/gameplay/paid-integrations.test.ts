import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { scanBuild } from '../../src/gameplay/paid-integrations.js';
import { setPaidApisDuringGameplay } from '../../src/gameplay/policy.js';
import { builtFiles, completeRun, jobState, SECRET, SHA, TICKET, world } from '../builds/fixtures.js';
import { ids, insertBuild, publish, setup } from '../release-fixtures.js';
import { asUser, makeApp } from '../helpers.js';

const CALLS_OPENAI = 'fetch("https://api.openai.com/v1/chat/completions",{method:"POST"});\n';
// Built from parts so this file itself holds no key-shaped literal.
const KEY = ['sk', 'proj', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('-');
const ELEVENLABS_KEY = `sk_${'0123456789abcdef'.repeat(3)}`;

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ogm-scan-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('scanBuild', () => {
  it('finds paid provider hosts, subdomains included, in any text file', async () => {
    const root = dir({
      'assets/main.js': CALLS_OPENAI,
      'assets/fx.js': 'new URL("wss://queue.fal.run/x")',
      'index.html': '<script src="assets/main.js"></script>',
    });
    expect((await scanBuild(root)).paid.sort()).toEqual(['assets/fx.js', 'assets/main.js']);
  });

  it('matches a host in any case, as fetch does', async () => {
    expect((await scanBuild(dir({ 'a.js': 'fetch("https://API.OpenAI.com/v1")' }))).paid).toEqual(['a.js']);
  });

  it('ignores lookalike hosts and binary files', async () => {
    const root = dir({ 'a.js': 'fetch("https://notapi.openai.com.example/")', 'b.png': CALLS_OPENAI });
    expect(await scanBuild(root)).toEqual({ paid: [], credentials: [] });
  });

  it('finds provider credentials', async () => {
    expect((await scanBuild(dir({ 'assets/main.js': `const k="${KEY}";` }))).credentials).toEqual(['assets/main.js']);
    expect((await scanBuild(dir({ 'a.js': `"${ELEVENLABS_KEY}"` }))).credentials).toEqual(['a.js']);
  });

  it('does not mistake a hyphenated name for a key', async () => {
    const root = dir({ 'a.css': '.sk-panel-header-with-a-long-name-here { color: red }' });
    expect((await scanBuild(root)).credentials).toEqual([]);
  });
});

const archiveOf = (root: string) => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', root, '.']);

async function ingest(edit: (root: string) => void, allowed = false) {
  const { deps, app } = world();
  setPaidApisDuringGameplay(deps.db, allowed);
  completeRun(deps);
  const root = builtFiles();
  edit(root);
  const response = await app.request(`http://127.0.0.1:4000/internal/jobs/by-ticket/${TICKET}/build`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'x-gm-sha': SHA, 'content-type': 'application/gzip' },
    body: archiveOf(root),
  });
  return { deps, response };
}

describe('build validation', () => {
  it('refuses a build that calls a paid provider while paid APIs are off', async () => {
    const { deps, response } = await ingest((root) => writeFileSync(join(root, 'assets', 'main.js'), CALLS_OPENAI));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ state: 'failed', reason: 'paid_integration' });
    expect(jobState(deps)).toBe('failed');
  });

  it('accepts it once an instance admin turns paid APIs on', async () => {
    const { response } = await ingest((root) => writeFileSync(join(root, 'assets', 'main.js'), CALLS_OPENAI), true);
    expect(response.status).toBe(201);
  });

  it('never ships a provider credential to a game client, even with paid APIs on', async () => {
    const { response } = await ingest((root) => writeFileSync(join(root, 'assets', 'k.js'), `"${KEY}"`), true);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ state: 'failed', reason: 'provider_credential' });
  });
});

describe('release validation', () => {
  // A build ingested while paid APIs were on must not reach players after they are turned off.
  it('refuses to publish a build that calls a paid provider once paid APIs are off', async () => {
    const { deps, source, commit } = setup();
    insertBuild(deps, source);
    const artifact = dir({ 'index.html': '<title>g</title>', 'assets/main.js': CALLS_OPENAI });
    deps.db.update(schema.builds).set({ artifactPath: artifact }).run();
    const { app } = await makeApp(deps);

    const refused = await publish(app);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: 'paid_integration' });
    expect(commit).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);

    setPaidApisDuringGameplay(deps.db, true);
    expect((await publish(app)).status).toBe(201);
  });

  it('refuses to roll back to a build that calls a paid provider once paid APIs are off', async () => {
    const { deps, source } = setup();
    setPaidApisDuringGameplay(deps.db, true);
    insertBuild(deps, source);
    deps.db
      .update(schema.builds)
      .set({ artifactPath: dir({ 'assets/main.js': CALLS_OPENAI }) })
      .run();
    const { app } = await makeApp(deps);
    const first = (await (await publish(app)).json()) as { id: string };
    setPaidApisDuringGameplay(deps.db, false);

    const response = await app.request(`/api/v1/games/${ids.game}/rollback`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: first.id }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'paid_integration' });
    expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
  });

  it('never publishes a build holding a provider credential, even with paid APIs on', async () => {
    const { deps, source, commit } = setup();
    setPaidApisDuringGameplay(deps.db, true);
    insertBuild(deps, source);
    deps.db
      .update(schema.builds)
      .set({ artifactPath: dir({ 'assets/k.js': `"${KEY}"` }) })
      .run();
    const { app } = await makeApp(deps);

    const response = await publish(app);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'provider_credential' });
    expect(commit).not.toHaveBeenCalled();
  });
});
