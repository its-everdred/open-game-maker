import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { blobPath, FsBlobStore } from '@ogm/blob-store';
import type { AssetsLock, LockEntry } from '@ogm/contracts';

import { ZipReader } from '../src/assets-export/zip-read.js';
import { ZipWriter } from '../src/assets-export/zip-write.js';
import { writeLock } from '../src/lock.js';
import { ORC, SHEET, SYNTY, preparedLibrary } from './assets-fixture.js';
import { gm, library, tempDir } from './helpers.js';

const LOOP = 't1:kenney-music-loops/loops/infinite-descent@1.1';
const LOOP_FILE = 'packs/kenney-music-loops/1.1/extracted/Loops/Infinite Descent.ogg';
const SHEET_FILE = 'packs/kenney-mini-dungeon/2.0/extracted/Spritesheets/character-sheet.png';
const ORC_ZIP = 'library/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb';
const LOOP_ZIP = 'library/kenney-music-loops/1.1/extracted/Loops/Infinite Descent.ogg';
const KENNEY_CARDS = [
  'library/kenney-mini-dungeon/cards/broken-no-source.card.json',
  'library/kenney-mini-dungeon/cards/broken-status.card.json',
  'library/kenney-mini-dungeon/cards/character-orc.card.json',
  'library/kenney-mini-dungeon/cards/character-sheet.card.json',
  'library/kenney-mini-dungeon/cards/wall.card.json',
  'library/kenney-mini-dungeon/collection.card.json',
];
const SYNTY_ZIP = 'library/synty-polygon-goblin-war-camp/v3/extracted/FBX/Buildings/SM_Bld_Prop_Torch_01.fbx';
const FREE = {
  uses: ['in-game' as const],
  audience: 'public' as const,
  redistribution: 'free' as const,
  attribution: null,
};

