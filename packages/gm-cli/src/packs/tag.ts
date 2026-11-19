import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, type Dirent } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { previewKey, renderCollectionSheet, renderSheet, spriteSheet } from '@ogm/asset-previews';
import { checkDocuments, validateCard, type AssetCard } from '@ogm/contracts';

import type { WorkerRecord } from './workers.js';

export type TagKind = 'audio' | 'map' | 'model' | 'sprite';

export type TagTarget = {
  id: string;
  slug: string;
  root: string;
  collectionPath: string;
  collection: AssetCard;
  cards: Array<{ path: string; card: AssetCard; restrictions?: AssetCard[] }>;
};

export type TargetDiscovery = { targets: TagTarget[]; refusals: string[] };

export type Snapshot = {
  roots: string[];
  files: Map<string, Buffer>;
};

function glob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`);
}

async function filesUnder(root: string, suffix: string): Promise<string[]> {
  try {
    if (suffix === '.card.json' && (await lstat(root)).isSymbolicLink()) {
      throw new Error(`card directory symlinks are not allowed: ${root}`);
    }
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    if (suffix === '.card.json' && entries.some((entry) => entry.isSymbolicLink() && entry.name.endsWith(suffix))) {
      throw new Error(`card symlinks are not allowed: ${root}`);
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function matchesKind(card: AssetCard, kind: TagKind): boolean {
  if (kind === 'map') return card.kind === 'inspiration' && card.subkind === 'map';
  if (card.kind !== kind) return false;
  if (kind !== 'model') return true;
  const primary = card.source?.files.find((file) => file.role === 'primary') ?? card.source?.files[0];
  return primary?.format === 'glb';
}

type Redistribution = NonNullable<AssetCard['rights']>['redistribution'];

const OPENNESS: readonly Redistribution[] = ['none', 'in-build', 'free'];

/** The most restrictive of the given redistribution grants; a missing grant counts as none. */
function narrowest(...values: Array<Redistribution | undefined>): Redistribution {
  return values.reduce<Redistribution>(
    (low, value) => (OPENNESS.indexOf(value ?? 'none') < OPENNESS.indexOf(low) ? (value ?? 'none') : low),
    'free',
  );
}

function allowsLocalVision(card: AssetCard, collection: AssetCard): boolean {
  const rights = card.rights ?? collection.rights;
  return Boolean(
    rights?.uses.includes('vision-input') && ['any', 'local-only'].includes(rights.processing ?? 'local-only'),
  );
}

export async function discoverTagTargets(assetsRoot: string, kind: TagKind, only = '*'): Promise<TargetDiscovery> {
  const top = join(assetsRoot, kind === 'map' ? 'inspiration' : 'packs');
  const pattern = glob(only);
  const targets: TagTarget[] = [];
  const refusals: string[] = [];
  let entries: Dirent<string>[];
  try {
    if ((await lstat(top)).isSymbolicLink() || !inside(await realpath(assetsRoot), await realpath(top))) {
      throw new Error(`asset collection directory escapes library: ${top}`);
    }
    entries = await readdir(top, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { targets, refusals };
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (!entry.isDirectory() || !pattern.test(entry.name)) continue;
    const root = join(top, entry.name);
    const collectionPath = join(root, 'collection.card.json');
    let collection: AssetCard;
    try {
      if ((await lstat(collectionPath)).isSymbolicLink())
        throw new Error(`collection card symlink is not allowed: ${collectionPath}`);
      const parsed = validateCard(JSON.parse(await readFile(collectionPath, 'utf8')) as unknown);
      if (!parsed.ok || parsed.card.card_type !== 'collection') continue;
      collection = parsed.card;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (
      !collection.rights?.uses.includes('vision-input') ||
      !['any', 'local-only'].includes(collection.rights.processing ?? 'local-only')
    ) {
      refusals.push(`${entry.name}: effective rights do not allow local vision-input`);
      continue;
    }
    const version =
      kind === 'model' || kind === 'sprite' ? await readCurrentVersion(root, entry.name).catch(() => null) : null;
    const visualRoot = version ? await realpath(join(root, version, 'extracted')).catch(() => null) : null;
    if (visualRoot && !inside(await realpath(root), visualRoot))
      throw new Error(`${entry.name}: extracted directory escapes collection`);
    const candidates: TagTarget['cards'] = [];
    for (const path of await filesUnder(join(root, 'cards'), '.card.json')) {
      const document: unknown = JSON.parse(await readFile(path, 'utf8'));
      const parsed = validateCard(document);
      if (!parsed.ok || parsed.card.card_type !== 'asset') {
        if (document && typeof document === 'object' && !('source' in document)) continue;
        throw new Error(`invalid asset card: ${path}`);
      }
      if (parsed.card.collection !== collection.id)
        throw new Error(`asset card belongs to a different collection: ${path}`);
      for (const source of parsed.card.source?.files ?? []) {
        if (
          !source.path ||
          source.path.includes('\\') ||
          source.path.startsWith('/') ||
          source.path.split('/').some((part) => part === '' || part === '.' || part === '..')
        ) {
          throw new Error(`noncanonical asset source path: ${path}`);
        }
        if (visualRoot) {
          const candidate = resolve(visualRoot, source.path);
          try {
            if ((await realpath(candidate)) !== candidate) throw new Error(`visual source alias: ${path}`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
      candidates.push({ path, card: parsed.card });
    }
    const rightsChecks = checkDocuments([
      { file: collectionPath, doc: collection },
      ...candidates.map(({ path, card }) => ({ file: path, doc: card })),
    ]).results.filter(
      (result) => ['rights=basis', 'no-model-rights', 'processing-rule'].includes(result.check) && !result.ok,
    );
    if (rightsChecks.length) throw new Error(`invalid asset rights in ${entry.name}: ${rightsChecks[0]?.check}`);
    const bySource = new Map<string, AssetCard[]>();
    for (const { card } of candidates) {
      for (const file of card.source?.files ?? []) {
        const references = bySource.get(file.path) ?? [];
        references.push(card);
        bySource.set(file.path, references);
      }
    }
    const cards: TagTarget['cards'] = [];
    for (const candidate of candidates) {
      const card = candidate.card;
      if (
        !matchesKind(card, kind) ||
        ((kind === 'model' || kind === 'sprite') &&
          (card.status === 'reviewed' ||
            card.provenance['*']?.locked ||
            card.provenance.previews?.locked ||
            card.provenance['previews.sheet']?.locked))
      )
        continue;
      const source = card.source?.files.find((file) => file.role === 'primary') ?? card.source?.files[0];
      const restrictions = source ? (bySource.get(source.path) ?? [card]) : [card];
      if (restrictions.every((other) => allowsLocalVision(other, collection)))
        cards.push({ ...candidate, restrictions });
    }
    let audioSources = false;
    if (kind === 'audio' && cards.length === 0) {
      try {
        const version = await readCurrentVersion(root, entry.name);
        audioSources = (await filesUnder(join(root, version, 'extracted'), '')).some((path) =>
          /\.(wav|ogg|mp3|flac|m4a|aif|aiff)$/i.test(path),
        );
      } catch {
        // A collection without a usable pack manifest cannot supply new audio.
      }
    }
    if (cards.length > 0 || audioSources) {
      targets.push({ id: collection.id, slug: entry.name, root, collectionPath, collection, cards });
    }
  }
  return { targets, refusals };
}

export async function snapshotTargets(targets: readonly TagTarget[]): Promise<Snapshot> {
  const roots = targets.map((target) => join(target.root, 'cards'));
  const paths = [
    ...targets.map((target) => target.collectionPath),
    ...(await Promise.all(roots.map((root) => filesUnder(root, '.card.json')))).flat(),
  ];
  return { roots, files: new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path)] as const))) };
}

export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  // Keep the current card present until its saved replacement is durable enough to rename.
  for (const [path, contents] of snapshot.files) {
    await mkdir(dirname(path), { recursive: true });
    const staged = `${path}.restore-${randomUUID()}`;
    try {
      await writeFile(staged, contents, { flag: 'wx' });
      await rename(staged, path);
    } finally {
      await rm(staged, { force: true });
    }
    await rm(`${path}.part`, { force: true });
  }
  for (const root of snapshot.roots) {
    for (const path of await filesUnder(root, '.card.json')) {
      if (!snapshot.files.has(path)) await rm(path);
    }
    for (const path of await filesUnder(root, '.card.json.part')) await rm(path);
  }
}

/** Kernel locks are released if the holder exits, including after a crash. */
export async function lockTargets(targets: readonly TagTarget[]): Promise<() => Promise<void>> {
  const acquired: Array<{ close: () => void; done: Promise<void> }> = [];
  const release = async (): Promise<void> => {
    for (const lock of acquired.reverse()) {
      lock.close();
      await lock.done;
    }
    acquired.length = 0;
  };
  try {
    for (const target of [...targets].sort((a, b) => a.root.localeCompare(b.root))) {
      const path = join(target.root, '.gm-tag.lock');
      const child = spawn('flock', ['-n', path, 'sh', '-c', 'printf locked; cat >/dev/null'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const done = new Promise<void>((resolve) => {
        child.once('close', () => resolve());
        child.once('error', () => resolve());
      });
      const ready = await new Promise<boolean>((resolve) => {
        child.stdout.once('data', () => resolve(true));
        child.once('close', () => resolve(false));
        child.once('error', () => resolve(false));
      });
      if (!ready) throw new Error(`${target.slug} is already being tagged or its lock could not be acquired`);
      acquired.push({ close: () => child.stdin.end(), done });
    }
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}

export function assertWorkerRecord(record: WorkerRecord): void {
  if (record.card === undefined) return;
  if (typeof record.card !== 'string' || isAbsolute(record.card) || record.card.includes('\\')) {
    throw new Error('worker card path must be a relative library path');
  }
  const parts = record.card.split('/');
  if (parts.includes('..') || !record.card.endsWith('.card.json')) throw new Error('worker card path is unsafe');
  if (!['measured', 'tagged', 'reviewed', 'invalid'].includes(String(record.status))) {
    throw new Error('worker card status is invalid');
  }
  if (!Array.isArray(record.flags) || record.flags.some((flag) => typeof flag !== 'string')) {
    throw new Error('worker card flags must be strings');
  }
}

function inside(root: string, candidate: string): boolean {
  const local = relative(root, candidate);
  return local === '' || (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`));
}

