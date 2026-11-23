import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SceneDoc, SceneHead } from '@ogm/contracts';
import { commitScene, SCENE_MIGRATIONS, type SceneMigrations } from '@ogm/design-log';
import { afterEach, describe, expect, it } from 'vitest';

import { editorLink } from '../src/commands/scene/push.js';
import { readStore, sceneRef, writeRevision } from '../src/scene/store.js';
import { gm, tempDir } from './helpers.js';

function repo(): string {
  const cwd = tempDir('gm-scene-');
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, 'games/dusk-helm'), { recursive: true });
  writeFileSync(join(cwd, 'games/dusk-helm/gm.manifest.json'), '{}');
  return cwd;
}

const agent = { AIUR_HOOK_TICKET_IDENTIFIER: '1207' };
const copyPath = (cwd: string) => join(cwd, '.gm/scenes/dusk-helm/graveyard.json');
type Copy = { baseRev: number; doc: SceneDoc };
const readCopy = (cwd: string) => JSON.parse(readFileSync(copyPath(cwd), 'utf8')) as Copy;

function editCopy(cwd: string, change: (doc: SceneDoc) => void): void {
  const copy = readCopy(cwd);
  change(copy.doc);
  writeFileSync(copyPath(cwd), JSON.stringify(copy));
}

/** Kevin saving from the editor: the same commit rules, author `kevin`, source `editor`. */
async function kevinMoves(cwd: string, id: string, pose: { x: number; y: number }): Promise<void> {
  const ref = sceneRef(cwd, 'dusk-helm', 'graveyard');
  const store = await readStore(ref);
  const doc = structuredClone(store.head.doc);
  doc.objects[id]!.pose = pose;
  const result = commitScene({
    ...store,
    doc,
    baseRev: store.head.rev,
    author: 'kevin',
    source: 'editor',
    label: 'move',
    now: new Date(),
  });
  if (!result.ok || !result.revision) throw new Error('kevin edit failed');
  await writeRevision(ref, result.head, result.revision);
}

async function startScene(cwd: string): Promise<void> {
  expect(
    (await gm(['scene', 'pull', 'dusk-helm', 'graveyard', '--pack', 'smallscaleint'], { cwd, env: agent })).code,
  ).toBe(0);
  editCopy(cwd, (doc) => {
    doc.layers.decor = { kind: 'objects', order: 2 };
    doc.objects['tree-1'] = { asset: 'oak', layer: 'decor', pose: { x: 2, y: 3 } };
  });
  expect(
    (await gm(['scene', 'push', 'dusk-helm', 'graveyard', '--label', 'first trees'], { cwd, env: agent })).code,
  ).toBe(0);
}

describe('scene editor link', () => {
  it('opens on the app origin when one is set, so the link works from a phone', () => {
    expect(editorLink('https://app.example/', 'dusk-helm', 'goblin-cave', 4)).toBe(
      'https://app.example/dusk-helm/edit?scene=goblin-cave&rev=4',
    );
  });
});