function sha(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function entry(id: string, content: string | Buffer, rights: Partial<LockEntry['rights']> = {}): LockEntry {
  const libraryPaths: Record<string, string> = {
    [ORC]: 'Models/GLB format/character-orc.glb',
    [SHEET]: 'Spritesheets/character-sheet.png',
    [SYNTY]: 'FBX/Buildings/SM_Bld_Prop_Torch_01.fbx',
    [LOOP]: 'Loops/Infinite Descent.ogg',
  };
  const blob = id.startsWith('t3:');
  const pack = blob
    ? `${id.slice(3).split('/')[0]}:made${rights.redistribution === 'in-build' ? ':restricted' : ''}`
    : id.replace(/^t1:/, '').split('/')[0]!;
  const attribution = rights.attribution ?? 'none required';
  return {
    id,
    sha256: sha(content),
    path: blob ? `image/${id.split('/').at(-1)}.png` : libraryPaths[id]!,
    source: blob ? 'blob' : 'library',
    license: rights.redistribution === 'in-build' ? 'LicenseRef-synty-personal' : 'CC0-1.0',
    rights: { ...FREE, ...rights },
    credit: {
      pack,
      title: pack,
      licenseSource: rights.redistribution === 'in-build' ? 'Vendor licence' : 'License.txt',
      attribution,
      source: { label: blob ? 'agent-generated' : 'Fixture vendor' },
    },
    added: '2026-11-02',
  };
}

async function game(dir: string, id: string, entries: LockEntry[]): Promise<string> {
  mkdirSync(join(dir, '.gm'), { recursive: true });
  writeFileSync(join(dir, '.gm/game.json'), JSON.stringify({ gameId: id }));
  const lock: AssetsLock = { version: 1, family: 'chunky-low-poly', pov: 'iso', assets: entries };
  await writeLock(dir, lock);
  return dir;
}

/** A library with three packs (two free, one in-build), a blob store with one agent-made asset, and two games. */
async function instance() {
  const assetsRoot = preparedLibrary();
  mkdirSync(join(assetsRoot, LOOP_FILE, '..'), { recursive: true });
  writeFileSync(join(assetsRoot, LOOP_FILE), 'loop-bytes');
  const blobRoot = tempDir('gm-blobs-');
  const store = new FsBlobStore({ root: blobRoot, signingKey: 'unused', publicOrigin: 'http://127.0.0.1' });
  const made = await store.put(Buffer.from('made-bytes'), 'image/png');
  const unpinned = await store.put(Buffer.from('preview-bytes'), 'image/webp');
  const gamesDir = tempDir('gm-games-');
  const gameA = await game(join(gamesDir, 'a'), 'game-a', [
    entry(ORC, 'orc-bytes'),
    entry(SYNTY, 'torch-bytes', { audience: 'private', redistribution: 'in-build' }),
    entry('t3:game-a/hero-edit', 'made-bytes'),
  ]);
  const gameB = await game(join(gamesDir, 'b'), 'game-b', [entry(LOOP, 'loop-bytes')]);
  const env = { OGM_ASSETS_ROOT: assetsRoot, OGM_BLOB_ROOT: blobRoot };
  return {
    assetsRoot,
    blobRoot,
    gamesDir,
    gameA,
    gameB,
    env,
    made: made.hash.slice(7),
    unpinned: unpinned.hash.slice(7),
  };
}

async function names(zip: string): Promise<string[]> {
  const reader = await ZipReader.open(zip);
  await reader.close();
  return reader.entries.map((item) => item.name);
}

function report(zip: string): {
  included: Array<{
    path: string;
    ids: string[];
    restricted?: boolean;
    rights?: { redistribution?: string };
  }>;
  excluded: Array<{ ids: string[] }>;
} {
  return JSON.parse(new AdmZip(zip).readAsText('rights-report.json')) as ReturnType<typeof report>;
}

describe('gm assets export --used', () => {
  it('zips the game lock entries from the library and blob store and leaves restricted packs out, naming them', async () => {
    const world = await instance();
    const out = join(tempDir(), 'a.zip');
    const result = await gm(['assets', 'export', '--used', '--out', out], { cwd: world.gameA, env: world.env });

    expect(result.code).toBe(0);
    expect(result.err).toEqual([
      `left out ${SYNTY} (redistribution is in-build); add --include-restricted to export it`,
    ]);
    expect(await names(out)).toEqual([
      `blobs/${world.made}`,
      ORC_ZIP,
      ...KENNEY_CARDS,
      'CREDITS.md',
      'locks/game-a/assets.lock.json',
      'rights-report.json',
    ]);
    const zip = new AdmZip(out);
    expect(zip.readAsText(ORC_ZIP)).toBe('orc-bytes');
    expect(zip.readAsText(`blobs/${world.made}`)).toBe('made-bytes');
    expect(zip.readAsText('locks/game-a/assets.lock.json')).toBe(
      readFileSync(join(world.gameA, 'assets.lock.json'), 'utf8'),
    );
    expect(zip.readAsText('CREDITS.md')).toContain('CC0 assets from: game-a:made, kenney-mini-dungeon');
    expect(report(out).excluded).toMatchObject([{ ids: [SYNTY], reason: 'redistribution is in-build' }]);
  });

  it('scopes --game to that game, so packs only another game uses stay out', async () => {
    const world = await instance();
    const out = join(tempDir(), 'b.zip');
    const result = await gm(
      ['assets', 'export', '--used', '--game', 'game-b', '--games-dir', world.gamesDir, '--out', out],
      {
        cwd: world.gamesDir,
        env: world.env,
      },
    );

    expect(result.code).toBe(0);
    const listed = await names(out);
    expect(listed).toContain(LOOP_ZIP);
    expect(listed.filter((name) => name.includes('/extracted/') || name.startsWith('blobs/'))).toEqual([LOOP_ZIP]);
    expect(listed).toContain('library/kenney-music-loops/collection.card.json');
    expect(listed.some((name) => name.startsWith('library/kenney-mini-dungeon/'))).toBe(false);

    const both = join(tempDir(), 'both.zip');
    await gm(['assets', 'export', '--used', '--all-games', '--out', both], { cwd: world.gamesDir, env: world.env });
    expect(await names(both)).toEqual(
      expect.arrayContaining([LOOP_ZIP, ORC_ZIP, 'locks/game-a/assets.lock.json', 'locks/game-b/assets.lock.json']),
    );
  });

  it('exports a library copy when the same bytes are vendored by an earlier game', async () => {
    const world = await instance();
    const vendoredEntry = { ...entry(ORC, 'orc-bytes'), path: 'assets/orc.glb', source: 'vendored' as const };
    const vendored = await game(join(world.gamesDir, 'zero'), 'game-0', [vendoredEntry]);
    mkdirSync(dirname(join(vendored, vendoredEntry.path)), { recursive: true });
    writeFileSync(join(vendored, vendoredEntry.path), 'orc-bytes');
    const out = join(tempDir(), 'mixed-sources.zip');

    const result = await gm(['assets', 'export', '--used', '--all-games', '--out', out], {
      cwd: world.gamesDir,
      env: world.env,
    });

    expect(result.code).toBe(0);
    expect(await names(out)).toContain(ORC_ZIP);
  });

  it('exports restricted entries only with --include-restricted, warning by name and marking them in the report', async () => {
    const world = await instance();
    const out = join(tempDir(), 'a.zip');
    const result = await gm(['assets', 'export', '--used', '--include-restricted', '--out', out], {
      cwd: world.gameA,
      env: world.env,
    });

    expect(result.code).toBe(0);
    expect(result.err).toEqual([`warning: exporting restricted ${SYNTY} (redistribution is in-build)`]);
    expect(report(out).included.find((item) => item.path === SYNTY_ZIP)).toMatchObject({ restricted: true });
    expect(report(out).included.find((item) => item.path === ORC_ZIP)?.restricted).toBeUndefined();
  });

  it('writes byte-identical zips for the same state', async () => {
    const world = await instance();
    const first = join(tempDir(), 'one.zip');
    const second = join(tempDir(), 'two.zip');
    await gm(['assets', 'export', '--used', '--out', first], { cwd: world.gameA, env: world.env });
    await gm(['assets', 'export', '--used', '--out', second], { cwd: world.gameA, env: world.env });
    expect(sha(readFileSync(first))).toBe(sha(readFileSync(second)));
  });

  it('refuses to export a library file whose bytes no longer match the lock, and writes no zip', async () => {
    const world = await instance();
    writeFileSync(
      join(world.assetsRoot, 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb'),
      'changed',
    );
    const out = join(tempDir(), 'a.zip');
    const result = await gm(['assets', 'export', '--used', '--out', out], { cwd: world.gameA, env: world.env });

    expect(result.code).toBe(1);
    expect(result.err[0]).toBe(`${ORC}: Models/GLB format/character-orc.glb sha256 does not match the lock`);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses to export a companion file whose bytes no longer match its per-file lock hash', async () => {
    const world = await instance();
    const lockPath = join(world.gameA, 'assets.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as AssetsLock;
    const orc = lock.assets.find((item) => item.id === ORC)!;
    orc.files = [{ path: 'Models/GLB format/Textures/colormap.png', sha256: sha('map-bytes') }];
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    writeFileSync(
      join(world.assetsRoot, 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/Textures/colormap.png'),
      'changed',
    );
    const out = join(tempDir(), 'a.zip');

    const result = await gm(['assets', 'export', '--used', '--out', out], { cwd: world.gameA, env: world.env });

    expect(result.code).toBe(1);
    expect(result.err[0]).toContain('Models/GLB format/Textures/colormap.png sha256 does not match the lock');
    expect(existsSync(out)).toBe(false);
  });

  it('fails naming each entry it cannot find instead of writing a partial zip', async () => {
    const world = await instance();
    const out = join(tempDir(), 'b.zip');
    const result = await gm(['assets', 'export', '--used', '--out', out], {
      cwd: world.gameB,
      env: { OGM_ASSETS_ROOT: library(), OGM_BLOB_ROOT: world.blobRoot },
    });

    expect(result.code).toBe(1);
    expect(result.err[0]).toBe(`${LOOP}: Loops/Infinite Descent.ogg is missing from the library source`);
    expect(existsSync(out)).toBe(false);
  });
});

describe('gm assets export --all', () => {
  it('zips every free pack with its cards and every pinned blob; restricted packs and unpinned blobs stay out', async () => {
    const world = await instance();
    const out = join(tempDir(), 'all.zip');
    const result = await gm(['assets', 'export', '--all', '--games-dir', world.gamesDir, '--out', out], {
      cwd: world.gamesDir,
      env: world.env,
    });

    expect(result.code).toBe(0);
    const listed = await names(out);
    expect(listed).toEqual(
      expect.arrayContaining([
        ORC_ZIP,
        LOOP_ZIP,
        'library/kenney-mini-dungeon/collection.card.json',
        'library/kenney-mini-dungeon/cards/character-orc.card.json',
        `blobs/${world.made}`,
      ]),
    );
    expect(listed.some((name) => name.startsWith('library/synty-polygon-goblin-war-camp/'))).toBe(false);
    expect(listed).not.toContain(`blobs/${world.unpinned}`);
    expect(result.err).toEqual(
      expect.arrayContaining([
        expect.stringContaining('left out t1:synty-polygon-goblin-war-camp@v3 (redistribution is in-build)'),
        `left out blobs/${world.unpinned} (no rights are recorded for it); add --include-restricted to export it`,
      ]),
    );
  });

  it('refuses --all combined with a game scope', async () => {
    const result = await gm(['assets', 'export', '--all', '--game', 'x'], { env: { OGM_ASSETS_ROOT: library() } });
    expect(result.code).toBe(2);
  });

  it('uses lock rights for companion blobs as well as primary blobs', async () => {
    const world = await instance();
    const lock = JSON.parse(readFileSync(join(world.gameA, 'assets.lock.json'), 'utf8')) as AssetsLock;
    lock.assets.find((item) => item.id.startsWith('t3:'))!.files = [
      { path: 'image/preview.webp', sha256: world.unpinned },
    ];
    await writeLock(world.gameA, lock);
    const out = join(tempDir(), 'all-with-companion.zip');

    const result = await gm(['assets', 'export', '--all', '--games-dir', world.gamesDir, '--out', out], {
      cwd: world.gamesDir,
      env: world.env,
    });

    expect(result.code).toBe(0);
    expect(await names(out)).toContain(`blobs/${world.unpinned}`);
  });

  it('names restricted inspiration collections under --all', async () => {
    const world = await instance();
    const map = join(
      world.assetsRoot,
      'inspiration/profantasy-cartographers-annual/illustrative/extracted/example-map.png',
    );
    mkdirSync(dirname(map), { recursive: true });
    writeFileSync(map, 'private-map');
    const out = join(tempDir(), 'all-with-inspiration.zip');

    const result = await gm(['assets', 'export', '--all', '--games-dir', world.gamesDir, '--out', out], {
      cwd: world.gamesDir,
      env: world.env,
    });

    expect(result.code).toBe(0);
    expect(result.err).toContain(
      'left out t1:profantasy-cartographers-annual@illustrative (redistribution is none); add --include-restricted to export it',
    );
    expect(await names(out)).not.toContain(
      'library/profantasy-cartographers-annual/illustrative/extracted/example-map.png',
    );
  });

  it('rejects positional arguments', async () => {
    const world = await instance();
    const result = await gm(['assets', 'export', 'game-a', '--all'], { env: world.env });
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('assets export takes no positional arguments');
  });
});

describe('gm assets import', () => {
  it('fills a fresh library and blob store with the exported bytes, and is idempotent', async () => {
    const world = await instance();
    const out = join(tempDir(), 'all-games.zip');
    await gm(['assets', 'export', '--used', '--all-games', '--out', out], { cwd: world.gamesDir, env: world.env });

    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };
    const first = await gm(['assets', 'import', out], { env: fresh });
    expect(first.code).toBe(0);
    expect(first.out).toEqual(
      expect.arrayContaining([`added blobs/${world.made}`, `added ${ORC_ZIP}`, `added ${LOOP_ZIP}`]),
    );
    expect(first.out.at(-1)).toBe('imported 12 files; 0 already present; 0 failed');
    const index = await gm(['assets', 'info', ORC, '--json'], { env: fresh });
    expect(index.code).toBe(0);
    expect(
      readFileSync(
        join(fresh.OGM_ASSETS_ROOT, 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb'),
        'utf8',
      ),
    ).toBe('orc-bytes');
    const store = new FsBlobStore({
      root: fresh.OGM_BLOB_ROOT,
      signingKey: 'unused',
      publicOrigin: 'http://127.0.0.1',
    });
    expect(await store.head(`sha256:${world.made}`)).toMatchObject({ bytes: 10, mime: 'image/png' });

    const again = await gm(['assets', 'import', out], { env: fresh });
    expect(again).toMatchObject({ code: 0, out: ['imported 0 files; 12 already present; 0 failed'] });
  });

  it('lets a fresh clone build the same manifest after importing its used assets', async () => {
    const world = await instance();
    const sheetBytes = await sharp({
      create: { width: 16, height: 8, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 1 } },
    })
      .png()
      .toBuffer();
    writeFileSync(join(world.assetsRoot, SHEET_FILE), sheetBytes);
    const source = join(world.gamesDir, 'source');
    mkdirSync(source);
    const used = await gm(['assets', 'use', SHEET, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd: source,
      env: world.env,
    });
    expect(used.code).toBe(0);
    const sourceBuild = await gm(['build', 'assets', '--no-cache'], { cwd: source, env: world.env });
    expect(sourceBuild.err).toEqual([]);
    expect(sourceBuild).toMatchObject({ code: 0 });
    const sourceManifest = readFileSync(join(source, 'public/assets/manifest.json'));

    const exported = join(tempDir(), 'source.zip');
    const exportResult = await gm(['assets', 'export', '--used', '--out', exported], {
      cwd: source,
      env: world.env,
    });
    expect(exportResult.code).toBe(0);

    const clone = tempDir('gm-fresh-clone-');
    writeFileSync(join(clone, 'assets.lock.json'), readFileSync(join(source, 'assets.lock.json')));
    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };
    const imported = await gm(['assets', 'import', exported], { env: fresh });
    expect(imported.code).toBe(0);
    const cloneBuild = await gm(['build', 'assets', '--no-cache'], { cwd: clone, env: fresh });

    expect(cloneBuild.code).toBe(0);
    expect(sha(readFileSync(join(clone, 'public/assets/manifest.json')))).toBe(sha(sourceManifest));
  });

  it('never overwrites a different file already in the library and reports it', async () => {
    const world = await instance();
    const out = join(tempDir(), 'a.zip');
    await gm(['assets', 'export', '--used', '--out', out], { cwd: world.gameA, env: world.env });

    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };
    const mine = join(
      fresh.OGM_ASSETS_ROOT,
      'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb',
    );
    mkdirSync(join(mine, '..'), { recursive: true });
    writeFileSync(mine, 'my-own-orc');
    const result = await gm(['assets', 'import', out], { env: fresh });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`${ORC_ZIP}: a different file is already at ${mine}; kept it`]);
    expect(readFileSync(mine, 'utf8')).toBe('my-own-orc');
  });

  it('never trusts corrupt bytes already stored under a blob hash', async () => {
    const world = await instance();
    const out = join(tempDir(), 'a.zip');
    await gm(['assets', 'export', '--used', '--out', out], { cwd: world.gameA, env: world.env });
    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };
    const store = new FsBlobStore({
      root: fresh.OGM_BLOB_ROOT,
      signingKey: 'unused',
      publicOrigin: 'http://127.0.0.1',
    });
    await store.put(Buffer.from('made-bytes'), 'image/png');
    const corrupt = blobPath(fresh.OGM_BLOB_ROOT, `sha256:${world.made}`);
    chmodSync(corrupt, 0o644);
    writeFileSync(corrupt, 'corrupt');

    const result = await gm(['assets', 'import', out], { env: fresh });

    expect(result.code).toBe(1);
    expect(result.err).toContain(`blobs/${world.made}: a different blob is already at ${corrupt}; kept it`);
    expect(readFileSync(corrupt, 'utf8')).toBe('corrupt');
  });

  it('rejects entries whose bytes do not match the rights report', async () => {
    const world = await instance();
    const exported = join(tempDir(), 'a.zip');
    await gm(['assets', 'export', '--used', '--out', exported], { cwd: world.gameA, env: world.env });
    const tampered = new AdmZip(exported);
    tampered.updateFile(ORC_ZIP, Buffer.from('evil-bytes'));
    const out = join(tempDir(), 'tampered.zip');
    tampered.writeZip(out);

    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };
    const result = await gm(['assets', 'import', out], { env: fresh });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`${ORC_ZIP}: zip size 10 disagrees with reported 9; skipped`]);
    expect(
      existsSync(
        join(fresh.OGM_ASSETS_ROOT, 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb'),
      ),
    ).toBe(false);
  });
});