export async function validateWorkerCards(
  assetsRoot: string,
  targets: readonly TagTarget[],
  records: readonly WorkerRecord[],
  snapshot: Snapshot,
): Promise<number> {
  const roots = await Promise.all(
    targets.map(async (target) => ({ target, root: await realpath(join(target.root, 'cards')) })),
  );
  const prior = new Map(
    await Promise.all(
      [...snapshot.files].map(async ([path, contents]) => [await realpath(path).catch(() => path), contents] as const),
    ),
  );
  const seen = new Set<string>();
  let count = 0;
  for (const record of records) {
    if (record.card === undefined) continue;
    assertWorkerRecord(record);
    const lexical = resolve(assetsRoot, record.card);
    if (!inside(resolve(assetsRoot), lexical)) throw new Error(`worker card escapes asset root: ${record.card}`);
    const canonical = await realpath(lexical);
    const owner = roots.find(({ root }) => inside(root, canonical))?.target;
    if (!owner) throw new Error(`worker card is outside selected collections: ${record.card}`);
    const before = prior.get(canonical);
    if (before) {
      const previous = validateCard(JSON.parse(before.toString('utf8')) as unknown);
      if (previous.ok && !allowsLocalVision(previous.card, owner.collection)) {
        throw new Error(`worker card's rights exclude local vision tagging: ${record.card}`);
      }
    }
    if (seen.has(canonical)) throw new Error(`worker reported a card more than once: ${record.card}`);
    seen.add(canonical);
    const parsed = validateCard(JSON.parse(await readFile(canonical, 'utf8')) as unknown);
    if (!parsed.ok) throw new Error(`worker card failed validation: ${record.card}: ${parsed.errors.join('; ')}`);
    const priorCard = before ? (JSON.parse(before.toString('utf8')) as Record<string, unknown>) : undefined;
    const currentCard = parsed.card as unknown as Record<string, unknown>;
    if (
      (priorCard &&
        ['rights', 'license', 'source'].some((field) => !isDeepStrictEqual(priorCard[field], currentCard[field]))) ||
      Object.entries(parsed.card.provenance).some(
        ([key, entry]) => key.startsWith('rights') && entry?.by === 'model',
      ) ||
      (!priorCard && currentCard.rights !== undefined)
    ) {
      throw new Error(`worker changed protected fields or model rights provenance: ${record.card}`);
    }
    if (parsed.card.kind === 'model' && !matchesKind(parsed.card, 'model')) {
      throw new Error(`worker reported a model that needs conversion: ${record.card}`);
    }
    if (parsed.card.card_type !== 'asset' || parsed.card.collection !== owner.id) {
      throw new Error(`worker card does not belong to its selected collection: ${record.card}`);
    }
    if (parsed.card.status !== record.status) throw new Error(`worker status does not match ${record.card}`);
    count += 1;
  }
  for (const target of targets) {
    const contents = JSON.parse(await readFile(target.collectionPath, 'utf8')) as Record<string, unknown>;
    const parsed = validateCard(contents);
    if (!parsed.ok || parsed.card.card_type !== 'collection') {
      throw new Error(`worker produced an invalid collection: ${target.collectionPath}`);
    }
    const original = target.collection as unknown as Record<string, unknown>;
    if (
      ['rights', 'license', 'source'].some((field) => !isDeepStrictEqual(original[field], contents[field])) ||
      Object.entries(parsed.card.provenance).some(([key, entry]) => key.startsWith('rights') && entry?.by === 'model')
    ) {
      throw new Error(`worker changed protected fields or model rights provenance: ${target.collectionPath}`);
    }
  }
  for (const root of snapshot.roots) {
    const currentPaths = await filesUnder(root, '.card.json');
    const current = new Set(currentPaths);
    for (const path of currentPaths) {
      const canonical = await realpath(path);
      const previous = prior.get(canonical);
      if ((!previous || !previous.equals(await readFile(path))) && !seen.has(canonical)) {
        throw new Error(`worker changed an unreported card: ${path}`);
      }
    }
    for (const path of snapshot.files.keys()) {
      if (inside(root, path) && path.endsWith('.card.json') && !current.has(path)) {
        throw new Error(`worker removed an unreported card: ${path}`);
      }
    }
  }
  return count;
}

