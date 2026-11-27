import { execFile } from 'node:child_process';
import { constants, createWriteStream } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

import * as yauzl from 'yauzl';
import * as tar from 'tar';

export type UnpackCaps = { maxMembers: number; maxUnpackedMb: number; maxRatio: number };
export type UnpackResult = { files: number; nested: number; dropped: string[] };

const execFileAsync = promisify(execFile);
const MAX_NESTED_DEPTH = 5;
const ARCHIVE = /\.(?:zip|7z|rar|tar|tgz|tar\.gz|unitypackage)$/i;
const EXECUTABLE = /\.(?:exe|msi|dll|so|dylib|sh|bat|cmd|ps1|appimage|jar|apk|deb|rpm|dmg|app|com|scr|vbs)$/i;

function unsafePath(name: string): string | null {
  if (!name || name.includes('\0') || name.includes('\\')) return 'empty, NUL, or backslash path';
  if (isAbsolute(name) || /^\/?[A-Za-z]:/.test(name)) return 'absolute path';
  const parts = name.split('/').filter((part) => part !== '');
  if (parts.some((part) => part === '..')) return 'parent traversal';
  if (parts.some((part) => part.length > 255)) return 'path component longer than 255 bytes';
  return null;
}

function checkedPath(root: string, name: string): string {
  const problem = unsafePath(name);
  if (problem) throw new Error(`unsafe archive member ${JSON.stringify(name)}: ${problem}`);
  const target = resolve(root, ...name.split('/'));
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`unsafe archive member ${JSON.stringify(name)}: escaped destination`);
  }
  return target;
}

async function assertEmpty(destination: string): Promise<void> {
  try {
    const info = await lstat(destination);
    if (!info.isDirectory()) throw new Error(`${destination}: destination is not a directory`);
    if ((await readdir(destination)).length > 0) throw new Error(`${destination}: destination must be empty`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function limitBytes(caps: UnpackCaps): number {
  return caps.maxUnpackedMb * 1024 * 1024;
}

async function extractZip(file: string, destination: string, caps: UnpackCaps): Promise<void> {
  const archive = await new Promise<yauzl.ZipFile>((resolveZip, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('unable to open ZIP'));
      else resolveZip(zip);
    });
  });
  try {
    const entries: yauzl.Entry[] = [];
    const paths = new Set<string>();
    let total = 0;
    await new Promise<void>((resolveEntries, reject) => {
      archive.on('error', reject);
      archive.on('end', resolveEntries);
      archive.on('entry', (entry: yauzl.Entry) => {
        try {
          if (entries.length >= caps.maxMembers) throw new Error(`archive exceeds member limit ${caps.maxMembers}`);
          checkedPath(destination, entry.fileName);
          const key = normalize(entry.fileName).replaceAll('\\', '/');
          if (paths.has(key)) throw new Error(`duplicate archive member ${JSON.stringify(entry.fileName)}`);
          paths.add(key);
          const mode = entry.externalFileAttributes >>> 16;
          if ((mode & 0o170000) === 0o120000) throw new Error(`archive link is not allowed: ${entry.fileName}`);
          if (entry.isEncrypted()) throw new Error(`encrypted archive member is not allowed: ${entry.fileName}`);
          if (!entry.fileName.endsWith('/')) {
            total += entry.uncompressedSize;
            if (total > limitBytes(caps)) throw new Error('archive exceeds unpacked-size limit');
            if (
              entry.uncompressedSize > 1024 * 1024 &&
              entry.compressedSize > 0 &&
              entry.uncompressedSize / entry.compressedSize > caps.maxRatio
            ) {
              throw new Error(`archive member exceeds compression-ratio limit: ${entry.fileName}`);
            }
          }
          entries.push(entry);
          archive.readEntry();
        } catch (error) {
          reject(error);
        }
      });
      archive.readEntry();
    });
    const archiveBytes = (await stat(file)).size;
    if (total > 1024 * 1024 && archiveBytes > 0 && total / archiveBytes > caps.maxRatio) {
      throw new Error('archive exceeds compression-ratio limit');
    }
    for (const entry of entries) {
      const target = checkedPath(destination, entry.fileName);
      if (entry.fileName.endsWith('/')) {
        await mkdir(target, { recursive: true, mode: 0o755 });
        continue;
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, reject) => {
        archive.openReadStream(entry, (error, input) => {
          if (error || !input) reject(error ?? new Error('unable to read ZIP entry'));
          else resolveStream(input);
        });
      });
      let checksum = 0;
      const verify = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          checksum = crc32(chunk, checksum);
          callback(null, chunk);
        },
        flush(callback) {
          callback(checksum === entry.crc32 ? undefined : new Error(`archive member CRC mismatch: ${entry.fileName}`));
        },
      });
      await pipeline(stream, verify, createWriteStream(target, { mode: 0o644, flags: 'wx' }));
    }
  } finally {
    archive.close();
  }
}

