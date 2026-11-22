import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { resolvePython } from '../../packs/workers.js';
import { parseSceneBrief } from '../../scene/brief.js';
import { runSceneMatch } from '../../scene/run-match.js';

const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const facings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const command: GmCommand = {
  name: 'scene match',
  summary: 'search a local pack for reviewed mock regions',
  usage:
    '<mock.png> <brief.json> --pack <id> --facing <direction> --out <new.json> [--encoder clip|siglip] [--python <path>]',
  flags: {
    pack: { type: 'string', help: 'pack id to search' },
    facing: { type: 'string', help: 'sprite facing to search' },
    out: { type: 'string', help: 'new output file for the match result' },
    encoder: { type: 'string', help: 'cached local encoder: clip or siglip' },
    python: { type: 'string', help: 'local worker Python executable' },
  },
  async run(ctx, args, flags) {
    if (
      args.length !== 2 ||
      typeof flags.pack !== 'string' ||
      typeof flags.out !== 'string' ||
      typeof flags.facing !== 'string' ||
      !facings.some((facing) => facing === flags.facing) ||
      (flags.encoder !== undefined && flags.encoder !== 'clip' && flags.encoder !== 'siglip')
    )
      throw new UsageError('provide mock, brief, pack, facing and output', 'gm help scene match');
    const brief = parseSceneBrief(JSON.parse(await readFile(resolve(ctx.cwd, args[1]!), 'utf8')));
    const result = await runSceneMatch({
      python: typeof flags.python === 'string' ? resolve(ctx.cwd, flags.python) : await resolvePython(repo),
      worker: join(repo, 'scripts/py/tag/scene_match.py'),
      assetsRoot: requireAssetsRoot(ctx),
      pack: flags.pack,
      mock: resolve(ctx.cwd, args[0]!),
      crops: brief.regions.map(({ bounds: { x, y, width, height } }) => [x, y, width, height] as const),
      facing: flags.facing as (typeof facings)[number],
      encoder: flags.encoder === 'siglip' ? 'siglip' : 'clip',
    });
    const path = resolve(ctx.cwd, flags.out);
    await writeFile(path, JSON.stringify(result), { flag: 'wx' });
    ctx.out(
      JSON.stringify({
        path,
        scope: result.scope,
        examined: result.examined,
        eligible: result.eligible,
        truncated: result.truncated,
      }),
    );
    return EXIT.ok;
  },
};
