import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import sharp from 'sharp';

import { UsageError } from './command.js';
import { sha256File } from './lock.js';

const nonempty = z.string().min(1);
const versioned = z.strictObject({ name: nonempty, version: nonempty });
const relativePath = nonempty.refine(
  (path) => !isAbsolute(path) && !path.includes('\\') && !path.split('/').some((part) => part === '..' || part === ''),
  'expected a relative contained path',
);
const parameterNames = [
  'yaw0',
  'sun_elev',
  'sun_az',
  'samples',
  'band_hi',
  'band_mid',
  'band_lo',
  'ramp_mid',
  'ramp_hi',
  'shape',
] as const;
const parameters = z.partialRecord(z.enum(parameterNames), z.number().finite());

/** A recipe names a built-in rig, never an executable supplied by an asset. */
export const recipeSchema = z
  .strictObject({
    schema: z.literal('ogm.sprite-recipe/1'),
    set: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-generated$/),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    // Blend files can reference unpacked textures and linked libraries, so they
    // cannot be reproduced from a single hashed input without dependency capture.
    scene: z.enum(['tile', 'rock', 'cube', 'hull']),
    seed: z.number().int().safe(),
    parameters,
    views: z.string().regex(/^[NWSE]+$/),
    input: relativePath.optional(),
    input_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    output: z.string().regex(/^(?:(?:tile|rock|cube|hull|blend)_[NWSE]|sheet)\.png$/),
    sheet: z
      .strictObject({ cell: z.union([z.literal(64), z.literal(128)]), start: z.number().int(), end: z.number().int() })
      .optional(),
    output_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pixel_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    rig_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    blender_version: nonempty,
    derived_from: z.array(nonempty),
    agent: z.strictObject({ backend: nonempty, model: nonempty, effort: nonempty }),
    skills: z.array(versioned),
    tools: z.array(versioned).min(1),
    scores: z.record(z.string(), z.number().finite()),
    ticket: z.number().int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    approved_by_creator: z.boolean(),
    ai_generated: z.boolean(),
    verdict_quote: nonempty.optional(),
    materials: z.record(z.string(), z.unknown()),
    reference_card_ids: z.array(nonempty),
    prompt: z.string().nullable(),
  })
  .superRefine((recipe, ctx) => {
    if ((recipe.scene === 'hull') !== (recipe.input !== undefined && recipe.input_sha256 !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['input'],
        message: 'hull requires an input; other scenes do not',
      });
    if (
      recipe.input &&
      ['recipe.json', 'asset.card.json', 'collection.card.json', recipe.output].some(
        (name) => recipe.input === name || recipe.input!.startsWith(`${name}/`),
      )
    )
      ctx.addIssue({ code: 'custom', path: ['input'], message: 'input conflicts with a recipe output' });
    if (recipe.sheet && (recipe.output !== 'sheet.png' || recipe.sheet.end < recipe.sheet.start))
      ctx.addIssue({ code: 'custom', path: ['sheet'], message: 'sheet requires sheet.png and an ordered frame range' });
    if (
      !recipe.sheet &&
      (!recipe.output.startsWith(`${recipe.scene}_`) || !recipe.views.includes(recipe.output.at(-5)!))
    )
      ctx.addIssue({ code: 'custom', path: ['output'], message: 'output must name a rendered view of this scene' });
    if (recipe.approved_by_creator && !recipe.verdict_quote)
      ctx.addIssue({ code: 'custom', path: ['verdict_quote'], message: 'approved assets need the creator verdict' });
    if (recipe.approved_by_creator && (Object.values(recipe.agent).includes('unknown') || recipe.skills.length === 0))
      ctx.addIssue({
        code: 'custom',
        path: ['agent'],
        message: 'approved assets need their actual agent and skill provenance',
      });
  });
export type Recipe = z.infer<typeof recipeSchema>;