async function preflightTar(file: string, destination: string, caps: UnpackCaps): Promise<void> {
  let members = 0;
  let total = 0;
  let problem: Error | undefined;
  const paths = new Set<string>();
  await tar.t({
    file,
    strict: true,
    onReadEntry(entry) {
      if (!problem) {
        try {
          members += 1;
          checkedPath(destination, entry.path);
          const key = normalize(entry.path).replaceAll('\\', '/');
          if (paths.has(key)) throw new Error(`duplicate archive member ${JSON.stringify(entry.path)}`);
          paths.add(key);
          if (
            entry.type === 'SymbolicLink' ||
            entry.type === 'Link' ||
            entry.type === 'CharacterDevice' ||
            entry.type === 'BlockDevice' ||
            entry.type === 'FIFO'
          ) {
            throw new Error(`archive link or device is not allowed: ${entry.path}`);
          }
          total += entry.size ?? 0;
          if (members > caps.maxMembers) throw new Error(`archive exceeds member limit ${caps.maxMembers}`);
          if (total > limitBytes(caps)) throw new Error('archive exceeds unpacked-size limit');
        } catch (error) {
          problem = error instanceof Error ? error : new Error(String(error));
        }
      }
      entry.resume();
    },
  });
  if (problem) throw problem;
  const archiveBytes = (await stat(file)).size;
  if (total > 1024 * 1024 && archiveBytes > 0 && total / archiveBytes > caps.maxRatio) {
    throw new Error('archive exceeds compression-ratio limit');
  }
}

async function reassembleUnityPackage(destination: string): Promise<void> {
  for (const name of await readdir(destination)) {
    const directory = join(destination, name);
    if (!(await lstat(directory)).isDirectory()) continue;
    try {
      const targetName = (await readFile(join(directory, 'pathname'), 'utf8')).split(/\r?\n/)[0]?.trim() ?? '';
      const target = checkedPath(destination, targetName);
      await mkdir(dirname(target), { recursive: true });
      await link(join(directory, 'asset'), target);
      try {
        await copyFile(join(directory, 'asset.meta'), `${target}.meta`, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function extractTar(file: string, destination: string, caps: UnpackCaps, unity: boolean): Promise<void> {
  await preflightTar(file, destination, caps);
  await tar.x({
    file,
    cwd: destination,
    strict: true,
    preservePaths: false,
    filter: (_path, entry) => {
      const type = 'type' in entry ? entry.type : '';
      return !['SymbolicLink', 'Link', 'CharacterDevice', 'BlockDevice', 'FIFO'].includes(type);
    },
  });
  if (unity) await reassembleUnityPackage(destination);
}

function parse7zList(
  stdout: string,
): Array<{ path: string; folder: boolean; size: number; link: boolean; encrypted: boolean }> {
  const entries: Array<{ path: string; folder: boolean; size: number; link: boolean; encrypted: boolean }> = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const values = Object.fromEntries(
      block.split(/\r?\n/).flatMap((line) => {
        const split = line.indexOf(' = ');
        return split < 0 ? [] : [[line.slice(0, split), line.slice(split + 3)]];
      }),
    );
    if (values.Path && values.Size !== undefined) {
      const unixMode = (values.Attributes ?? '').split(/\s+/).some((value) => /^l[rwx-]{9}$/.test(value));
      const size = Number(values.Size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(`archive member has invalid size: ${values.Path}`);
      entries.push({
        path: values.Path,
        folder: values.Folder === '+',
        size,
        link: Boolean(values['Symbolic Link'] || values['Hard Link'] || unixMode),
        encrypted: values.Encrypted === '+',
      });
    }
  }
  return entries;
}

async function extract7z(file: string, destination: string, caps: UnpackCaps): Promise<void> {
  const { stdout } = await execFileAsync('7z', ['l', '-slt', '--', file], {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60 * 60_000,
  });
  const entries = parse7zList(stdout);
  if (entries.length > caps.maxMembers) throw new Error(`archive exceeds member limit ${caps.maxMembers}`);
  let total = 0;
  const paths = new Set<string>();
  for (const entry of entries) {
    checkedPath(destination, entry.path);
    if (paths.has(entry.path)) throw new Error(`duplicate archive member ${JSON.stringify(entry.path)}`);
    paths.add(entry.path);
    if (entry.link) throw new Error(`archive link is not allowed: ${entry.path}`);
    if (entry.encrypted) throw new Error(`encrypted archive member is not allowed: ${entry.path}`);
    total += entry.size;
    if (total > limitBytes(caps)) throw new Error('archive exceeds unpacked-size limit');
  }
  const archiveBytes = (await stat(file)).size;
  if (total > 1024 * 1024 && archiveBytes > 0 && total / archiveBytes > caps.maxRatio) {
    throw new Error('archive exceeds compression-ratio limit');
  }
  await execFileAsync('7z', ['x', '-y', `-o${destination}`, '--', file], {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60 * 60_000,
  });
}

async function assertPlainTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    checkedPath(root, relative(root, path).split(sep).join('/'));
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`archive link or device is not allowed: ${relative(root, path)}`);
    }
  }
}

async function extractArchive(file: string, destination: string, caps: UnpackCaps): Promise<void> {
  const lower = file.toLowerCase();
  if (lower.endsWith('.zip')) await extractZip(file, destination, caps);
  if (
    lower.endsWith('.tar') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.unitypackage')
  ) {
    await extractTar(file, destination, caps, lower.endsWith('.unitypackage'));
  } else if (lower.endsWith('.7z') || lower.endsWith('.rar')) {
    await extract7z(file, destination, caps);
  } else if (!lower.endsWith('.zip')) {
    throw new Error(`${file}: unsupported archive format`);
  }
  await assertPlainTree(destination);
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
  }
  return files.sort();
}