async function writeCard(path: string, card: AssetCard): Promise<void> {
  const validated = validateCard(card);
  if (!validated.ok) throw new Error(`${path}: ${validated.errors.join('; ')}`);
  const staged = `${path}.part`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(staged, `${JSON.stringify(card, null, 2)}\n`);
  await rename(staged, path);
}

function primary(card: AssetCard): NonNullable<AssetCard['source']>['files'][number] {
  const file = card.source?.files.find((candidate) => candidate.role === 'primary') ?? card.source?.files[0];
  if (!file) throw new Error(`${card.id} has no primary source file`);
  return file;
}

async function readCurrentVersion(root: string, slug: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8')) as { current?: unknown };
  if (
    typeof manifest.current !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.current) ||
    manifest.current.includes('..')
  ) {
    throw new Error(`${slug}/pack.json has an invalid current version`);
  }
  return manifest.current;
}

async function currentVersion(target: TagTarget): Promise<string> {
  return readCurrentVersion(target.root, target.slug);
}

function relativeKey(assetsRoot: string, path: string): string {
  return relative(assetsRoot, path).split(sep).join('/');
}

async function safeExistingPreview(root: string, key: string): Promise<boolean> {
  let path = root;
  try {
    for (const part of key.split('/')) {
      path = join(path, part);
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`preview path uses a symlink: ${key}`);
    }
    if (!inside(await realpath(root), await realpath(path))) throw new Error(`preview escapes library: ${key}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function prepareVisualPreviews(options: {
  assetsRoot: string;
  targets: readonly TagTarget[];
  kind: 'model' | 'sprite';
  limit: number;
  software: boolean;
}): Promise<{ pages: string[]; renderers: string[] }> {
  const all = options.targets.flatMap((target) => target.cards.map((entry) => ({ target, ...entry })));
  const selected = all.slice(0, options.limit || undefined);
  const pages: string[] = [];
  const renderers: string[] = [];
  for (const { target, path, card, restrictions } of selected) {
    const inherited = target.collection.rights?.redistribution;
    const redistribution = narrowest(
      inherited,
      ...(restrictions ?? [card]).map((item) => item.rights?.redistribution ?? inherited),
    );
    const source = primary(card);
    const hash = source.sha256.replace(/^sha256:/, '');
    const key = previewKey(hash, `${options.kind}-sheet`, redistribution, {
      version: 1,
      ...(options.kind === 'sprite' ? { pixelArt: card.image?.pixel_art === true } : {}),
    });
    const existing = card.previews?.sheet;
    if (card.provenance['*']?.locked || card.provenance['previews.sheet']?.locked || card.provenance.previews?.locked)
      continue;
    const version = await currentVersion(target);
    const extractedRoot = await realpath(join(target.root, version, 'extracted'));
    if (!inside(await realpath(target.root), extractedRoot))
      throw new Error(`${target.slug}: extracted directory escapes collection`);
    const sourceCandidate = resolve(extractedRoot, source.path);
    if (!inside(extractedRoot, sourceCandidate)) throw new Error(`${card.id} source path escapes its collection`);
    const sourcePath = await realpath(sourceCandidate);
    if (!inside(extractedRoot, sourcePath) || sourcePath !== sourceCandidate)
      throw new Error(`${card.id} source path resolves outside its collection or uses a symlink`);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(sourcePath)) digest.update(chunk as Buffer);
    if (digest.digest('hex') !== hash) throw new Error(`${card.id}: source hash does not match card`);
    if (existing === key && (await safeExistingPreview(options.assetsRoot, existing))) continue;
    const out = join(options.assetsRoot, key);
    if (options.kind === 'model') {
      const result = await renderSheet(sourcePath, out, {
        assetsRoot: options.assetsRoot,
        executablePath: '/usr/bin/chromium',
        software: options.software,
      });
      renderers.push(result.renderer);
    } else {
      await spriteSheet(sourcePath, out, { assetsRoot: options.assetsRoot, pixelArt: card.image?.pixel_art === true });
    }
    const updated = structuredClone(card);
    updated.previews = { ...updated.previews, sheet: key };
    await writeCard(path, updated);
  }

  if (selected.length === all.length) {
    for (const target of options.targets) {
      if (
        target.collection.provenance['*']?.locked ||
        target.collection.provenance.previews?.locked ||
        target.collection.provenance['previews.sheet']?.locked
      )
        continue;
      const cards = await Promise.all(
        target.cards.map(async ({ path }) => JSON.parse(await readFile(path, 'utf8')) as AssetCard),
      );
      const thumbs = cards.flatMap((card) => {
        const key = card.previews?.sheet ?? card.previews?.thumb;
        return key ? [{ id: card.id, file: join(options.assetsRoot, key) }] : [];
      });
      if (thumbs.length !== cards.length || cards.length === 0) continue;
      const combined = createHash('sha256')
        .update(cards.map((card) => card.source?.content_hash ?? card.id).join('\0'))
        .digest('hex');
      const redistribution = narrowest(
        target.collection.rights?.redistribution,
        ...target.cards.flatMap(({ card, restrictions }) =>
          (restrictions ?? [card]).map(
            (item) => item.rights?.redistribution ?? target.collection.rights?.redistribution,
          ),
        ),
      );
      const key = previewKey(combined, `${options.kind}-collection-sheet`, redistribution, {
        items: cards.length,
        version: 1,
      });
      const result = await renderCollectionSheet(thumbs, join(options.assetsRoot, key), {
        assetsRoot: options.assetsRoot,
      });
      const pageKeys = result.pages.map((page) => relativeKey(options.assetsRoot, page));
      pages.push(...pageKeys);
      const collection = structuredClone(target.collection);
      collection.previews = { ...collection.previews, sheet: pageKeys[0] ?? key };
      await writeCard(target.collectionPath, collection);
    }
  }
  return { pages, renderers };
}

function countKey(card: AssetCard): string | null {
  if (card.kind === 'inspiration' && card.subkind === 'map') return 'inspiration/map';
  if (card.kind === 'audio' || card.kind === 'model' || card.kind === 'sprite')
    return card.subkind ? `${card.kind}/${card.subkind}` : card.kind;
  return null;
}

function countsAsKind(card: AssetCard, kind: TagKind): boolean {
  if (kind === 'map') return card.kind === 'inspiration' && card.subkind === 'map';
  return card.kind === kind;
}

export async function reconcileCounts(targets: readonly TagTarget[], kind: TagKind): Promise<void> {
  const prefix = kind === 'map' ? 'inspiration/map' : kind;
  for (const target of targets) {
    const collection = JSON.parse(await readFile(target.collectionPath, 'utf8')) as AssetCard;
    if (!collection.collection_info) throw new Error(`${target.collectionPath}: collection_info is missing`);
    const current = collection.collection_info?.counts ?? {};
    const counts = Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}/`)),
    );
    let total = 0;
    for (const path of await filesUnder(join(target.root, 'cards'), '.card.json')) {
      const parsed = validateCard(JSON.parse(await readFile(path, 'utf8')) as unknown);
      if (!parsed.ok || parsed.card.card_type !== 'asset' || !countsAsKind(parsed.card, kind)) continue;
      const key = countKey(parsed.card);
      if (key) counts[key] = (counts[key] ?? 0) + 1;
      total += 1;
    }
    if (kind !== 'map') counts[kind] = total;
    collection.collection_info = {
      ...collection.collection_info,
      counts: Object.fromEntries(Object.entries(counts).sort()),
    };
    await writeCard(target.collectionPath, collection);
  }
}