describe('zip writer and reader', () => {
  it('writes zip64 records past the limit that unzip and the reader both accept', async () => {
    const path = join(tempDir(), 'z64.zip');
    const source = join(tempDir(), 'big.bin');
    writeFileSync(source, Buffer.alloc(300, 7));
    const zip = await ZipWriter.create(path, 100);
    await zip.addBuffer('a/small.txt', Buffer.from('hi'));
    await zip.addFile('a/big.bin', source);
    await zip.close();

    const reader = await ZipReader.open(path);
    expect(reader.entries.map((item) => [item.name, item.size])).toEqual([
      ['a/small.txt', 2],
      ['a/big.bin', 300],
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await reader.stream(reader.entries[1]!)) chunks.push(chunk as Buffer);
    await reader.close();
    expect(Buffer.concat(chunks)).toEqual(Buffer.alloc(300, 7));
    if (existsSync('/usr/bin/unzip')) expect(execFileSync('unzip', ['-tq', path]).toString()).toContain('No errors');
  });

  it('reads deflated entries written by other tools', async () => {
    const path = join(tempDir(), 'deflate.zip');
    const other = new AdmZip();
    other.addFile('x/y.txt', Buffer.from('hello '.repeat(100)));
    other.writeZip(path);
    const reader = await ZipReader.open(path);
    const chunks: Buffer[] = [];
    for await (const chunk of await reader.stream(reader.entries[0]!)) chunks.push(chunk as Buffer);
    await reader.close();
    expect(reader.entries[0]!.method).toBe(8);
    expect(Buffer.concat(chunks).toString()).toBe('hello '.repeat(100));
  });

  it('refuses entry names that escape the target directory', async () => {
    const zip = await ZipWriter.create(join(tempDir(), 'bad.zip'));
    await expect(zip.addBuffer('library/../../etc/passwd', Buffer.from('x'))).rejects.toThrow('unsafe zip entry name');
    await zip.abort();
  });

  it('rejects a central directory range outside the archive before allocating it', async () => {
    const path = join(tempDir(), 'bad-directory.zip');
    const zip = new AdmZip();
    zip.addFile('x.txt', Buffer.from('x'));
    zip.writeZip(path);
    const bytes = readFileSync(path);
    const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThanOrEqual(0);
    bytes.writeUInt32LE(bytes.length, eocd + 12);
    writeFileSync(path, bytes);

    await expect(ZipReader.open(path)).rejects.toThrow('zip central directory is outside the zip file');
  });
});

describe('export rights edge cases', () => {
  it('leaves out an asset whose current card is restricted even when an older lock says free', async () => {
    const world = await instance();
    const stale = await game(join(world.gamesDir, 'c'), 'game-c', [entry(SYNTY, 'torch-bytes')]);
    const out = join(tempDir(), 'c.zip');
    const result = await gm(['assets', 'export', '--used', '--out', out], { cwd: stale, env: world.env });

    expect(result.code).toBe(0);
    expect(result.err).toEqual([
      `left out ${SYNTY} (its current card says redistribution is in-build); add --include-restricted to export it`,
    ]);
    expect(await names(out)).not.toContain(SYNTY_ZIP);
  });

  it('refuses to merge two games that lock one id with different bytes', async () => {
    const world = await instance();
    await game(join(world.gamesDir, 'c'), 'game-c', [entry(ORC, 'other-orc-bytes')]);
    const out = join(tempDir(), 'all.zip');
    const result = await gm(['assets', 'export', '--used', '--all-games', '--out', out], {
      cwd: world.gamesDir,
      env: world.env,
    });

    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `${ORC}: game-a and game-c lock it with different bytes, companion files, or rights metadata; refresh one lock`,
    );
    expect(existsSync(out)).toBe(false);
  });

  it('keeps a blob out when any lock entry that pins it is restricted', async () => {
    const world = await instance();
    const shared = await game(join(world.gamesDir, 'c'), 'game-c', [
      entry('t3:game-c/free-copy', 'made-bytes'),
      entry('t3:game-c/private-copy', 'made-bytes', { audience: 'private', redistribution: 'in-build' }),
    ]);
    const out = join(tempDir(), 'c.zip');
    const result = await gm(['assets', 'export', '--used', '--out', out], { cwd: shared, env: world.env });

    expect(result.code).toBe(0);
    expect(await names(out)).not.toContain(`blobs/${world.made}`);

    const included = join(tempDir(), 'c-restricted.zip');
    await gm(['assets', 'export', '--used', '--include-restricted', '--out', included], {
      cwd: shared,
      env: world.env,
    });
    expect(report(included).included.find((item) => item.path === `blobs/${world.made}`)).toMatchObject({
      ids: expect.arrayContaining(['t3:game-c/free-copy', 't3:game-c/private-copy']),
      restricted: true,
      rights: { redistribution: 'in-build' },
    });
  });

  it('applies an asset card narrower than its free pack under --all, with the card rights in the report', async () => {
    const world = await instance();
    const wallCard = join(world.assetsRoot, 'packs/kenney-mini-dungeon/cards/wall.card.json');
    const synty = JSON.parse(
      readFileSync(join(world.assetsRoot, 'packs/synty-polygon-goblin-war-camp/collection.card.json'), 'utf8'),
    ) as { license: string; rights: unknown };
    writeFileSync(
      wallCard,
      JSON.stringify({ ...JSON.parse(readFileSync(wallCard, 'utf8')), license: synty.license, rights: synty.rights }),
    );
    const wallZip = 'library/kenney-mini-dungeon/2.0/extracted/Models/GLB format/wall.glb';
    const args = ['assets', 'export', '--all', '--games-dir', world.gamesDir];

    const out = join(tempDir(), 'all.zip');
    const left = await gm([...args, '--out', out], { cwd: world.gamesDir, env: world.env });
    expect(left.code).toBe(0);
    expect(await names(out)).not.toContain(wallZip);
    expect(await names(out)).toContain(ORC_ZIP);
    expect(left.err).toContain(
      'left out t1:kenney-mini-dungeon/wall@2.0 (redistribution is in-build); add --include-restricted to export it',
    );

    const withRestricted = join(tempDir(), 'all-r.zip');
    await gm([...args, '--include-restricted', '--out', withRestricted], { cwd: world.gamesDir, env: world.env });
    expect(report(withRestricted).included.find((item) => item.path === wallZip)).toMatchObject({
      ids: ['t1:kenney-mini-dungeon/wall@2.0'],
      rights: { redistribution: 'in-build' },
      restricted: true,
    });
  });
});