async function treeUsage(root: string): Promise<{ members: number; bytes: number }> {
  let members = 0;
  let bytes = 0;
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    members += 1;
    if (entry.isFile()) bytes += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return { members, bytes };
}

async function stripWrapper(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0]?.isDirectory()) return;
  const wrapper = join(root, entries[0].name);
  const temporary = await mkdtemp(join(dirname(root), '.wrapper-'));
  for (const child of await readdir(wrapper)) await rename(join(wrapper, child), join(temporary, child));
  await rm(wrapper, { recursive: true, force: true });
  for (const child of await readdir(temporary)) await rename(join(temporary, child), join(root, child));
  await rm(temporary, { recursive: true, force: true });
}

export function archiveStem(file: string): string {
  const name = basename(file);
  return name.replace(/\.(?:tar\.gz|unitypackage|zip|7z|rar|tar|tgz)$/i, '');
}

export async function unpack(source: string, destination: string, caps: UnpackCaps): Promise<UnpackResult> {
  await assertEmpty(destination);
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), `.${basename(destination)}.unpack-`));
  const dropped: string[] = [];
  let nested = 0;
  try {
    await extractArchive(source, staging, caps);
    await stripWrapper(staging);
    const nestedArchives = (await walk(staging))
      .filter((file) => ARCHIVE.test(file))
      .map((file) => ({ file, depth: 1 }));
    const aggregate = await treeUsage(staging);
    for (const { file: archive, depth } of nestedArchives) {
      if (depth > MAX_NESTED_DEPTH) throw new Error(`archive exceeds nesting depth limit ${MAX_NESTED_DEPTH}`);
      const remainingBytes = limitBytes(caps) - aggregate.bytes;
      const remainingMembers = caps.maxMembers - aggregate.members - 1;
      if (remainingBytes <= 0) throw new Error('archive exceeds unpacked-size limit');
      if (remainingMembers <= 0) throw new Error(`archive exceeds member limit ${caps.maxMembers}`);
      const target = join(dirname(archive), archiveStem(archive));
      const nestedStaging = await mkdtemp(join(dirname(archive), `.${archiveStem(archive)}.nested-`));
      await extractArchive(archive, nestedStaging, {
        ...caps,
        maxMembers: remainingMembers,
        maxUnpackedMb: remainingBytes / (1024 * 1024),
      });
      await stripWrapper(nestedStaging);
      const nestedUsage = await treeUsage(nestedStaging);
      await rename(nestedStaging, target);
      nestedArchives.push(
        ...(await walk(target)).filter((file) => ARCHIVE.test(file)).map((file) => ({ file, depth: depth + 1 })),
      );
      aggregate.members += nestedUsage.members + 1;
      aggregate.bytes += nestedUsage.bytes;
      nested += 1;
    }
    await stripWrapper(staging);
    const usage = await treeUsage(staging);
    if (usage.members > caps.maxMembers) throw new Error(`archive exceeds member limit ${caps.maxMembers}`);
    if (usage.bytes > limitBytes(caps)) throw new Error('archive exceeds unpacked-size limit');
    for (const file of await walk(staging)) {
      if (!EXECUTABLE.test(file)) continue;
      dropped.push(relative(staging, file).split(sep).join('/'));
      await rm(file, { force: true });
    }
    try {
      await access(destination);
      await rm(destination, { recursive: true });
    } catch {
      // Destination was absent, which is also allowed.
    }
    await rename(staging, destination);
    for (const file of await walk(destination)) await chmod(file, 0o644);
    return { files: (await walk(destination)).length, nested, dropped: dropped.sort() };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
