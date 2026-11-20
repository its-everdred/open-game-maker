import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { assembleSheet, recipeSchema, variation } from '../src/sprite-forge.js';
import { gm, library, tempDir } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const rig = join(repo, 'skills/gm-sprite-forge/scripts/blender_iso_rig.py');
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
let png: Buffer;
async function pixels(data: Buffer): Promise<string> {
  const result = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return createHash('sha256').update(`${result.info.width}x${result.info.height}:`).update(result.data).digest('hex');
}
let originalPixels = '';
beforeAll(async () => {
  png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#808080' } })
    .png()
    .toBuffer();
  originalPixels = await pixels(png);
});
const makeRecipe = () => ({
  schema: 'ogm.sprite-recipe/1',
  set: 'example-generated',
  slug: 'rock',
  version: '1',
  scene: 'rock',
  seed: 3,
  parameters: { samples: 1, shape: 1 },
  views: 'N',
  output: 'rock_N.png',
  output_sha256: hash(png),
  pixel_sha256: originalPixels,
  rig_sha256: hash(readFileSync(rig)),
  blender_version: 'Blender 4.3.2',
  derived_from: ['t1:kenney-mini-dungeon/character-orc@2.0'],
  agent: { backend: 'codex', model: 'test', effort: 'high' },
  skills: [{ name: 'gm-sprite-forge', version: '1' }],
  tools: [{ name: 'Blender', version: '4.3.2' }],
  scores: {},
  ticket: 1036,
  created_at: '2026-11-20T00:00:00Z',
  approved_by_creator: true,
  ai_generated: true,
  verdict_quote: 'Matches',
  materials: {},
  reference_card_ids: ['t1:kenney-mini-dungeon/character-orc@2.0'],
  prompt: null,
});
const json = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function round(root: string) {
  const dir = join(root, 'round');
  mkdirSync(dir);
  const recipe = makeRecipe();
  json(join(dir, 'recipe.json'), recipe);
  writeFileSync(join(dir, recipe.output), png);
  const collection = JSON.parse(
    readFileSync(join(repo, 'packages/contracts/fixtures/cards/collection-kenney-mini-dungeon.json'), 'utf8'),
  );
  collection.id = 't1:example-generated@1';
  delete collection.collection_info.pack_manifest;
  const asset = JSON.parse(
    readFileSync(join(repo, 'packages/contracts/fixtures/cards/sprite-kenney-tiny-dungeon-knight.json'), 'utf8'),
  );
  asset.id = 't1:example-generated/rock@1';
  asset.collection = collection.id;
  json(join(dir, 'collection.card.json'), collection);
  json(join(dir, 'asset.card.json'), asset);
  return dir;
}

