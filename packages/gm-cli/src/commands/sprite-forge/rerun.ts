import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { catalogRoot } from '../../skills/catalog.js';
import { readRecipe, renderRecipe, variation } from '../../sprite-forge.js';

export const command: GmCommand = {
  name: 'sprite-forge rerun',
  summary: 'rerender a sprite recipe with its pinned rig and Blender version',
  usage: '<recipe.json> [--seed N] [--vary key=min:max:count] [--out directory]',
  flags: {
    seed: { type: 'number', help: 'override the recipe seed' },
    vary: { type: 'string', help: 'vary an existing numeric parameter across an inclusive range' },
    out: { type: 'string', help: 'new output directory (default: rerun-<seed> beside recipe)' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 1) throw new UsageError('provide one recipe', 'gm help sprite-forge rerun');
    const path = resolve(ctx.cwd, args[0]!);
    let recipe = await readRecipe(path);
    const originalSeed = recipe.seed;
    if (flags.seed !== undefined) {
      if (!Number.isSafeInteger(flags.seed))
        throw new UsageError('seed must be a safe integer', 'gm help sprite-forge rerun');
      if (flags.seed !== recipe.seed && recipe.scene !== 'rock')
        throw new UsageError('this rig scene does not vary by seed', 'use --vary on a supported parameter');
      if (flags.seed !== recipe.seed)
        recipe = {
          ...recipe,
          slug: `${recipe.slug}-s${Number(flags.seed) < 0 ? `n${Math.abs(Number(flags.seed))}` : flags.seed}`,
          seed: flags.seed as number,
          approved_by_creator: false,
          verdict_quote: undefined,
          scores: {},
        };
    }
    const recipes = variation(flags.vary, recipe);
    const destination =
      typeof flags.out === 'string' ? resolve(ctx.cwd, flags.out) : join(dirname(path), `rerun-${recipe.seed}`);
    const rig = join(catalogRoot(ctx.cwd, ctx.skillsDir), 'gm-sprite-forge/scripts/blender_iso_rig.py');
    const outputs: string[] = [];
    let singleCreated = false;
    if (recipes.length > 1) {
      await mkdir(dirname(destination), { recursive: true });
      await mkdir(destination);
    }
    try {
      for (const [index, item] of recipes.entries()) {
        const output = recipes.length === 1 ? destination : join(destination, `variant-${index + 1}`);
        await renderRecipe(
          item,
          dirname(path),
          rig,
          output,
          flags.vary === undefined && item.seed === originalSeed,
          ctx.env ?? {},
        );
        singleCreated = true;
        for (const name of ['collection.card.json', 'asset.card.json']) {
          let content: string;
          try {
            content = await readFile(join(dirname(path), name), 'utf8');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
          }
          if (name === 'asset.card.json') {
            const card = JSON.parse(content) as { id: string };
            card.id = `t1:${item.set}/${item.slug}@${item.version}`;
            content = `${JSON.stringify(card, null, 2)}\n`;
          }
          await writeFile(join(output, name), content, { flag: 'wx' });
        }
        outputs.push(output);
      }
    } catch (error) {
      if (recipes.length > 1 || singleCreated) await rm(destination, { recursive: true, force: true });
      throw error;
    }
    for (const output of outputs) {
      if (ctx.json) printJson(ctx, { path: output });
      else ctx.out(output);
    }
    return EXIT.ok;
  },
};
