import { randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { validateCard } from '@ogm/contracts';
import { buildIndex, resolve as resolveCard } from '@ogm/asset-cards';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';
import { creditForCard } from '../../license-metadata.js';
import { intersectLockRights, rightsForCard } from '../../rules.js';
import { containedFile, pixelSha256, readRecipe, sha256 } from '../../sprite-forge.js';

async function cardTemplate(path: string) {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new UsageError(`missing or invalid card template ${path}`, 'gm help sprite-forge promote');
  }
  const parsed = validateCard(value);
  if (!parsed.ok)
    throw new UsageError(`invalid card template: ${parsed.errors.join('; ')}`, 'gm help sprite-forge promote');
  return parsed.card;
}

export const command: GmCommand = {
  name: 'sprite-forge promote',
  summary: 'promote an approved, recorded sprite into a shared generated set',
  usage: '<round-directory>',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('provide one round directory', 'gm help sprite-forge promote');
    const round = resolve(ctx.cwd, args[0]!);
    const recipe = await readRecipe(join(round, 'recipe.json'));
    if (!recipe.approved_by_creator || !recipe.verdict_quote)
      throw new UsageError('round has no creator approval', 'record the creator verdict in recipe.json');
    const [collection, template] = await Promise.all([
      cardTemplate(join(round, 'collection.card.json')),
      cardTemplate(join(round, 'asset.card.json')),
    ]);
    const collectionId = `t1:${recipe.set}@${recipe.version}`;
    const assetId = `t1:${recipe.set}/${recipe.slug}@${recipe.version}`;
    if (
      collection.card_type !== 'collection' ||
      collection.status === 'quarantined' ||
      collection.status === 'rejected' ||
      collection.id !== collectionId ||
      template.card_type !== 'asset' ||
      template.status === 'quarantined' ||
      template.status === 'rejected' ||
      template.id !== assetId ||
      template.collection !== collectionId ||
      template.kind !== 'sprite'
    )
      throw new UsageError('card IDs, collection or kind do not match the recipe', 'gm help sprite-forge promote');
    if (collection.collection_info?.pack_manifest)
      throw new UsageError('generated collection cannot point at a pack manifest', 'gm help sprite-forge promote');
    const root = requireAssetsRoot(ctx);
    // Rights and AI markers must reflect current cards even when an index cache is stale.
    const index = await buildIndex(root);
    const sourceIds = [...new Set([...recipe.derived_from, ...recipe.reference_card_ids])];
    const sourceRights = [];
    const sourceCredits = [];
    let sourceAi = false;
    for (const id of sourceIds) {
      const source = index.cards.find((item) => item.id === id && item.card_type === 'asset');
      if (!source || source.status === 'quarantined' || source.status === 'rejected')
        throw new UsageError(`unknown or unavailable source asset ${id}`, 'gm assets why <id>');
      const parent = source.collection ? index.collections[source.collection] : undefined;
      if (!parent || parent.status === 'quarantined' || parent.status === 'rejected')
        throw new UsageError(`source asset ${id} has no usable collection`, 'gm assets why <id>');
      const credit = await creditForCard(root, source, parent);
      if (!credit.credit)
        throw new UsageError(`${id} ${credit.detail ?? 'has no credit metadata'}`, 'gm assets why <id>');
      sourceCredits.push(credit.credit);
      sourceRights.push(rightsForCard(source, index.collections));
      sourceAi ||= source.generation?.method === 'ai';
      if ((template.license ?? collection.license) !== source.resolved.license)
        throw new UsageError(
          `output license does not match source ${id}`,
          'use the source license for the generated collection',
        );
    }
    const outputCard = resolveCard(template, { [collection.id]: collection });
    const outputRights = rightsForCard(outputCard, { [collection.id]: resolveCard(collection, {}) });
    const allowed = intersectLockRights(sourceRights);
    if (allowed.redistribution === 'none')
      throw new UsageError('source rights prohibit redistribution', 'gm assets why <source-id>');
    if (
      outputRights.uses.some((use) => !allowed.uses.includes(use)) ||
      (outputRights.audience === 'public' && allowed.audience === 'private') ||
      ['none', 'in-build', 'free'].indexOf(outputRights.redistribution) >
        ['none', 'in-build', 'free'].indexOf(allowed.redistribution) ||
      (allowed.attribution !== null && !(outputRights.attribution ?? '').includes(allowed.attribution))
    )
      throw new UsageError(
        'output rights exceed source rights or omit source attribution',
        'restrict the generated card rights',
      );
    const outputCredit = await creditForCard(root, outputCard, resolveCard(collection, {}));
    if (
      !outputCredit.credit ||
      sourceCredits.some(
        (credit) =>
          credit.attribution !== 'none required' && !outputCredit.credit!.attribution.includes(credit.attribution),
      )
    )
      throw new UsageError(
        'output credit is missing source attribution or license metadata',
        'record source credits on the collection',
      );
    if (
      (sourceAi || template.generation?.method === 'ai' || collection.generation?.method === 'ai') &&
      !recipe.ai_generated
    )
      throw new UsageError('recipe cannot discard an AI-generated source marker', 'set ai_generated to true');
    const output = await containedFile(round, recipe.output);
    const input = recipe.input ? await containedFile(round, recipe.input) : undefined;
    if (input && (await sha256(input)) !== recipe.input_sha256) throw new Error('recipe input hash does not match');
    const hash = await sha256(output);
    if (hash !== recipe.output_sha256) throw new Error('sprite output hash does not match the recipe');
    if ((await pixelSha256(output)) !== recipe.pixel_sha256)
      throw new Error('sprite pixel hash does not match the recipe');
    const bytes = (await stat(output)).size;
    const filePath = `${recipe.slug}/${recipe.output}`;
    const generated = {
      made_by: 'ogm' as const,
      method: '3d-render' as const,
      derived_from: recipe.derived_from,
      agent: recipe.agent,
      skills: recipe.skills,
      tools: recipe.tools,
      recipe: { path: `${recipe.slug}/recipe.json`, seed: recipe.seed, parameters: recipe.parameters },
      scores: recipe.scores,
      ticket: recipe.ticket,
      created_at: recipe.created_at,
      approved_by_creator: true,
      verdict_quote: recipe.verdict_quote,
    };
    const baseCard = { ...template };
    delete baseCard.generation;
    delete baseCard.previews;
    const card = {
      ...baseCard,
      previews: {},
      source: {
        files: [{ path: filePath, sha256: `sha256:${hash}`, bytes, format: 'png', role: 'primary' }],
        content_hash: `sha256:${hash}`,
      },
      generated,
      ...(recipe.ai_generated ? { generation: { method: 'ai' as const, tool: recipe.agent.backend } } : {}),
    };
    const parsed = validateCard(card);
    if (!parsed.ok)
      throw new UsageError(`invalid promoted card: ${parsed.errors.join('; ')}`, 'gm help sprite-forge promote');
    const sets = join(root, 'sets');
    await mkdir(sets, { recursive: true });
    const realSets = await realpath(sets);
    if (realSets !== join(await realpath(root), 'sets')) throw new Error('sets directory escapes the library');
    const setDir = join(realSets, recipe.set);
    await mkdir(setDir, { recursive: true });
    if ((await realpath(setDir)) !== setDir) throw new Error('generated set is a symbolic link');
    const collectionPath = join(setDir, 'collection.card.json');
    const collectionText = `${JSON.stringify(collection, null, 2)}\n`;
    try {
      await writeFile(collectionPath, collectionText, { flag: 'wx' });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        (await readFile(collectionPath, 'utf8')) !== collectionText
      )
        throw new Error('generated collection already exists with different metadata', { cause: error });
    }
    const extracted = join(setDir, recipe.version, 'extracted');
    const cards = join(setDir, 'cards');
    await mkdir(extracted, { recursive: true });
    await mkdir(cards, { recursive: true });
    const realSet = await realpath(setDir);
    for (const directory of [extracted, cards]) {
      if ((await realpath(directory)) !== directory || !directory.startsWith(`${realSet}${sep}`))
        throw new Error('generated asset directory escapes its set');
    }
    const destination = join(extracted, recipe.slug);
    const stagedCard = join(cards, `.sprite-forge-${randomUUID()}.tmp`);
    await mkdir(destination); // exclusive; never replace an existing asset
    try {
      await copyFile(output, join(destination, recipe.output));
      if ((await sha256(join(destination, recipe.output))) !== hash) throw new Error('sprite changed during promotion');
      await writeFile(join(destination, 'recipe.json'), `${JSON.stringify(recipe, null, 2)}\n`, { flag: 'wx' });
      await writeFile(join(destination, 'collection.card.json'), collectionText, { flag: 'wx' });
      await writeFile(join(destination, 'asset.card.json'), `${JSON.stringify(parsed.card, null, 2)}\n`, {
        flag: 'wx',
      });
      if (input && recipe.input) {
        const target = join(destination, recipe.input);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(input, target);
        if ((await sha256(target)) !== recipe.input_sha256) throw new Error('recipe input changed during promotion');
      }
      await writeFile(stagedCard, `${JSON.stringify(parsed.card, null, 2)}\n`, {
        flag: 'wx',
      });
      await link(stagedCard, join(cards, `${recipe.slug}.card.json`));
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(stagedCard, { force: true });
    }
    if (ctx.json) printJson(ctx, { id: assetId });
    else ctx.out(assetId);
    return EXIT.ok;
  },
};