describe('gm assets import refusals', () => {
  async function exported() {
    const world = await instance();
    const out = join(tempDir(), 'a.zip');
    await gm(['assets', 'export', '--used', '--out', out], { cwd: world.gameA, env: world.env });
    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };
    return { world, out, fresh };
  }

  it('refuses a zip whose entry names climb out of the library', async () => {
    const { fresh } = await exported();
    const hostile = new AdmZip();
    hostile.addFile('rights-report.json', Buffer.from(JSON.stringify({ included: [] })));
    hostile.addFile('library/x/1/extracted/ok.txt', Buffer.from('ok'));
    const out = join(tempDir(), 'hostile.zip');
    hostile.writeZip(out);
    /* adm-zip normalises names on add, so plant a same-length traversal name in the written bytes. */
    const planted = 'library/../../../ooooooo.txt';
    const bytes = readFileSync(out);
    writeFileSync(
      out,
      Buffer.from(bytes.toString('latin1').replaceAll('library/x/1/extracted/ok.txt', planted), 'latin1'),
    );

    const result = await gm(['assets', 'import', out], { env: fresh });
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain(`unsafe zip entry name: ${planted}`);
    expect(existsSync(join(fresh.OGM_ASSETS_ROOT, '..', 'ooooooo.txt'))).toBe(false);
  });

  it('refuses a library parent symlink without writing outside the library', async () => {
    const { out, fresh } = await exported();
    const outside = tempDir('gm-import-outside-');
    symlinkSync(outside, join(fresh.OGM_ASSETS_ROOT, 'packs'), 'dir');

    const result = await gm(['assets', 'import', out], { env: fresh });

    expect(result.code).toBe(1);
    expect(result.err[0]).toContain('refusing unsafe import directory');
    expect(existsSync(join(outside, 'kenney-mini-dungeon'))).toBe(false);
  });

  it('stops deflated payloads as soon as they exceed the reported bytes', async () => {
    const payload = 'library/x/1/extracted/bomb.bin';
    const hostile = new AdmZip();
    hostile.addFile(payload, Buffer.alloc(1024 * 1024));
    hostile.addFile(
      'rights-report.json',
      Buffer.from(JSON.stringify({ included: [{ path: payload, sha256: sha(Buffer.alloc(1024 * 1024)), bytes: 1 }] })),
    );
    const out = join(tempDir(), 'deflate-bomb.zip');
    hostile.writeZip(out);
    const bytes = readFileSync(out);
    const nameAt = bytes.lastIndexOf(Buffer.from(payload));
    expect(nameAt).toBeGreaterThanOrEqual(0);
    const central = nameAt - 46;
    expect(bytes.readUInt32LE(central)).toBe(0x02014b50);
    bytes.writeUInt32LE(1, central + 24);
    writeFileSync(out, bytes);
    const fresh = { OGM_ASSETS_ROOT: tempDir('gm-fresh-lib-'), OGM_BLOB_ROOT: tempDir('gm-fresh-blobs-') };

    const result = await gm(['assets', 'import', out], { env: fresh });

    expect(result.code).toBe(1);
    expect(result.err[0]).toContain(`zip entry ${payload} expands beyond its reported 1 bytes`);
  });

  it('skips a tampered blob and stores nothing under its sha', async () => {
    const { world, out, fresh } = await exported();
    const zip = new AdmZip(out);
    zip.updateFile(`blobs/${world.made}`, Buffer.from('evil-bytes'));
    zip.writeZip(out);

    const result = await gm(['assets', 'import', out], { env: fresh });
    expect(result.code).toBe(1);
    expect(result.err).toEqual([`blobs/${world.made}: bytes hash to ${sha('evil-bytes')}; skipped`]);
    const store = new FsBlobStore({
      root: fresh.OGM_BLOB_ROOT,
      signingKey: 'unused',
      publicOrigin: 'http://127.0.0.1',
    });
    expect(await store.head(`sha256:${world.made}`)).toBeNull();
  });

  it('fails when a reported file is missing from the zip or the report is absent', async () => {
    const { out, fresh } = await exported();
    const zip = new AdmZip(out);
    zip.deleteFile(ORC_ZIP);
    zip.writeZip(out);
    const missing = await gm(['assets', 'import', out], { env: fresh });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(`${ORC_ZIP}: listed in rights-report.json but missing from the zip`);

    zip.deleteFile('rights-report.json');
    zip.writeZip(out);
    const noReport = await gm(['assets', 'import', out], { env: fresh });
    expect(noReport).toMatchObject({
      code: 1,
      err: ['the zip has no rights-report.json; it was not made by gm assets export'],
    });
  });

  it('refuses blobs without a blob store', async () => {
    const { out, fresh } = await exported();
    const result = await gm(['assets', 'import', out], { env: { OGM_ASSETS_ROOT: fresh.OGM_ASSETS_ROOT } });
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('the zip holds blobs but OGM_BLOB_ROOT is unset');
  });
});

