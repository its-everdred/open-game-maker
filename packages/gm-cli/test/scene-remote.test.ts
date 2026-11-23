import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import type { SceneDoc, SceneHead, SceneRevision } from '@ogm/contracts';
import { commitScene } from '@ogm/design-log';
import { afterEach, describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

/** A stand-in for the API's internal scene routes: one shared store, the same commit rules. */
function fakeApi() {
  const store: { head?: SceneHead; log: SceneRevision[] } = { log: [] };
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/internal/jobs/by-ticket/1300/scenes/graveyard' && req.method === 'GET') {
        return store.head
          ? send(200, { head: store.head, log: store.log })
          : send(404, { error: { code: 'not_found' } });
      }
      if (req.url === '/internal/jobs/by-ticket/1300/scenes/graveyard/seed') {
        const seed = JSON.parse(body) as { head: SceneHead; log: SceneRevision[] };
        if (!store.head) Object.assign(store, seed);
        return send(200, { head: store.head, log: store.log });
      }
      if (req.url === '/internal/jobs/by-ticket/1300/scenes/graveyard' && req.method === 'POST') {
        const push = JSON.parse(body) as { baseRev: number; doc: SceneDoc; label: string };
        // Like the API, a scene nobody saved yet starts empty at revision 0.
        const head = store.head ?? { rev: 0, doc: { ...push.doc, layers: {}, objects: {}, hd2d: {} } };
        const result = commitScene({
          head,
          log: store.log,
          ...push,
          author: 'agent:1300',
          source: 'cli',
          now: new Date(),
        });
        if (result.ok && result.revision) {
          store.head = result.head;
          store.log.push(result.revision);
        }
        return send(200, result);
      }
      send(404, {});
    });
  });
  return { store, requests, server };
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function setup() {
  const cwd = tempDir('gm-scene-remote-');
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, 'games/dusk-helm'), { recursive: true });
  writeFileSync(join(cwd, 'games/dusk-helm/gm.manifest.json'), '{}');
  writeFileSync(join(cwd, 'secret'), 'hook-secret\n');
  const api = fakeApi();
  servers.push(api.server);
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  const env = {
    AIUR_HOOK_TICKET_IDENTIFIER: '1300',
    OGM_INTERNAL_URL: `http://127.0.0.1:${port}`,
    OGM_HOOK_SECRET_FILE: join(cwd, 'secret'),
  };
  return { cwd, api, env };
}

const files = (cwd: string) => ({
  head: JSON.parse(readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.scene.json'), 'utf8')) as SceneHead,
  log: readFileSync(join(cwd, 'games/dusk-helm/scenes/graveyard.revs.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as SceneRevision),
});
const copyPath = (cwd: string) => join(cwd, '.gm/scenes/dusk-helm/graveyard.json');

describe('gm scene through the shared store', () => {
  it("pulls Kevin's map maker saves and pushes through the API, mirroring its history into the game folder", async () => {
    const { cwd, api, env } = await setup();
    // An agent starts the scene: nothing is shared yet, so pull starts an empty one and push creates it in the API.
    expect((await gm(['scene', 'pull', 'dusk-helm', 'graveyard', '--pack', 'smallscaleint'], { cwd, env })).code).toBe(
      0,
    );
    const copy = JSON.parse(readFileSync(copyPath(cwd), 'utf8')) as { baseRev: number; doc: SceneDoc };
    copy.doc.layers.floor = { kind: 'tiles', order: 0, tiles: { '0,0': { asset: 'ground', facing: 'E' } } };
    writeFileSync(copyPath(cwd), JSON.stringify(copy));
    expect((await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env })).code).toBe(0);
    expect(api.store.head?.rev).toBe(1);
    expect(api.requests.every((line) => line.endsWith('Bearer hook-secret'))).toBe(true);

    // Kevin saves from the map maker: his revision exists only in the API until the agent pulls.
    const kevin = structuredClone(api.store.head!.doc);
    kevin.layers.floor!.tiles!['1,0'] = { asset: 'path', facing: 'N' };
    const saved = commitScene({
      head: api.store.head!,
      log: api.store.log,
      doc: kevin,
      baseRev: 1,
      author: 'kevin',
      source: 'editor',
      label: 'path',
      now: new Date(),
    });
    if (!saved.ok || !saved.revision) throw new Error('kevin save failed');
    api.store.head = saved.head;
    api.store.log.push(saved.revision);

    expect((await gm(['scene', 'pull', 'dusk-helm', 'graveyard'], { cwd, env })).code).toBe(0);
    const pulled = JSON.parse(readFileSync(copyPath(cwd), 'utf8')) as { baseRev: number; doc: SceneDoc };
    expect(pulled.baseRev).toBe(2);
    expect(pulled.doc.layers.floor!.tiles!['1,0']).toEqual({ asset: 'path', facing: 'N', lockedBy: 'creator' });
    expect(files(cwd).log.map((revision) => revision.author)).toEqual(['agent:1300', 'kevin']);

    // The agent's change to Kevin's cell is refused by the API and nothing local moves.
    pulled.doc.layers.floor!.tiles!['1,0'] = { asset: 'ground', facing: 'E' };
    writeFileSync(copyPath(cwd), JSON.stringify(pulled));
    const refused = await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env });
    expect(refused.code).not.toBe(0);
    expect(refused.err.join('\n')).toContain('tile:floor:1,0: kevin owns this');
    expect(files(cwd).head.rev).toBe(2);

    // Around Kevin's cell, the push lands and the folder mirrors the API.
    pulled.doc.layers.floor!.tiles!['1,0'] = { asset: 'path', facing: 'N', lockedBy: 'creator' };
    pulled.doc.layers.floor!.tiles!['2,0'] = { asset: 'ground', facing: 'E' };
    writeFileSync(copyPath(cwd), JSON.stringify(pulled));
    expect((await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env })).code).toBe(0);
    expect(files(cwd)).toEqual({ head: api.store.head, log: api.store.log });
    expect(files(cwd).head.rev).toBe(3);
  });
});

describe('gm scene pull with a scene only in the checkout', () => {
  it("seeds the shared store from this checkout's history, so agent bases still resolve", async () => {
    const { cwd, api, env } = await setup();
    const offline = { ...env, OGM_INTERNAL_URL: '' };
    expect(
      (await gm(['scene', 'pull', 'dusk-helm', 'graveyard', '--pack', 'smallscaleint'], { cwd, env: offline })).code,
    ).toBe(0);
    const copy = JSON.parse(readFileSync(copyPath(cwd), 'utf8')) as { baseRev: number; doc: SceneDoc };
    copy.doc.layers.floor = { kind: 'tiles', order: 0, tiles: { '0,0': { asset: 'ground', facing: 'E' } } };
    writeFileSync(copyPath(cwd), JSON.stringify(copy));
    expect((await gm(['scene', 'push', 'dusk-helm', 'graveyard'], { cwd, env: offline })).code).toBe(0);
    expect(api.requests).toEqual([]);

    expect((await gm(['scene', 'pull', 'dusk-helm', 'graveyard'], { cwd, env })).code).toBe(0);
    expect(api.store).toEqual(files(cwd));
    expect(api.store.head?.rev).toBe(1);
  });
});
