import { copyFile, lstat, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  ATLAS_PACK,
  cardById,
  isAtlasSpriteId,
  loadIndex,
  materializeAtlasSprite,
  packOf,
  setFor,
  type ResolvedCard,
} from '@ogm/asset-cards';
import { povIdSchema, styleFamilyIdSchema, type AssetMetadata, type AssetsLock, type LockEntry } from '@ogm/contracts';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { repoVisibility, requireAssetsRoot, resolveContainedPath } from '../../context.js';
import { renderCredits } from '../../credits.js';
import { allowsAiGeneratedAssets } from '../../game-settings.js';
import { creditForCard } from '../../license-metadata.js';
import { readLock, sha256File, upsertLock, writeGeneratedText, writeLock } from '../../lock.js';
import { collectionParts, libraryRoot, repoPaths } from '../../resolve.js';
import { refusalsForUse, rightsForCard, type Refusal } from '../../rules.js';

type SourceFile = { path: string; absolute: string; sha256: string };
type CopySource = { source: string; destination: string; sha256: string };

function safeDestination(cwd: string, value: string): string {
  if (isAbsolute(value))
    throw new UsageError('--dest must be relative to the game repo', 'gm assets use --vendor --dest assets');
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some((part) => part === '..' || part === '.gm' || part === 'node_modules')) {
    throw new UsageError(
      '--dest must stay inside the game repo and outside .gm and node_modules',
      'gm assets use --vendor --dest assets',
    );
  }
  const destination = resolve(cwd, value);
  const root = resolve(cwd);
  if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
    throw new UsageError('--dest escapes the game repo', 'gm assets use --vendor --dest assets');
  }
  return destination;
}

/** The card's primary file first, then its textures and companions, each located and hashed in the library. */
async function librarySources(
  assetsRoot: string,
  card: ResolvedCard,
  collection: ResolvedCard,
): Promise<{ files: SourceFile[]; refusal?: Refusal }> {
  const sourceFiles = card.source?.files.filter(
    (file) =>
      file.role === undefined || file.role === 'primary' || file.role === 'texture' || file.role === 'companion',
  );
  const primary = sourceFiles?.find((file) => file.role === 'primary') ?? sourceFiles?.[0];
  if (!primary || !card.kind) {
    return {
      files: [],
      refusal: { code: 'rights', rule: 'missing-file', id: card.id, detail: 'card has no primary source file' },
    };
  }
  const root = libraryRoot(assetsRoot, card.id, collection);
  const files: SourceFile[] = [];
  for (const sourceFile of [primary, ...(sourceFiles ?? []).filter((file) => file !== primary)]) {
    let realSource: string | null;
    try {
      realSource = await resolveContainedPath(root, resolve(root, sourceFile.path));
      if (realSource !== null && !(await stat(realSource)).isFile()) realSource = null;
    } catch {
      realSource = null;
    }
    if (realSource === null) {
      return {
        files: [],
        refusal: {
          code: 'rights',
          rule: 'missing-file',
          id: card.id,
          detail: `source file ${sourceFile.path} is missing or escapes the extracted collection`,
        },
      };
    }
    files.push({ path: sourceFile.path, absolute: realSource, sha256: await sha256File(realSource) });
  }
  return { files };
}

function vendorCopies(destinationRoot: string, card: ResolvedCard, files: SourceFile[]): CopySource[] {
  const { slug } = collectionParts(card.id);
  return files.map((file) => ({
    source: file.absolute,
    destination: join(destinationRoot, card.kind!, slug, basename(file.path)),
    sha256: file.sha256,
  }));
}

function refusalLine(refusal: Refusal): string {
  return `${refusal.id}  ${refusal.rule}  ${refusal.detail}. Try: gm assets why ${refusal.id}`;
}

function metadataFor(card: ResolvedCard): AssetMetadata | undefined {
  const meta: AssetMetadata = {
    ...(card.sprite === undefined ? {} : { sprite: card.sprite }),
    ...(card.rig === undefined ? {} : { rig: card.rig }),
    ...(card.kit === undefined ? {} : { kit: card.kit }),
    ...(card.geometry === undefined ? {} : { geometry: card.geometry }),
    ...(card.generation === undefined ? {} : { generation: card.generation }),
  };
  return Object.keys(meta).length === 0 ? undefined : meta;
}

