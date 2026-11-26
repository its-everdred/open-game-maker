import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import { unpack } from '../src/packs/unpack.js';

const temporary: string[] = [];
const caps = { maxMembers: 100, maxUnpackedMb: 2, maxRatio: 100 };

async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('unpack', () => {
  it('imports a sparse ZIP over 2 GiB without loading it into memory', async () => {
    const root = await directory('gm-unpack-large-');
    const path = join(root, 'large.zip');
    const zip = new AdmZip();
    zip.addFile('asset.txt', Buffer.from('hello'));
    const bytes = zip.toBuffer();
    const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
    const end = bytes.indexOf(Buffer.from('504b0506', 'hex'));
    const prefix = 0x80000000;
    bytes.writeUInt32LE(prefix, central + 42);
    bytes.writeUInt32LE(prefix + central, end + 16);
    const file = await open(path, 'w');
    try {
      await file.write(bytes, 0, bytes.length, prefix);
    } finally {
      await file.close();
    }
    const destination = join(root, 'out');
    await unpack(path, destination, caps);
    expect(await readFile(join(destination, 'asset.txt'), 'utf8')).toBe('hello');
  });

  it('rejects a ZIP member with an incorrect CRC without publishing files', async () => {
    const root = await directory('gm-unpack-crc-');
    const archive = join(root, 'corrupt.zip');
    const destination = join(root, 'out');
    const zip = new AdmZip();
    zip.addFile('asset.txt', Buffer.from('hello'));
    const bytes = zip.toBuffer();
    const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
    bytes.writeUInt32LE(0, central + 16);
    await writeFile(archive, bytes);
    await expect(unpack(archive, destination, caps)).rejects.toThrow(/CRC mismatch/);
    await expect(readdir(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preflights every zip member so a late traversal leaves the destination empty', async () => {
    const root = await directory('gm-unpack-zip-');
    const archive = join(root, 'hostile.zip');
    const destination = join(root, 'out');
    await mkdir(destination);
    const zip = new AdmZip();
    zip.addFile('safe.txt', Buffer.from('safe'));
    zip.addFile('aa/escape.txt', Buffer.from('escape'));
    const bytes = zip.toBuffer();
    const safe = Buffer.from('aa/escape.txt');
    const hostile = Buffer.from('../escape.txt');
    for (let offset = bytes.indexOf(safe); offset >= 0; offset = bytes.indexOf(safe, offset + hostile.length)) {
      hostile.copy(bytes, offset);
    }
    await writeFile(archive, bytes);

    await expect(unpack(archive, destination, caps)).rejects.toThrow(/escape|unsafe|path/i);
    expect(await readdir(destination)).toEqual([]);
  });

  it('places a unitypackage asset at the first line of its pathname', async () => {
    // Unity writes a second line (a hash) into some pathname files; using the whole text would misplace the asset.
    const root = await directory('gm-unpack-unity-');
    const source = join(root, 'source');
    const destination = join(root, 'out');
    await mkdir(join(source, 'abc123'), { recursive: true });
    await mkdir(destination);
    await writeFile(join(source, 'abc123', 'pathname'), 'Assets/Models/wall.fbx\n00\n');
    await writeFile(join(source, 'abc123', 'asset'), 'mesh');
    const archive = join(root, 'pack.unitypackage');
    await tar.c({ gzip: true, file: archive, cwd: source }, ['abc123']);

    await unpack(archive, destination, caps);

    const files = (await readdir(destination, { recursive: true })).map(String);
    const placed = files.find((file) => file.endsWith('wall.fbx'));
    expect(placed, files.join(', ')).toBeDefined();
    expect(await readFile(join(destination, placed ?? ''), 'utf8')).toBe('mesh');
  });

  it('refuses tar links before extraction', async () => {
    const root = await directory('gm-unpack-tar-');
    const source = join(root, 'source');
    const destination = join(root, 'out');
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, 'target.txt'), 'target');
    await symlink('target.txt', join(source, 'link.txt'));
    const archive = join(root, 'hostile.tgz');
    await tar.c({ gzip: true, cwd: source, file: archive }, ['target.txt', 'link.txt']);

    await expect(unpack(archive, destination, caps)).rejects.toThrow(/link/i);
    expect(await readdir(destination)).toEqual([]);
  });

  it('refuses a tar compression bomb before publishing any files', async () => {
    const root = await directory('gm-unpack-ratio-');
    const source = join(root, 'source');
    const destination = join(root, 'out');
    await mkdir(source);
    await mkdir(destination);
    await writeFile(join(source, 'zeros.bin'), Buffer.alloc(2 * 1024 * 1024));
    const archive = join(root, 'bomb.tgz');
    await tar.c({ gzip: true, cwd: source, file: archive }, ['zeros.bin']);

    await expect(unpack(archive, destination, { ...caps, maxUnpackedMb: 3, maxRatio: 2 })).rejects.toThrow(/ratio/i);
    expect(await readdir(destination)).toEqual([]);
  });

  it('enforces the unpacked-size cap across multiple nested archives', async () => {
    const root = await directory('gm-unpack-nested-cap-');
    const first = new AdmZip();
    first.addFile('first.bin', Buffer.alloc(600 * 1024));
    const second = new AdmZip();
    second.addFile('second.bin', Buffer.alloc(600 * 1024));
    const outer = new AdmZip();
    outer.addFile('first.zip', first.toBuffer());
    outer.addFile('second.zip', second.toBuffer());
    const archive = join(root, 'nested.zip');
    outer.writeZip(archive);

    await expect(
      unpack(archive, join(root, 'out'), { maxMembers: 20, maxUnpackedMb: 1, maxRatio: 10_000 }),
    ).rejects.toThrow(/unpacked-size limit/);
  });

  it('enforces the size limit on a second nested archive without publishing files', async () => {
    const root = await directory('gm-unpack-deep-cap-');
    const inner = new AdmZip();
    inner.addFile('large.bin', Buffer.alloc(1024 * 1024));
    const middle = new AdmZip();
    middle.addFile('inner.zip', inner.toBuffer());
    const outer = new AdmZip();
    outer.addFile('middle.zip', middle.toBuffer());
    const archive = join(root, 'outer.zip');
    const destination = join(root, 'out');
    outer.writeZip(archive);
    await mkdir(destination);
    await expect(unpack(archive, destination, { ...caps, maxUnpackedMb: 1, maxRatio: 10_000 })).rejects.toThrow(
      /unpacked-size limit/,
    );
    expect(await readdir(destination)).toEqual([]);
  });

  it('rejects archives nested beyond the depth limit without publishing files', async () => {
    const root = await directory('gm-unpack-depth-');
    let contents = Buffer.from('end');
    for (let depth = 0; depth < 7; depth += 1) {
      const zip = new AdmZip();
      zip.addFile(depth === 0 ? 'end.txt' : `level${depth}.zip`, contents);
      contents = zip.toBuffer();
    }
    const archive = join(root, 'outer.zip');
    const destination = join(root, 'out');
    await writeFile(archive, contents);
    await mkdir(destination);
    await expect(unpack(archive, destination, caps)).rejects.toThrow(/nesting depth limit/);
    expect(await readdir(destination)).toEqual([]);
  });

  it('extracts one nested archive pass and drops executable files', async () => {
    const root = await directory('gm-unpack-nested-');
    const archive = join(root, 'outer.zip');
    const inner = new AdmZip();
    inner.addFile('model.obj', Buffer.from('o cube'));
    inner.addFile('installer.exe', Buffer.from('MZ'));
    const outer = new AdmZip();
    outer.addFile('wrapper/inner.zip', inner.toBuffer());
    outer.writeZip(archive);

    const result = await unpack(archive, join(root, 'out'), caps);
    expect(result.nested).toBe(1);
    expect(result.dropped).toContain('inner/installer.exe');
    expect(await readFile(join(root, 'out', 'inner', 'model.obj'), 'utf8')).toBe('o cube');
  });
});