it('stages only the rights-checked files pinned by this game for publish', async () => {
  const { stagePublishAssets } = await import('../src/publish-assets.js');
  const world = await instance();
  const staged = join(tempDir('publish-assets-'), 'library');
  const { readLock } = await import('../src/lock.js');
  const { loadIndex, cardById } = await import('@ogm/asset-cards');
  const { rightsForCard } = await import('../src/rules.js');
  const lock = (await readLock(world.gameB))!;
  const index = await loadIndex(world.assetsRoot);
  const card = cardById(world.assetsRoot, index, LOOP)!;
  lock.assets[0]!.rights = rightsForCard(card, index.collections);
  lock.assets[0]!.license = card.resolved.license;
  await writeLock(world.gameB, lock);
  await stagePublishAssets(world.gameB, staged, world.assetsRoot, world.blobRoot);
  expect(readFileSync(join(staged, LOOP_FILE), 'utf8')).toBe('loop-bytes');
  const stagedIndex = await loadIndex(staged);
  expect(cardById(staged, stagedIndex, LOOP)?.id).toBe(LOOP);
  expect(stagedIndex.cards.some((item) => item.id === ORC)).toBe(false);
  expect(existsSync(join(staged, 'packs/kenney-mini-dungeon/2.0/extracted/Models/GLB format/character-orc.glb'))).toBe(
    false,
  );
  expect(existsSync(join(staged, 'blobs', world.unpinned))).toBe(false);
  const privateLock = (await readLock(world.gameA))!;
  privateLock.assets = privateLock.assets.filter((item) => item.id === SYNTY);
  const privateCard = cardById(world.assetsRoot, index, SYNTY)!;
  privateLock.assets[0]!.rights = rightsForCard(privateCard, index.collections);
  privateLock.assets[0]!.license = privateCard.resolved.license;
  await writeLock(world.gameA, privateLock);
  await expect(
    stagePublishAssets(world.gameA, join(staged, 'public'), world.assetsRoot, world.blobRoot),
  ).rejects.toThrow('private-in-public');
  await stagePublishAssets(world.gameA, join(staged, 'private'), world.assetsRoot, world.blobRoot, 'private');
  const blobLock = (await readLock(world.gameA))!;
  blobLock.assets = [entry('t3:game-a/hero-edit', 'made-bytes')];
  await writeLock(world.gameA, blobLock);
  await expect(
    stagePublishAssets(world.gameA, join(staged, 'blob-game'), world.assetsRoot, world.blobRoot, 'private'),
  ).rejects.toThrow('has no trusted per-game authorization');
  const allowedStage = join(staged, 'allowed-blob');
  const grant = { license: blobLock.assets[0]!.license, rights: blobLock.assets[0]!.rights };
  const authorized = new Map([[world.made, grant]]);
  await stagePublishAssets(world.gameA, allowedStage, world.assetsRoot, world.blobRoot, 'private', authorized);
  const stagedBlobs = new FsBlobStore({
    root: join(allowedStage, 'blob-store'),
    signingKey: 'unused',
    publicOrigin: 'http://127.0.0.1',
  });
  expect(await stagedBlobs.head(`sha256:${world.made}`)).toMatchObject({ mime: 'image/png', bytes: 10 });
  expect(await stagedBlobs.head(`sha256:${world.unpinned}`)).toBeNull();
  blobLock.assets[0]!.files = [{ path: 'image/other.webp', sha256: world.unpinned }];
  await writeLock(world.gameA, blobLock);
  await expect(
    stagePublishAssets(
      world.gameA,
      join(staged, 'companion-denied'),
      world.assetsRoot,
      world.blobRoot,
      'private',
      authorized,
    ),
  ).rejects.toThrow('has no trusted per-game authorization');
});

it('refuses a symlinked game lock before reading host files', async () => {
  const { stagePublishAssets } = await import('../src/publish-assets.js');
  const gameDir = tempDir('publish-lock-');
  const outside = join(tempDir('publish-lock-outside-'), 'assets.lock.json');
  writeFileSync(outside, '{}');
  symlinkSync(outside, join(gameDir, 'assets.lock.json'));
  await expect(stagePublishAssets(gameDir, join(gameDir, 'stage'), null, null)).rejects.toThrow(
    'assets.lock.json must be a regular file',
  );
});
