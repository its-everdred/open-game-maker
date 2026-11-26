import { randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { licenseFor } from '@ogm/asset-cards';

import { createCards } from './cards.js';
import { confirmCollection } from './confirm.js';
import { identify } from './identify.js';
import type { DriveManifest, ImportOptions, QueueEntry } from './import-options.js';
import { applyTier2Rights, filterLicensedItems, validateLicenseMap, type LicenseMap } from './license-map.js';
import { archiveStem, unpack, type UnpackCaps } from './unpack.js';

export class PackRefusal extends Error {}

const CAPS: UnpackCaps = { maxMembers: 200_000, maxUnpackedMb: 32_768, maxRatio: 200 };
const ARCHIVE = /\.(?:zip|7z|rar|tar|tgz|tar\.gz|unitypackage)$/i;

function safeSegment(value: string, label: string, pattern: RegExp): string {
  if (!pattern.test(value) || value.includes('..'))
    throw new PackRefusal(`${label} is unsafe: ${JSON.stringify(value)}`);
  return value;
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !fromRoot.startsWith('/'));
}

function resolveInside(root: string, relativePath: string): string {
  if (relativePath.includes('\\') || relativePath.split('/').includes('..'))
    throw new PackRefusal(`unsafe relative path ${JSON.stringify(relativePath)}`);
  const path = resolve(root, ...relativePath.split('/'));
  if (!inside(root, path)) throw new PackRefusal(`path escapes asset inbox: ${JSON.stringify(relativePath)}`);
  return path;
}

function dateOnly(value?: string): string {
  return value?.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function defaultVersion(manifest?: DriveManifest): string {
  return manifest ? `${dateOnly(manifest.downloaded_at)}-r${manifest.revision ?? 0}` : dateOnly();
}

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new PackRefusal(`links are not allowed in pack sources: ${relative(root, path)}`);
    }
    if (entry.isFile()) files.push(path);
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

async function copyExclusive(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
}