describe('gm scene pull / push', () => {
  // A write that stopped after logging a revision but before replacing the head never committed that revision; the
  // next push must not reuse its number, or the history would hold two different rev 2s.
  it('drops a logged revision whose head was never written before the next push', async () => {
    const cwd = repo();
    await startScene(cwd);
    const logPath = join(cwd, 'games/dusk-helm/scenes/graveyard.revs.jsonl');
    const [first] = readFileSync(logPath, 'utf8').trim().split('\n');
    writeFileSync(logPath, `${first}\n${JSON.stringify({ ...JSON.parse(first!), rev: 2, parentRev: 1 })}\n`);

    editCopy(cwd, (doc) => {
      doc.objects['tree-1']!.pose = { x: 4, y: 4 };
    });
    expect((await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent })).code).toBe(0);

    const revs = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { rev: number }).rev);
    expect(revs).toEqual([1, 2]);
  });

  // The log is appended before the head is replaced, so a crash can leave half a line after the last committed one.
  it('drops a half-written log line past the head instead of refusing every later push', async () => {
    const cwd = repo();
    await startScene(cwd);
    const logPath = join(cwd, 'games/dusk-helm/scenes/graveyard.revs.jsonl');
    writeFileSync(logPath, `${readFileSync(logPath, 'utf8')}{"rev":2,"paren`);

    editCopy(cwd, (doc) => {
      doc.objects['tree-1']!.pose = { x: 4, y: 4 };
    });
    expect((await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent })).code).toBe(0);

    const revs = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { rev: number }).rev);
    expect(revs).toEqual([1, 2]);
  });

  // A first push that logged rev 1 but never wrote the head committed nothing; its line must not block the scene.
  it('starts over from a first write that stopped before the head', async () => {
    const cwd = repo();
    await startScene(cwd);
    const scenes = join(cwd, 'games/dusk-helm/scenes');
    const [firstLine] = readFileSync(join(scenes, 'graveyard.revs.jsonl'), 'utf8').trim().split('\n');
    execFileSync('rm', [join(scenes, 'graveyard.scene.json')]);
    writeFileSync(
      join(scenes, 'graveyard.revs.jsonl'),
      `${JSON.stringify({ ...JSON.parse(firstLine!), label: 'lost' })}\n`,
    );

    await startScene(cwd);
    editCopy(cwd, (doc) => {
      doc.objects['tree-1']!.pose = { x: 4, y: 4 };
    });
    expect((await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent })).code).toBe(0);
    const log = readFileSync(join(scenes, 'graveyard.revs.jsonl'), 'utf8').trim().split('\n');
    expect(log.map((line) => (JSON.parse(line) as { label: string }).label)).toEqual(['first trees', '']);
  });

  it('starts a scene in the game folder and records the agent as author', async () => {
    const cwd = repo();
    await startScene(cwd);

    const head = JSON.parse(
      readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.scene.json'), 'utf8'),
    ) as SceneHead;
    const log = readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.revs.jsonl'), 'utf8').trim().split('\n');
    expect(head.rev).toBe(1);
    expect(head.doc.objects['tree-1']).toBeDefined();
    expect(JSON.parse(log[0]!)).toMatchObject({ rev: 1, author: 'agent:1207', source: 'cli', label: 'first trees' });
    expect(existsSync(join(cwd, 'games/dusk-helm/scenes/graveyard.lock'))).toBe(false);
  });

  it("keeps Kevin's move when the agent pushes from the copy it pulled before his edit", async () => {
    const cwd = repo();
    await startScene(cwd);
    editCopy(cwd, (doc) => {
      doc.objects['grave-1'] = { asset: 'grave', layer: 'decor', pose: { x: 5, y: 1 } };
    });
    await kevinMoves(cwd, 'tree-1', { x: 9, y: 9 });

    const result = await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent });

    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('rebased');
    // The agent pastes this into its update; it opens the editor on the revision just pushed (#1212).
    expect(result.out).toContain('open in the editor: /dusk-helm/edit?scene=graveyard&rev=3');
    // The working copy is now the head, so the next agent turn starts from Kevin's edit.
    expect(readCopy(cwd).doc.objects['tree-1']!.pose).toEqual({ x: 9, y: 9 });
    expect(readCopy(cwd).doc.objects['grave-1']).toBeDefined();
  });

  it('refuses a push that would move what Kevin moved and says why, saving nothing', async () => {
    const cwd = repo();
    await startScene(cwd);
    editCopy(cwd, (doc) => {
      doc.objects['tree-1']!.pose = { x: 4, y: 4 };
    });
    await kevinMoves(cwd, 'tree-1', { x: 9, y: 9 });
    const before = readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.scene.json'), 'utf8');

    const result = await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent });

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/object:tree-1: kevin owns this; your change was refused/);
    expect(readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.scene.json'), 'utf8')).toBe(before);
  });

  it('rejects HD-2D settings the runtime could not load', async () => {
    const cwd = repo();
    await startScene(cwd);
    editCopy(cwd, (doc) => {
      doc.hd2d.focus = { settings: { mode: 'blurry' } };
    });

    const result = await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent });

    expect(result.code).not.toBe(0);
    expect(result.err.join('\n')).toContain('hd2d.focus');
  });

  it('needs a ticket to know which agent is writing', async () => {
    const cwd = repo();
    const result = await gm(['scene', 'pull', 'dusk-helm', 'graveyard', '--pack', 'smallscaleint'], { cwd });
    expect(result.code).not.toBe(0);
    expect(result.err.join('\n')).toContain('ticket');
  });
});

describe('gm scene after a schema upgrade', () => {
  const migrations = SCENE_MIGRATIONS as Record<number, SceneMigrations[number]>;
  afterEach(() => {
    delete migrations[0];
  });

  // An upgrade is a revision of its own: a copy pulled before it cannot be rebased across it, so it must be pulled again.
  it('records the upgrade on pull, keeps the scene, and refuses a copy pulled before it', async () => {
    const cwd = repo();
    await startScene(cwd);
    const stale = readFileSync(copyPath(cwd), 'utf8');
    const headPath = join(cwd, 'games/dusk-helm/scenes/graveyard.scene.json');
    const head = JSON.parse(readFileSync(headPath, 'utf8')) as SceneHead;
    const { packAdapter, ...rest } = head.doc;
    writeFileSync(headPath, JSON.stringify({ rev: 1, doc: { ...rest, schemaVersion: 0, pack: packAdapter } }));
    migrations[0] = ({ pack, ...doc }) => ({ ...doc, packAdapter: pack });

    expect((await gm(['scene', 'pull', 'dusk-helm', 'graveyard'], { cwd, env: agent })).code).toBe(0);
    const upgraded = JSON.parse(readFileSync(headPath, 'utf8')) as SceneHead;
    expect(upgraded).toEqual({ rev: 2, doc: head.doc });
    const log = readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.revs.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(log[1]!)).toMatchObject({ rev: 2, source: 'migration', changes: [] });

    writeFileSync(copyPath(cwd), stale);
    editCopy(cwd, (doc) => {
      doc.objects['tree-1']!.pose = { x: 4, y: 4 };
    });
    const result = await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: agent });
    expect(result.code).not.toBe(0);
    expect(result.err.join('\n')).toContain('pull it again');
    expect(JSON.parse(readFileSync(headPath, 'utf8'))).toEqual(upgraded);
  });
});