async function idsFromArgs(cwd: string, args: string[], picks: unknown): Promise<string[]> {
  const ids = [...args];
  if (typeof picks === 'string') {
    const text = await readFile(resolve(cwd, picks), 'utf8');
    ids.push(
      ...text
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean),
    );
  }
  return [...new Set(ids)];
}

/**
 * An id that was vendored (or copied by an older `gm assets use`) and is now a library reference leaves its repo
 * copies behind; delete the ones no remaining lock entry owns so the repo carries no unlocked bytes.
 */
async function removeReplacedCopies(
  cwd: string,
  lock: AssetsLock,
  accepted: Array<{ card: ResolvedCard; existing?: LockEntry }>,
  byId: Map<string, ResolvedCard>,
): Promise<void> {
  const owned = new Set(lock.assets.flatMap((entry) => repoPaths(entry, byId.get(entry.id))));
  for (const { card, existing } of accepted) {
    if (existing === undefined) continue;
    const pinned = new Map([
      [existing.path, existing.sha256],
      ...(existing.files ?? []).map((f) => [f.path, f.sha256] as const),
    ]);
    for (const path of repoPaths(existing, card).filter((candidate) => !owned.has(candidate))) {
      const absolute = resolve(cwd, path);
      try {
        if ((await lstat(absolute)).isSymbolicLink() || (await resolveContainedPath(cwd, absolute)) === null) continue;
        /* A copy edited since it was vendored is someone's work: leave it for `gm check assets` to report. */
        const expected = pinned.get(path);
        if (expected !== undefined && (await sha256File(absolute)) !== expected) continue;
        await unlink(absolute);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}

/** `--vendor`: copy each file into the repo, verify its sha256, and return repo-relative paths. */
async function vendorFiles(cwd: string, copies: CopySource[]): Promise<Array<{ path: string; sha256: string }>> {
  const placed: Array<{ path: string; sha256: string }> = [];
  for (const copy of copies) {
    await mkdir(dirname(copy.destination), { recursive: true });
    const realDestination = await resolveContainedPath(cwd, dirname(copy.destination));
    if (realDestination === null) {
      throw new UsageError('asset destination resolves outside the game repo', 'gm assets use --vendor --dest assets');
    }
    try {
      if ((await lstat(copy.destination)).isSymbolicLink()) {
        throw new UsageError('asset destination is a symbolic link', 'remove the link and retry gm assets use');
      }
    } catch (error) {
      if (error instanceof UsageError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await copyFile(copy.source, copy.destination);
    const copied = await sha256File(copy.destination);
    if (copied !== copy.sha256) {
      throw new Error(`copied asset failed sha256 verification: ${relative(cwd, copy.destination)}`);
    }
    placed.push({ path: relative(cwd, copy.destination).replaceAll(sep, '/'), sha256: copied });
  }
  return placed;
}

export const command: GmCommand = {
  name: 'assets use',
  summary: 'reference library assets from this game and update the rights lock and credits',
  usage: '<id...> [-f picks.txt] [--placeholder] [--exception reason] [--refresh] [--vendor [--dest assets]]',
  example: 'assets use t1:kenney-mini-dungeon/character-orc@2.0 --family chunky-low-poly --pov iso',
  flags: {
    file: { type: 'string', short: 'f', help: 'read one asset id per line (# comments allowed)' },
    vendor: {
      type: 'boolean',
      default: false,
      help: 'copy the files into the repo (only assets whose rights allow free redistribution)',
    },
    dest: { type: 'string', default: 'assets', help: 'relative destination directory for --vendor' },
    placeholder: { type: 'boolean', default: false, help: 'allow placeholder-only rights' },
    exception: { type: 'string', help: 'record why an out-of-family asset is intentional' },
    partial: { type: 'boolean', default: false, help: 'write accepted ids even when another id is refused' },
    refresh: { type: 'boolean', default: false, help: 'refresh current rights for existing lock entries' },
    family: { type: 'string', help: 'style family when creating a new lock' },
    pov: { type: 'string', help: 'camera point of view when creating a new lock' },
  },
  async run(ctx, args, flags) {
    const assetsRoot = requireAssetsRoot(ctx);
    const index = await loadIndex(assetsRoot);
    const byId = new Map(index.cards.map((card) => [card.id, card]));
    let lock = await readLock(ctx.cwd);
    let ids = await idsFromArgs(ctx.cwd, args, flags.file);
    if (ids.length === 0 && flags.refresh === true && lock !== null) {
      ids = lock.assets.filter((entry) => !entry.id.startsWith('t3:')).map((entry) => entry.id);
    }
    if (ids.length === 0) throw new UsageError('no asset id given', 'gm assets use <id...>');

    if (lock === null) {
      const family = styleFamilyIdSchema.safeParse(flags.family);
      const pov = povIdSchema.safeParse(flags.pov);
      if (!family.success || !pov.success) {
        throw new UsageError(
          'a new lock needs valid --family and --pov values',
          'gm assets use <id> --family <family> --pov <pov>',
        );
      }
      lock = { version: 1, family: family.data, pov: pov.data, assets: [] };
    }

    const vendor = flags.vendor === true;
    const allowAiGenerated = allowsAiGeneratedAssets(ctx.cwd);
    const visibility = await repoVisibility(ctx.cwd);
    const exception = typeof flags.exception === 'string' ? flags.exception.trim() : undefined;
    if (exception === '') {
      throw new UsageError('--exception needs a reason', 'gm assets use <id> --exception "intentional contrast"');
    }
    /* Repo files already vendored, so a new copy never overwrites another entry's different bytes. */
    const vendoredBytes = new Map<string, { id: string; sha256: string }>();
    for (const entry of lock.assets.filter((candidate) => candidate.source === 'vendored')) {
      for (const file of [{ path: entry.path, sha256: entry.sha256 }, ...(entry.files ?? [])]) {
        vendoredBytes.set(file.path, { id: entry.id, sha256: file.sha256 });
      }
    }
    const refusals: Refusal[] = [];
    const accepted: Array<{
      card: ResolvedCard;
      files: SourceFile[];
      existing?: LockEntry;
      familyException: boolean;
      credit: NonNullable<LockEntry['credit']>;
      destinationRoot: string | null;
    }> = [];
    for (const id of ids) {
      if (id.startsWith(`t1:${ATLAS_PACK}/subjects/`)) {
        refusals.push({
          code: 'rights',
          rule: 'unknown-id',
          id,
          detail: 'Atlas subject summaries cannot be used; choose an individual /sprites/<row> search result',
        });
        continue;
      }
      let card = byId.get(id) ?? cardById(assetsRoot, index, id);
      if (!card || card.card_type !== 'asset') {
        refusals.push({ code: 'rights', rule: 'unknown-id', id, detail: 'asset is not present in the current index' });
        continue;
      }
      if (packOf(card.id) === ATLAS_PACK && !isAtlasSpriteId(card.id)) {
        refusals.push({
          code: 'rights',
          rule: 'unknown-id',
          id,
          detail: 'Atlas subject summaries cannot be used; choose an individual /sprites/<row> search result',
        });
        continue;
      }
      if (!allowAiGenerated && card.generation?.method === 'ai') {
        refusals.push({
          code: 'rights',
          rule: 'ai-generated-disabled',
          id,
          detail: 'this game has AI-generated assets turned off',
        });
        continue;
      }
      const withoutException = refusalsForUse(card, lock, { placeholder: flags.placeholder === true, visibility });
      const cardRefusals = refusalsForUse(card, lock, {
        placeholder: flags.placeholder === true,
        exception,
        visibility,
      });
      if (vendor && card.resolved.rights.redistribution === 'in-build') {
        cardRefusals.push({
          code: 'rights',
          rule: 'no-redistribution',
          id,
          detail: 'rights allow redistribution only inside a build, so the files cannot be vendored into the repo',
        });
      }
      if (cardRefusals.length > 0) {
        refusals.push(...cardRefusals);
        continue;
      }
      const familyException = withoutException.some((item) => item.rule === 'family-mismatch');
      const existing = lock.assets.find((entry) => entry.id === id);
      const collection = card.collection === undefined ? undefined : index.collections[card.collection];
      if (!collection) {
        refusals.push({
          code: 'rights',
          rule: 'unknown-id',
          id,
          detail: 'asset collection is not present in the index',
        });
        continue;
      }
      const metadata = await creditForCard(assetsRoot, card, collection);
      if (metadata.credit === undefined) {
        refusals.push({
          code: 'rights',
          rule: 'missing-license-metadata',
          id,
          detail: metadata.detail ?? 'card and pack.json have no credit metadata',
        });
        continue;
      }
      if (flags.refresh === true && existing) {
        accepted.push({ card, files: [], existing, familyException, credit: metadata.credit, destinationRoot: null });
        continue;
      }
      const atlas = packOf(card.id) === ATLAS_PACK ? await materializeAtlasSprite(assetsRoot, card) : undefined;
      if (packOf(card.id) === ATLAS_PACK && atlas === undefined) {
        refusals.push({ code: 'rights', rule: 'missing-file', id, detail: 'Atlas row could not be materialized' });
        continue;
      }
      if (atlas) {
        card = atlas.card;
        byId.set(card.id, card);
      }
      const sources = await librarySources(assetsRoot, card, collection);
      if (sources.refusal) {
        refusals.push(sources.refusal);
        continue;
      }
      const itemDestinationRoot = vendor || atlas ? safeDestination(ctx.cwd, flags.dest as string) : null;
      if (itemDestinationRoot !== null) {
        const copies = vendorCopies(itemDestinationRoot, card, sources.files).map((copy) => ({
          path: relative(ctx.cwd, copy.destination).replaceAll(sep, '/'),
          sha256: copy.sha256,
        }));
        const clash = copies.find((copy, at) => {
          const held = vendoredBytes.get(copy.path);
          const twice = copies.findIndex((other) => other.path === copy.path) !== at;
          return twice || (held !== undefined && held.id !== id && held.sha256 !== copy.sha256);
        });
        if (clash !== undefined) {
          refusals.push({
            code: 'rights',
            rule: 'name-collision',
            id,
            detail: `${clash.path} would hold different bytes from another vendored file`,
          });
          continue;
        }
        for (const copy of copies) vendoredBytes.set(copy.path, { id, sha256: copy.sha256 });
      }
      accepted.push({
        card,
        files: sources.files,
        existing,
        familyException,
        credit: metadata.credit,
        destinationRoot: itemDestinationRoot,
      });
    }

    if (refusals.length > 0 && flags.partial !== true) {
      refusals.forEach((item) => ctx.err(refusalLine(item)));
      ctx.emit('assets.use', { ids, refused: refusals.length });
      return EXIT.usage;
    }

    for (const item of accepted) {
      let located: Pick<LockEntry, 'path' | 'sha256' | 'source' | 'files'>;
      if (item.files.length === 0) {
        const { path, sha256, source, files } = item.existing!;
        located = {
          path,
          sha256,
          ...(source === undefined ? {} : { source }),
          ...(files === undefined ? {} : { files }),
        };
      } else {
        const placed =
          item.destinationRoot === null
            ? item.files.map((file) => ({ path: file.path, sha256: file.sha256 }))
            : await vendorFiles(ctx.cwd, vendorCopies(item.destinationRoot, item.card, item.files));
        const [primary, ...companions] = placed;
        located = {
          path: primary!.path,
          sha256: primary!.sha256,
          source: item.destinationRoot === null ? 'library' : 'vendored',
          ...(companions.length === 0 ? {} : { files: companions }),
        };
      }
      const meta = metadataFor(item.card);
      const pack = packOf(item.card.id);
      const set = pack === undefined ? undefined : setFor(pack)?.id;
      lock = upsertLock(lock, {
        id: item.card.id,
        ...located,
        license: item.card.resolved.license,
        rights: rightsForCard(item.card, index.collections),
        credit: item.credit,
        ...(meta === undefined ? {} : { meta }),
        ...(set === undefined ? {} : { set }),
        added: item.existing?.added ?? new Date().toISOString().slice(0, 10),
      });
      if (item.familyException) {
        ctx.emit('assets.family_exception', { id: item.card.id, reason: exception });
      }
    }
    if (accepted.length > 0) {
      await writeLock(ctx.cwd, lock);
      await writeGeneratedText(join(ctx.cwd, 'CREDITS.md'), renderCredits(lock));
      await removeReplacedCopies(ctx.cwd, lock, accepted, byId);
    }
    refusals.forEach((item) => ctx.err(refusalLine(item)));
    ctx.emit('assets.use', { ids, refused: refusals.length });
    return refusals.length > 0 ? EXIT.usage : EXIT.ok;
  },
};