describe('sprite forge', () => {
  it('assembles eight rows of fifteen finished frames in order', async () => {
    const dir = tempDir();
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 15; column += 1) {
        const frame = await sharp(Buffer.from([row + 20, column + 20, 40, 200]), {
          raw: { width: 1, height: 1, channels: 4 },
        })
          .png()
          .toBuffer();
        writeFileSync(join(dir, `frame_${row}_${column}.png`), frame);
      }
    }
    await assembleSheet(dir, 1);
    const sheet = await sharp(join(dir, 'sheet.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([sheet.info.width, sheet.info.height]).toEqual([15, 8]);
    expect([...sheet.data.subarray((7 * 15 + 14) * 4, (7 * 15 + 15) * 4)]).toEqual([27, 34, 40, 255]);
  });
  it('validates recipe paths, version and creator approval', () => {
    const recipe = makeRecipe();
    expect(recipeSchema.safeParse(recipe).success).toBe(true);
    expect(recipeSchema.safeParse({ ...recipe, version: '..' }).success).toBe(false);
    expect(
      recipeSchema.safeParse({ ...recipe, agent: { backend: 'unknown', model: 'unknown', effort: 'unknown' } }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...recipe, scene: 'blend', input: 'model.blend', input_sha256: 'a'.repeat(64) }).success,
    ).toBe(false);
    expect(recipeSchema.safeParse({ ...recipe, approved_by_creator: true, verdict_quote: undefined }).success).toBe(
      false,
    );
    expect(
      recipeSchema.safeParse({ ...recipe, scene: 'hull', input: '../x', input_sha256: 'a'.repeat(64) }).success,
    ).toBe(false);
  });
  it('gives ranged siblings distinct identities and clears their approval', () => {
    const recipe = recipeSchema.parse(makeRecipe());
    const variants = variation('shape=1:3:3', recipe);
    expect(variants.map((item) => [item.slug, item.parameters.shape, item.approved_by_creator])).toEqual([
      ['rock-v1', 1, false],
      ['rock-v2', 2, false],
      ['rock-v3', 3, false],
    ]);
  });
  it('promotes only an approved, unchanged round into a searchable shared set', async () => {
    const root = library();
    const dir = round(root);
    const env = { OGM_ASSETS_ROOT: root };
    const result = await gm(['sprite-forge', 'promote', dir, '--json', '--fields', 'id'], { env });
    expect(result.code, result.err.join('\n')).toBe(0);
    expect(JSON.parse(result.out[0]!)).toEqual({ id: 't1:example-generated/rock@1' });
    const card = JSON.parse(readFileSync(join(root, 'sets/example-generated/cards/rock.card.json'), 'utf8'));
    expect(card.generated).toMatchObject({
      made_by: 'ogm',
      verdict_quote: 'Matches',
      recipe: { path: 'rock/recipe.json', seed: 3 },
    });
    expect(card.generation.method).toBe('ai');
    expect(readFileSync(join(root, 'sets/example-generated/1/extracted/rock/rock_N.png'))).toEqual(png);
    const search = await gm(['assets', 'search', '--generated'], { env });
    expect(search.out.join('\n')).toContain('[Made by Game Maker]');
    const game = tempDir();
    const used = await gm(['assets', 'use', 't1:example-generated/rock@1', '--family', 'pixel-art', '--pov', 'iso'], {
      env,
      cwd: game,
    });
    expect(used.code, used.err.join('\n')).toBe(0);
    const lock = JSON.parse(readFileSync(join(game, 'assets.lock.json'), 'utf8'));
    expect(lock.assets[0].meta.generated).toMatchObject({ made_by: 'ogm', ticket: 1036 });
    await expect(gm(['sprite-forge', 'promote', dir], { env })).rejects.toThrow();
  }, 120000);
  it('refuses missing approval and modified output', async () => {
    const root = library();
    const dir = round(root);
    const recipe = makeRecipe();
    json(join(dir, 'recipe.json'), { ...recipe, approved_by_creator: false });
    expect((await gm(['sprite-forge', 'promote', dir], { env: { OGM_ASSETS_ROOT: root } })).code).not.toBe(0);
    json(join(dir, 'recipe.json'), recipe);
    writeFileSync(join(dir, recipe.output), 'changed');
    await expect(gm(['sprite-forge', 'promote', dir], { env: { OGM_ASSETS_ROOT: root } })).rejects.toThrow(
      'output hash',
    );
  });
  it('refuses missing sources and attempts to discard source AI provenance', async () => {
    const root = library();
    const dir = round(root);
    const recipe = makeRecipe();
    json(join(dir, 'recipe.json'), { ...recipe, derived_from: ['t1:missing/asset@1'], reference_card_ids: [] });
    const missing = await gm(['sprite-forge', 'promote', dir], { env: { OGM_ASSETS_ROOT: root } });
    expect(missing.code).toBe(2);
    expect(missing.err.join(' ')).toContain('unknown or unavailable source');
    const source = join(root, 'packs/kenney-mini-dungeon/cards/character-orc.card.json');
    const card = JSON.parse(readFileSync(source, 'utf8'));
    card.generation = { method: 'ai', tool: 'test' };
    json(source, card);
    json(join(dir, 'recipe.json'), { ...recipe, ai_generated: false });
    const ai = await gm(['sprite-forge', 'promote', dir], { env: { OGM_ASSETS_ROOT: root } });
    expect(ai.code).toBe(2);
    expect(ai.err.join(' ')).toContain('cannot discard an AI-generated source marker');
  }, 30000);
  it('refuses a generated collection that widens source rights', async () => {
    const root = library();
    const dir = round(root);
    const source = join(root, 'packs/kenney-mini-dungeon/collection.card.json');
    const card = JSON.parse(readFileSync(source, 'utf8'));
    card.rights.redistribution = 'none';
    card.rights.basis[0].redistribution = 'none';
    json(source, card);
    const result = await gm(['sprite-forge', 'promote', dir], { env: { OGM_ASSETS_ROOT: root } });
    expect(result.code).toBe(2);
    expect(result.err.join(' ')).toContain('source rights prohibit redistribution');
  }, 30000);
});

const blender = spawnSync('blender', ['--version'], { encoding: 'utf8', timeout: 15000 });
it.skipIf(blender.status !== 0)(
  'rerenders identical pixels with the same seed and creates an unapproved sibling',
  async () => {
    const root = tempDir();
    const original = join(root, 'original');
    mkdirSync(original);
    const recipe = { ...makeRecipe(), blender_version: blender.stdout.split('\n')[0]!.trim() };
    execFileSync(
      'blender',
      [
        '-b',
        '--factory-startup',
        '--disable-autoexec',
        '--threads',
        '2',
        '--python-exit-code',
        '1',
        '--python',
        rig,
        '--',
        'rock',
        original,
        'seed=3',
        'views=N',
        'samples=1',
        'shape=1',
      ],
      { timeout: 120000 },
    );
    recipe.output_sha256 = hash(readFileSync(join(original, recipe.output)));
    recipe.pixel_sha256 = await pixels(readFileSync(join(original, recipe.output)));
    json(join(original, 'recipe.json'), recipe);
    const env = { GM_SKILLS_DIR: join(repo, 'skills') };
    const result = await gm(['sprite-forge', 'rerun', join(original, 'recipe.json'), '--out', join(root, 'copy')], {
      env,
    });
    expect(result.code, result.err.join('\n')).toBe(0);
    expect(await pixels(readFileSync(join(root, 'copy', recipe.output)))).toBe(recipe.pixel_sha256);
    const sibling = await gm(
      ['sprite-forge', 'rerun', join(original, 'recipe.json'), '--seed', '4', '--out', join(root, 'sibling')],
      { env },
    );
    expect(sibling.code, sibling.err.join('\n')).toBe(0);
    expect(await pixels(readFileSync(join(root, 'sibling', recipe.output)))).not.toBe(recipe.pixel_sha256);
    expect(JSON.parse(readFileSync(join(root, 'sibling/recipe.json'), 'utf8'))).toMatchObject({
      seed: 4,
      approved_by_creator: false,
      agent: { backend: 'unknown', model: 'unknown', effort: 'unknown' },
      skills: [],
    });
  },
  300000,
);