async function assembleQueueSource(
  assetsRoot: string,
  dropId: string,
  target: string,
): Promise<{ manifest: DriveManifest; intakePath: string }> {
  const inbox = join(assetsRoot, 'inbox');
  const queuePath = join(inbox, 'queue.jsonl');
  const entries = (await readFile(queuePath, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueEntry)
    .filter((entry) => entry.drop_id === dropId);
  const entry = entries.at(-1);
  if (!entry) throw new PackRefusal(`queue drop not found: ${dropId}`);
  const manifestPath = resolveInside(inbox, entry.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DriveManifest;
  if (manifest.drop_id !== dropId) throw new PackRefusal(`queue manifest drop id does not match ${dropId}`);
  if (!manifest.integrity_ok)
    throw new PackRefusal(`queue integrity check failed: ${(manifest.problems ?? ['unknown problem']).join('; ')}`);
  const currentRoot = manifest.files_root
    ? resolveInside(inbox, manifest.files_root)
    : join(dirname(manifestPath), 'files');
  for (const file of manifest.files) {
    const source =
      file.downloaded === false && file.previous_quarantine
        ? resolveInside(inbox, `quarantine/${file.previous_quarantine}/files/${file.path}`)
        : resolveInside(currentRoot, file.path);
    await copyExclusive(source, resolveInside(target, file.path));
  }
  return {
    manifest,
    intakePath: relative(assetsRoot, join(dirname(manifestPath), 'intake.json'))
      .split(sep)
      .join('/'),
  };
}

async function copyExtracted(source: string, extracted: string): Promise<{ nested: number; dropped: string[] }> {
  const info = await lstat(source);
  if (info.isFile()) {
    if (ARCHIVE.test(source)) return unpack(source, extracted, CAPS);
    await mkdir(extracted, { recursive: true });
    await copyExclusive(source, join(extracted, basename(source)));
    return { nested: 0, dropped: [] };
  }
  await mkdir(extracted, { recursive: true });
  let nested = 0;
  let extractedMembers = 0;
  let extractedBytes = 0;
  const dropped: string[] = [];
  for (const file of await filesUnder(source)) {
    const path = relative(source, file);
    if (!ARCHIVE.test(file)) {
      const fileBytes = (await stat(file)).size;
      if (extractedMembers + 1 > CAPS.maxMembers) throw new PackRefusal(`pack exceeds member limit ${CAPS.maxMembers}`);
      if (extractedBytes + fileBytes > CAPS.maxUnpackedMb * 1024 * 1024)
        throw new PackRefusal('pack exceeds unpacked-size limit');
      await copyExclusive(file, join(extracted, path));
      extractedMembers += 1;
      extractedBytes += fileBytes;
      continue;
    }
    const remainingMembers = CAPS.maxMembers - extractedMembers;
    const remainingBytes = CAPS.maxUnpackedMb * 1024 * 1024 - extractedBytes;
    if (remainingMembers <= 0) throw new PackRefusal(`pack exceeds member limit ${CAPS.maxMembers}`);
    if (remainingBytes <= 0) throw new PackRefusal('pack exceeds unpacked-size limit');
    const archiveTarget = await mkdtemp(join(dirname(extracted), '.archive-'));
    const result = await unpack(file, archiveTarget, {
      ...CAPS,
      maxMembers: remainingMembers,
      maxUnpackedMb: remainingBytes / (1024 * 1024),
    });
    const archiveUsage = await treeUsage(archiveTarget);
    extractedMembers += archiveUsage.members;
    extractedBytes += archiveUsage.bytes;
    nested += 1 + result.nested;
    dropped.push(...result.dropped.map((droppedPath) => `${path}!/${droppedPath}`));
    // Each archive gets its own folder, so archives in one drop that share member names cannot collide.
    const destination = join(extracted, dirname(path), archiveStem(path));
    await mkdir(dirname(destination), { recursive: true });
    await cp(archiveTarget, destination, { recursive: true, force: false, errorOnExist: true });
    await rm(archiveTarget, { recursive: true, force: true });
  }
  return { nested, dropped };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if ((await readFile(path, 'utf8')) === contents) return;
  } catch {
    // New file.
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`);
  await writeFile(temporary, contents, { flag: 'wx' });
  await rename(temporary, path);
}

async function writeText(path: string, contents: string): Promise<void> {
  try {
    if ((await readFile(path, 'utf8')) === contents) return;
  } catch {
    // New file.
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function originalNames(root: string): Promise<string[]> {
  return (await filesUnder(root)).map((file) => relative(root, file).split(sep).join('/'));
}

function titleFromId(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function publishCards(packRoot: string, cards: Awaited<ReturnType<typeof createCards>>): Promise<void> {
  const cardRoot = join(packRoot, 'cards');
  const published = new Set<string>();
  for (const card of cards.assets) {
    const local = card.id.split('/').at(-1)?.split('@')[0] ?? randomBytes(5).toString('hex');
    const name = `${local}.card.json`;
    published.add(name);
    await writeJson(join(cardRoot, name), card);
  }
  try {
    for (const name of await readdir(cardRoot)) {
      if (name.endsWith('.card.json') && !published.has(name)) await rm(join(cardRoot, name));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeJson(join(packRoot, 'collection.card.json'), cards.collection);
}

async function hasSameVersion(packRoot: string, version: string, hashName: string, hash: string): Promise<boolean> {
  try {
    const existing = await readFile(join(packRoot, version, hashName), 'utf8');
    if (existing !== hash) throw new PackRefusal(`version ${version} already exists with different content`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeIntakeIfMissing(path: string, value: unknown): Promise<void> {
  try {
    await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeJson(path, value);
  }
}

export async function importPack(options: ImportOptions) {
  const tier = options.tier ?? 1;
  if (tier === 2 && !options.license) throw new PackRefusal('tier-2 import requires --license');
  if (tier === 2 && !options.confirmedBy?.trim()) {
    throw new PackRefusal('tier-2 import requires --confirmed-by naming the human who checked the mirror licence');
  }
  let licenseMap: LicenseMap | undefined;
  try {
    licenseMap = options.licenseMap ? validateLicenseMap(options.licenseMap) : undefined;
  } catch (error) {
    throw new PackRefusal(error instanceof Error ? error.message : String(error));
  }
  const id = safeSegment(options.id, 'pack id', /^[a-z0-9][a-z0-9-]*$/);
  const topDir = join(options.assetsRoot, options.inspiration ? 'inspiration' : 'packs');
  await mkdir(topDir, { recursive: true });
  const staging = await mkdtemp(join(topDir, `.${id}.import-`));
  const stagedPack = join(staging, 'pack');
  let manifest: DriveManifest | undefined;
  let intakePath: string | undefined;
  let directFormat: 'directory' | 'archive' = 'directory';
  try {
    await mkdir(stagedPack);
    const source = join(staging, 'source');
    if (options.fromQueue) {
      await mkdir(source);
      ({ manifest, intakePath } = await assembleQueueSource(options.assetsRoot, options.fromQueue, source));
    } else {
      if (!options.input) throw new PackRefusal('an input directory or archive is required');
      const input = resolve(options.cwd, options.input);
      await stat(input).catch(() => {
        throw new PackRefusal(`input does not exist: ${input}`);
      });
      const inputInfo = await lstat(input);
      if (inputInfo.isDirectory()) await cp(input, source, { recursive: true, force: false, errorOnExist: true });
      else {
        await mkdir(source);
        await copyExclusive(input, join(source, basename(input)));
        directFormat = ARCHIVE.test(input) ? 'archive' : 'directory';
      }
    }
    const version = safeSegment(options.version ?? defaultVersion(manifest), 'version', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const stagedVersion = join(stagedPack, version);
    const originals = join(stagedVersion, 'originals');
    const extracted = join(stagedVersion, 'extracted');
    await copyExclusive(source, originals);
    const unpacked = await copyExtracted(source, extracted);
    let identified = await identify(extracted);
    const securityDropped = [...identified.dropped];
    let licenseDropped: string[] = [];
    if (licenseMap) {
      try {
        licenseDropped = await filterLicensedItems(extracted, identified.items, licenseMap);
      } catch (error) {
        throw new PackRefusal(error instanceof Error ? error.message : String(error));
      }
      identified = await identify(extracted);
      identified.dropped = [...new Set([...securityDropped, ...identified.dropped])].sort();
    }
    const extractedFiles = await filesUnder(extracted);
    const hashName = 'hash-manifest.txt';
    await writeText(join(stagedVersion, hashName), identified.hashManifest);
    const packRoot = join(topDir, id);
    const collectionId = `t${tier}:${id}@${version}`;
    const requestedLicense = options.license;
    const requestedRow = tier === 1 && requestedLicense ? licenseFor(requestedLicense) : undefined;
    if (await hasSameVersion(packRoot, version, hashName, identified.hashManifest)) {
      let collection = JSON.parse(await readFile(join(packRoot, 'collection.card.json'), 'utf8')) as {
        id: string;
        status: string;
        license: string;
        rights?: unknown;
        collection_info?: { counts?: Record<string, number> };
      };
      if (
        collection.id === collectionId &&
        requestedRow?.confirmed &&
        (collection.status === 'quarantined' || collection.license !== requestedRow.id)
      ) {
        await confirmCollection({
          assetsRoot: options.assetsRoot,
          collectionId,
          license: requestedRow.id,
          confirmedBy: requestedRow.confirmed.by,
        });
        collection = JSON.parse(await readFile(join(packRoot, 'collection.card.json'), 'utf8')) as typeof collection;
      }
      if (collection.id === collectionId) {
        const packPath = join(packRoot, 'pack.json');
        const existing = JSON.parse(await readFile(packPath, 'utf8')) as Record<string, unknown>;
        const source = (existing.source ?? {}) as Record<string, unknown>;
        await writeJson(packPath, {
          ...existing,
          requires: existing.requires ?? [],
          ...(options.vendor !== undefined ? { vendor: options.vendor } : {}),
          ...(options.title !== undefined ? { title: options.title } : {}),
          ...(options.sourceUrl
            ? { source: { ...source, label: options.vendor ?? existing.vendor, url: options.sourceUrl } }
            : {}),
        });
        if (options.title !== undefined || options.vendor !== undefined) {
          const cardPath = join(packRoot, 'collection.card.json');
          const card = JSON.parse(await readFile(cardPath, 'utf8')) as {
            title: string;
            collection_info: Record<string, unknown>;
          };
          if (options.title !== undefined) card.title = options.title;
          if (options.vendor !== undefined) card.collection_info.vendor = options.vendor;
          await writeJson(cardPath, card);
        }
        const status =
          tier === 2
            ? 'imported'
            : collection.status === 'quarantined'
              ? manifest
                ? 'awaiting-license'
                : 'quarantined'
              : 'imported';
        if (intakePath) {
          await writeIntakeIfMissing(resolveInside(options.assetsRoot, intakePath), {
            status,
            collection: collection.id,
            license: collection.license === 'NOASSERTION' ? null : collection.license,
            rights: collection.rights ?? null,
            confirmed_by: status === 'imported' ? (requestedRow?.confirmed?.by ?? null) : null,
            date: dateOnly(manifest?.downloaded_at),
          });
        }
        let cardCount = 0;
        try {
          cardCount = (await readdir(join(packRoot, 'cards'))).filter((name) => name.endsWith('.card.json')).length;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        return {
          collection: collection.id,
          status,
          license: collection.license === 'NOASSERTION' ? null : collection.license,
          rights: collection.rights ?? null,
          confirmed_by:
            status === 'imported' ? (tier === 2 ? options.confirmedBy! : (requestedRow?.confirmed?.by ?? null)) : null,
          cards: cardCount,
          counts: collection.collection_info?.counts ?? {},
          flags: [],
          dropped: [...new Set([...identified.dropped, ...licenseDropped])].sort(),
        };
      }
    }
    const top = options.inspiration ? 'inspiration' : 'packs';
    const cards = await createCards({
      assetsRoot: options.assetsRoot,
      top,
      id,
      title: options.title ?? manifest?.name ?? titleFromId(id),
      version,
      tier,
      vendor: identified.vendor,
      ...(options.vendor !== undefined ? { displayVendor: options.vendor } : {}),
      origin: tier === 2 ? 'mirror' : manifest ? 'drive-drop' : 'vendor-pack',
      extracted,
      items: identified.items,
      filesTotal: extractedFiles.length,
      hashManifest: hashName,
      date: dateOnly(manifest?.downloaded_at),
    });
    if (tier === 2) {
      try {
        applyTier2Rights(cards, {
          license: options.license!,
          licenseRef: options.licenseRef ?? 'operator-confirmed mirror metadata',
          ...(licenseMap ? { licenseMap } : {}),
          ...(options.attribution !== undefined ? { attribution: options.attribution } : {}),
          confirmedBy: options.confirmedBy!,
          date: dateOnly(manifest?.downloaded_at),
        });
      } catch (error) {
        throw new PackRefusal(error instanceof Error ? error.message : String(error));
      }
    }
    const types: Record<string, number> = {};
    for (const file of extractedFiles) {
      const extension = extname(file).slice(1).toLowerCase() || 'none';
      types[extension] = (types[extension] ?? 0) + 1;
    }
    const pack = {
      id,
      vendor: options.vendor ?? identified.vendor,
      title: options.title ?? manifest?.name ?? titleFromId(id),
      license: tier === 2 ? options.license! : 'NOASSERTION',
      ...(tier === 2 ? { license_source: options.licenseRef ?? 'operator-confirmed mirror metadata' } : {}),
      requires: [],
      current: version,
      versions: {
        [version]: {
          format: options.fromQueue ? 'drive-drop' : directFormat,
          originals: await originalNames(originals),
          extracted_files: extractedFiles.length,
          file_types: types,
          added: dateOnly(manifest?.downloaded_at),
          nested_archives: unpacked.nested,
          dropped: [...new Set([...unpacked.dropped, ...identified.dropped, ...licenseDropped])].sort(),
        },
      },
      ...(manifest || options.source || options.sourceUrl
        ? {
            source: {
              ...(manifest
                ? {
                    type: 'google-drive',
                    drive_id: manifest.source?.drive_id ?? manifest.drop_id,
                    quarantine: manifest.quarantine,
                    intake_path: intakePath,
                  }
                : (options.source ?? {})),
              ...(options.sourceUrl ? { label: options.vendor ?? identified.vendor, url: options.sourceUrl } : {}),
            },
          }
        : {}),
    };
    await writeJson(join(stagedPack, 'pack.json'), pack);
    await publishCards(stagedPack, cards);

    try {
      await lstat(packRoot);
      const targetVersion = join(packRoot, version);
      try {
        const existing = await readFile(join(targetVersion, hashName), 'utf8');
        if (existing !== identified.hashManifest)
          throw new PackRefusal(`version ${version} already exists with different content`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await rename(stagedVersion, targetVersion);
      }
      const existingPack = JSON.parse(await readFile(join(packRoot, 'pack.json'), 'utf8')) as typeof pack;
      await writeJson(join(packRoot, 'pack.json'), {
        ...existingPack,
        ...pack,
        requires: existingPack.requires ?? [],
        versions: { ...existingPack.versions, ...pack.versions },
      });
      await publishCards(packRoot, cards);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await rename(stagedPack, packRoot);
    }

    let status: 'quarantined' | 'awaiting-license' | 'imported' =
      tier === 2 ? 'imported' : manifest ? 'awaiting-license' : 'quarantined';
    let license = options.license;
    let rights: unknown = cards.collection.rights;
    let confirmedBy: string | null = tier === 2 ? options.confirmedBy! : null;
    const row = tier === 1 && license ? licenseFor(license) : undefined;
    if (tier === 1 && row?.confirmed) {
      await confirmCollection({
        assetsRoot: options.assetsRoot,
        collectionId: cards.collection.id,
        license: row.id,
        confirmedBy: row.confirmed.by,
      });
      status = 'imported';
      license = row.id;
      confirmedBy = row.confirmed.by;
      const confirmed = JSON.parse(await readFile(join(packRoot, 'collection.card.json'), 'utf8')) as {
        rights?: unknown;
      };
      rights = confirmed.rights ?? null;
    } else if (tier === 1 && intakePath) {
      await writeIntakeIfMissing(resolveInside(options.assetsRoot, intakePath), {
        status: 'awaiting-license',
        collection: cards.collection.id,
        license: license ?? null,
        rights: cards.collection.rights,
        confirmed_by: null,
        date: dateOnly(manifest?.downloaded_at),
      });
    }
    return {
      collection: cards.collection.id,
      status,
      license: license ?? null,
      rights,
      confirmed_by: confirmedBy,
      cards: cards.assets.length,
      counts: cards.collection.collection_info?.counts ?? {},
      flags: cards.validationErrors,
      dropped: [...new Set([...unpacked.dropped, ...identified.dropped, ...licenseDropped])].sort(),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
