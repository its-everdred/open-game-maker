import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { measureGltf } from '@ogm/asset-measure';
import { effectiveRights, rightsAgree, validateCard, type AssetCard } from '@ogm/contracts';
import { resolveContainedPath } from '../../context.js';
import { exportUnityAssembly } from './export.js';
import { planUnityAssembly } from './plan.js';

async function assertUniformRights(cardsRoot: string): Promise<void> {
  for (const name of await readdir(cardsRoot)) {
    if (!name.endsWith('.card.json')) continue;
    const cardPath = join(cardsRoot, name);
    if ((await lstat(cardPath)).isSymbolicLink() || !(await resolveContainedPath(cardsRoot, cardPath)))
      throw new Error('invalid linked asset card');
    const card = JSON.parse(await readFile(cardPath, 'utf8')) as AssetCard;
    if (card.rights || card.license) throw new Error('per-asset rights need explicit assembly rights resolution');
  }
}

/** Export one explicitly selected building from an owned, uniformly licensed pack. */
export async function assemblePackBuilding(options: {
  assetsRoot: string;
  pack: string;
  source: string;
  slug: string;
  title: string;
  objectName?: string;
  pieceIds?: string[];
  binary2text?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ id: string; output: string; warnings: string[] }> {
  const { pack, slug } = options;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error('pack and assembly IDs must be kebab-case');
  if (!options.title.trim() || options.title.length > 120 || /[\p{Cc}\p{Cf}]/u.test(options.title))
    throw new Error('invalid building title');
  if (
    isAbsolute(options.source) ||
    /[\p{Cc}\p{Cf}]/u.test(options.source) ||
    options.source.split(/[\\/]/).some((part) => part === '..')
  )
    throw new Error('source must be relative to the extracted pack');
  const packRoot = join(options.assetsRoot, 'packs', pack);
  if (!(await resolveContainedPath(options.assetsRoot, packRoot)))
    throw new Error('pack directory escapes the asset library');
  const collectionPath = join(packRoot, 'collection.card.json');
  if ((await lstat(collectionPath)).isSymbolicLink() || !(await resolveContainedPath(packRoot, collectionPath)))
    throw new Error('invalid linked collection card');
  const collectionBytes = await readFile(collectionPath, 'utf8');
  const collection = JSON.parse(collectionBytes) as AssetCard;
  const match = /^t1:([^/@]+)@([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(collection.id);
  if (
    !match ||
    match[1] !== pack ||
    !['measured', 'tagged', 'reviewed'].includes(collection.status) ||
    !collection.license ||
    collection.license === 'NOASSERTION' ||
    !collection.rights?.basis?.some((entry) => entry.type === 'license' && !!entry.confirmed_by)
  ) {
    throw new Error('assembly requires a confirmed tier-1 collection with in-game rights');
  }
  const effective = effectiveRights(collection.rights.basis);
  if (!effective.uses.has('in-game') || !rightsAgree(collection.rights, effective)) {
    throw new Error('assembly requires a confirmed tier-1 collection with in-game rights');
  }
  const cardsRoot = join(packRoot, 'cards');
  if (!(await resolveContainedPath(packRoot, cardsRoot))) throw new Error('cards directory escapes the pack');
  await assertUniformRights(cardsRoot);
  const extracted = join(packRoot, match[2]!, 'extracted');
  const source = await resolveContainedPath(extracted, resolve(extracted, options.source));
  if (!source || !/\.(?:prefab|unity)$/i.test(source))
    throw new Error('source must be a Unity prefab or scene in the extracted pack');
  const warnings: string[] = ['material export preserves base color only; inspect surface shading before use'];
  if (options.objectName && options.pieceIds) throw new Error('choose either an object or scene piece IDs');
  if (source.toLowerCase().endsWith('.unity') && !options.objectName && !options.pieceIds)
    throw new Error('scene assemblies require a building object name');
  const plan = await planUnityAssembly(
    extracted,
    source,
    (warning) => warnings.push(warning),
    options.objectName,
    options.binary2text,
    options.pieceIds,
  );
  const directory = join(extracted, 'assembled');
  await mkdir(directory, { recursive: true });
  if (!(await resolveContainedPath(extracted, directory)))
    throw new Error('assembly output directory escapes the extracted pack');
  const output = join(directory, `${slug}.glb`);
  const cardPath = join(cardsRoot, `assembled-${slug}.card.json`);
  await exportUnityAssembly(plan, output, options.env);
  try {
    if ((await readFile(collectionPath, 'utf8')) !== collectionBytes)
      throw new Error('collection rights changed during assembly');
    await assertUniformRights(cardsRoot);
    const bytes = await readFile(output);
    const sha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const geometry = (await measureGltf(output)).geometry;
    const at = new Date().toISOString();
    const id = `t1:${pack}/assembled-${slug}@${match[2]}`;
    const card: AssetCard = {
      schema: 'ogm.asset-card/1.1',
      vocab: '2026-11-01',
      id,
      card_type: 'asset',
      status: 'measured',
      title: options.title,
      kind: 'model',
      subkind: 'building',
      collection: collection.id,
      source: {
        files: [
          { path: `assembled/${basename(output)}`, sha256: sha, bytes: bytes.length, format: 'glb', role: 'primary' },
        ],
        content_hash: sha,
      },
      geometry,
      describe: { description: `Assembled ${options.title}`, objects: ['building'] },
      ...(warnings.length ? { flags: ['needs-review'] } : {}),
      provenance: { '*': { by: 'code', tool: 'gm-unity-assembly@0.1', at, input: options.source } },
    };
    const valid = validateCard(card);
    if (!valid.ok) throw new Error(`invalid assembly card: ${valid.errors.join('; ')}`);
    await writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`, { flag: 'wx' });
    return { id, output, warnings };
  } catch (error) {
    await unlink(output);
    throw error;
  }
}