export async function readRecipe(path: string): Promise<Recipe> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new UsageError('recipe is missing or invalid JSON', 'gm help sprite-forge rerun');
  }
  const result = recipeSchema.safeParse(input);
  if (!result.success)
    throw new UsageError(
      `invalid recipe: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      'gm help sprite-forge rerun',
    );
  return result.data;
}

export async function containedFile(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  if (!target.startsWith(`${base}${sep}`) || !(await stat(target)).isFile())
    throw new Error(`file escapes recipe directory: ${path}`);
  return target;
}

export const sha256 = sha256File;

export async function pixelSha256(path: string): Promise<string> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return createHash('sha256').update(`${info.width}x${info.height}:`).update(data).digest('hex');
}

/** Assemble the rig's 15-frame, eight-direction PNGs using the forge's alpha finishing rules. */
export async function assembleSheet(directory: string, cell: number): Promise<void> {
  const width = 15 * cell;
  const height = 8 * cell;
  const sheet = Buffer.alloc(width * height * 4);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 15; column += 1) {
      const { data, info } = await sharp(join(directory, `frame_${row}_${column}.png`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.width !== cell || info.height !== cell) throw new Error('rendered frame dimensions do not match recipe');
      for (let y = 0; y < cell; y += 1)
        for (let x = 0; x < cell; x += 1) {
          const source = (y * cell + x) * 4;
          const target = ((row * cell + y) * width + column * cell + x) * 4;
          const alpha = data[source + 3]!;
          const max = Math.max(data[source]!, data[source + 1]!, data[source + 2]!);
          if (alpha === 255 || (alpha >= 128 && max > 8)) {
            data.copy(sheet, target, source, source + 3);
            sheet[target + 3] = 255;
          } else if (alpha === 0) data.copy(sheet, target, source, source + 4);
          else if (max <= 8) sheet[target + 3] = alpha;
        }
    }
  }
  await sharp(sheet, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(join(directory, 'sheet.png'));
}

const exec = promisify(execFile);
/** Render using the versioned built-in rig and atomically install a fresh output directory. */
export async function renderRecipe(
  recipe: Recipe,
  recipeDir: string,
  rig: string,
  destination: string,
  verifyPixels: boolean,
  inheritedEnv: Record<string, string | undefined>,
): Promise<void> {
  if ((await sha256(rig)) !== recipe.rig_sha256) throw new Error('installed sprite rig differs from the recipe');
  const version = (await exec('blender', ['--version'], { timeout: 15_000, env: inheritedEnv })).stdout
    .split('\n')[0]
    ?.trim();
  if (version !== recipe.blender_version) throw new Error(`Blender version differs from recipe: ${version}`);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const stage = join(parent, `.sprite-forge-${randomUUID()}`);
  await mkdir(stage);
  try {
    const env = { ...inheritedEnv };
    if (recipe.input) {
      const source = await containedFile(recipeDir, recipe.input);
      if ((await sha256(source)) !== recipe.input_sha256) throw new Error('recipe input hash does not match');
      const target = join(stage, recipe.input);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      if ((await sha256(target)) !== recipe.input_sha256) throw new Error('recipe input changed during copying');
      env.SPRITE_OBJ = target;
    }
    const args = Object.entries(recipe.parameters).map(([key, value]) => `${key}=${value}`);
    if (recipe.sheet)
      args.push(
        'sheet=1',
        `cell=${recipe.sheet.cell}`,
        `frame_start=${recipe.sheet.start}`,
        `frame_end=${recipe.sheet.end}`,
      );
    await exec(
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
        recipe.scene,
        stage,
        `seed=${recipe.seed}`,
        `views=${recipe.views}`,
        ...args,
      ],
      { env, maxBuffer: 4 * 1024 * 1024, timeout: 300_000 },
    );
    if (recipe.sheet) {
      await assembleSheet(stage, recipe.sheet.cell);
      for (let row = 0; row < 8; row += 1)
        for (let column = 0; column < 15; column += 1) await rm(join(stage, `frame_${row}_${column}.png`));
    }
    const outputHash = await sha256(join(stage, recipe.output));
    const pixelHash = await pixelSha256(join(stage, recipe.output));
    if (verifyPixels && pixelHash !== recipe.pixel_sha256)
      throw new Error('rerendered pixels differ from the recorded output');
    await writeFile(
      join(stage, 'recipe.json'),
      `${JSON.stringify({ ...recipe, output_sha256: outputHash, pixel_sha256: pixelHash }, null, 2)}\n`,
    );
    // mkdir is exclusive: do not overwrite a previous run, even on concurrent requests.
    await mkdir(destination);
    try {
      const { cp } = await import('node:fs/promises');
      await cp(stage, destination, { recursive: true, errorOnExist: true });
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export function variation(value: unknown, recipe: Recipe): Recipe[] {
  if (value === undefined) return [recipe];
  if (typeof value !== 'string')
    throw new UsageError('invalid variation', 'gm sprite-forge rerun <recipe> --vary shape=1:3:3');
  const match = /^([a-z_]+)=(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):(\d+)$/.exec(value);
  const key = match?.[1];
  const count = Number(match?.[4]);
  if (
    !key ||
    !parameterNames.includes(key as (typeof parameterNames)[number]) ||
    !(key in recipe.parameters) ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 100
  )
    throw new UsageError(
      'variation needs an existing parameter and 2–100 siblings',
      'gm sprite-forge rerun <recipe> --vary shape=1:3:3',
    );
  const min = Number(match![2]);
  const max = Number(match![3]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
    throw new UsageError('invalid variation range', 'gm sprite-forge rerun <recipe> --vary shape=1:3:3');
  return Array.from({ length: count }, (_, index) => ({
    ...recipe,
    slug: `${recipe.slug}-v${index + 1}`,
    agent: { backend: 'unknown', model: 'unknown', effort: 'unknown' },
    skills: [],
    created_at: new Date().toISOString(),
    approved_by_creator: false,
    verdict_quote: undefined,
    scores: {},
    parameters: { ...recipe.parameters, [key]: min + ((max - min) * index) / (count - 1) },
  }));
}
