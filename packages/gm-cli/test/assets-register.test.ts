import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { AssetsLock } from '@ogm/contracts';

import { preparedLibrary, useOrc } from './assets-fixture.js';
import { gm, tempDir } from './helpers.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function gameRepo(): Promise<{ cwd: string; root: string }> {
  const cwd = tempDir();
  const root = preparedLibrary();
  await useOrc(cwd, root);
  return { cwd, root };
}

function writeAsset(cwd: string, path: string, content: string): void {
  mkdirSync(join(cwd, path, '..'), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

function storedBlobs(blobRoot: string): string[] {
  return readdirSync(join(blobRoot, 'blobs/sha256')).filter((name) => !name.endsWith('.json'));
}

function lockEntry(cwd: string, id: string) {
  const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
  return lock.assets.find((entry) => entry.id === id);
}

describe('gm assets register keeps tier-3 bytes in the blob store (D-ASSETS-REFERENCE)', () => {
  it('records a lazy phase and rejects malformed phases before moving bytes', async () => {
    const { cwd, root } = await gameRepo();
    const env = { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: tempDir('gm-blobs-') };
    writeAsset(cwd, 'assets/image/a.png', 'image');
    const invalid = await gm(
      ['assets', 'register', 'assets/image/a.png', '--made-by-agent', '--game', 'g1', '--phase', 'lazy:'],
      { cwd, env },
    );
    expect(invalid.code).not.toBe(0);
    expect(existsSync(join(cwd, 'assets/image/a.png'))).toBe(true);
    const valid = await gm(
      ['assets', 'register', 'assets/image/a.png', '--made-by-agent', '--game', 'g1', '--phase', 'lazy:backdrop-nim'],
      { cwd, env },
    );
    expect(valid.code).toBe(0);
    expect(lockEntry(cwd, 't3:g1/image/a')?.phase).toBe('lazy:backdrop-nim');
    writeAsset(cwd, 'assets/image/a.png', 'new image');
    expect(
      (await gm(['assets', 'register', 'assets/image/a.png', '--made-by-agent', '--game', 'g1'], { cwd, env })).code,
    ).toBe(0);
    expect(lockEntry(cwd, 't3:g1/image/a')?.phase).toBe('lazy:backdrop-nim');
    writeAsset(cwd, 'assets/image/a.png', 'third image');
    expect(
      (
        await gm(['assets', 'register', 'assets/image/a.png', '--made-by-agent', '--game', 'g1', '--phase', 'boot'], {
          cwd,
          env,
        })
      ).code,
    ).toBe(0);
    expect(lockEntry(cwd, 't3:g1/image/a')?.phase).toBe('boot');
  });
  it('moves the file into the blob store and leaves only a blob-sourced lock entry in the repo', async () => {
    const { cwd, root } = await gameRepo();
    const blobRoot = tempDir('gm-blobs-');
    writeAsset(cwd, 'assets/model/boss-door.glb', 'door-bytes');

    const result = await gm(['assets', 'register', 'assets/model/boss-door.glb', '--made-by-agent', '--game', 'g1'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: blobRoot },
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(cwd, 'assets/model/boss-door.glb'))).toBe(false);
    expect(readFileSync(join(blobRoot, 'blobs/sha256', sha('door-bytes')), 'utf8')).toBe('door-bytes');
    expect(lockEntry(cwd, 't3:g1/model/boss-door')).toMatchObject({
      sha256: sha('door-bytes'),
      source: 'blob',
      path: 'assets/model/boss-door.glb',
      credit: {
        pack: 'g1:made',
        title: 'Made for this game',
        licenseSource: 'created for this game',
        attribution: 'none required',
        source: { label: 'agent-generated' },
      },
    });
  });

  // Ticket done-when: no binary is left in the repo and the asset still checks and builds, from the blob store.
  it('leaves a registered image checkable and buildable from the blob store alone', async () => {
    const { cwd, root } = await gameRepo();
    const env = { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: tempDir('gm-blobs-') };
    /* Only the registered asset in the lock: the fixture orc is not a real glTF the build could encode. */
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    writeFileSync(join(cwd, 'assets.lock.json'), JSON.stringify({ ...lock, assets: [] }));
    const door = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#a33' } })
      .png()
      .toBuffer();
    mkdirSync(join(cwd, 'assets/image'), { recursive: true });
    writeFileSync(join(cwd, 'assets/image/door.png'), door);
    const registered = await gm(['assets', 'register', 'assets/image/door.png', '--made-by-agent', '--game', 'g1'], {
      cwd,
      env,
    });
    expect(registered.code).toBe(0);
    expect(existsSync(join(cwd, 'assets/image/door.png'))).toBe(false);

    const checked = await gm(['check', 'assets', '--json'], { cwd, env });
    expect(checked.out.join('\n')).not.toContain('t3:g1/image/door');
    const built = await gm(['build', 'assets', '--no-cache'], { cwd, env });
    expect(built.err).toEqual([]);
    expect(built.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')) as {
      assets: Record<string, unknown>;
    };
    expect(manifest.assets).toHaveProperty(['t3:g1/image/door']);
  });

  it('stores identical bytes once when they are registered twice', async () => {
    const { cwd, root } = await gameRepo();
    const blobRoot = tempDir('gm-blobs-');
    const env = { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: blobRoot };
    for (const path of ['assets/model/a.glb', 'assets/model/b.glb']) {
      writeAsset(cwd, path, 'same-bytes');
      expect((await gm(['assets', 'register', path, '--made-by-agent', '--game', 'g1'], { cwd, env })).code).toBe(0);
    }

    expect(storedBlobs(blobRoot)).toEqual([sha('same-bytes')]);
    expect(lockEntry(cwd, 't3:g1/model/a')?.sha256).toBe(lockEntry(cwd, 't3:g1/model/b')?.sha256);
  });

  it('refuses without a blob store and keeps the file and the lock untouched', async () => {
    const { cwd, root } = await gameRepo();
    writeAsset(cwd, 'assets/model/spark.glb', 'spark');
    const lockBefore = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');

    const result = await gm(['assets', 'register', 'assets/model/spark.glb', '--made-by-agent', '--game', 'g1'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('no blob store');
    expect(readFileSync(join(cwd, 'assets/model/spark.glb'), 'utf8')).toBe('spark');
    expect(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')).toBe(lockBefore);
  });

  it('refuses a second file whose id would replace another registered asset', async () => {
    const { cwd, root } = await gameRepo();
    const env = { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: tempDir('gm-blobs-') };
    writeAsset(cwd, 'assets/model/door.glb', 'model');
    writeAsset(cwd, 'assets/model/door.png', 'texture');
    expect(
      (await gm(['assets', 'register', 'assets/model/door.glb', '--made-by-agent', '--game', 'g1'], { cwd, env })).code,
    ).toBe(0);

    const second = await gm(['assets', 'register', 'assets/model/door.png', '--made-by-agent', '--game', 'g1'], {
      cwd,
      env,
    });

    expect(second.code).toBe(2);
    expect(second.err.join('\n')).toContain('t3:g1/model/door already names assets/model/door.glb');
    expect(lockEntry(cwd, 't3:g1/model/door')?.sha256).toBe(sha('model'));
    expect(readFileSync(join(cwd, 'assets/model/door.png'), 'utf8')).toBe('texture');
  });
});

type Seen = { method?: string; url?: string; auth?: string; body: string };

// A stand-in for the API's daemon blob route that answers every request with `reply(body)`.
async function withDaemonApi(
  reply: (body: string) => { status: number; json: unknown },
  run: (env: Record<string, string>) => Promise<void>,
): Promise<Seen[]> {
  const secretFile = join(tempDir('gm-secret-'), 'hook-secret');
  writeFileSync(secretFile, 'daemon-secret\n');
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const { status, json } = reply(body);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const { port } = server.address() as AddressInfo;
    await run({ OGM_INTERNAL_URL: `http://127.0.0.1:${port}`, OGM_HOOK_SECRET_FILE: secretFile });
  } finally {
    server.close();
  }
  return seen;
}

describe('gm assets register inside a sandboxed game daemon', () => {
  const register = (cwd: string, root: string, env: Record<string, string>) =>
    gm(['assets', 'register', 'assets/model/door.glb', '--made-by-agent', '--game', 'g1'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root, ...env },
    });

  it("puts the bytes through the API's daemon blob route with the hook secret", async () => {
    const { cwd, root } = await gameRepo();
    writeAsset(cwd, 'assets/model/door.glb', 'door-bytes');
    const seen = await withDaemonApi(
      (body) => ({ status: 201, json: { hash: `sha256:${sha(body)}`, bytes: body.length, mime: 'x' } }),
      async (env) => expect((await register(cwd, root, env)).code).toBe(0),
    );

    expect(seen).toEqual([
      {
        method: 'PUT',
        url: `/blobs/daemon/sha256/${sha('door-bytes')}`,
        auth: 'Bearer daemon-secret',
        body: 'door-bytes',
      },
    ]);
    expect(existsSync(join(cwd, 'assets/model/door.glb'))).toBe(false);
  });

  it.each([
    ['a refusal', { status: 413, json: { error: 'blob_too_large' } }],
    ['a success that does not name the stored bytes', { status: 200, json: {} }],
  ])('keeps the file and the lock when the route answers with %s', async (_label, answer) => {
    const { cwd, root } = await gameRepo();
    writeAsset(cwd, 'assets/model/door.glb', 'door-bytes');
    const lockBefore = readFileSync(join(cwd, 'assets.lock.json'), 'utf8');
    await withDaemonApi(
      () => answer,
      async (env) => expect((await register(cwd, root, env)).code).toBe(1),
    );

    expect(readFileSync(join(cwd, 'assets/model/door.glb'), 'utf8')).toBe('door-bytes');
    expect(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')).toBe(lockBefore);
  });
});
