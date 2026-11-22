import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { reportSceneFailures } from '../../scene/command-failure.js';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { identifySceneRegions } from '../../scene/identify-regions.js';

export const command: GmCommand = {
  name: 'scene identify',
  summary: 'rank local sprite matches for reviewed mock regions',
  usage: '<mock.png> <brief.json> <match.json>',
  flags: {},
  async run(ctx, args) {
    return reportSceneFailures(async () => {
      if (args.length !== 3) throw new UsageError('provide mock, brief and match files', 'gm help scene identify');
      const [mock, brief, match] = await Promise.all(args.map((path) => readFile(resolve(ctx.cwd, path))));
      const mockSha256 = createHash('sha256').update(mock!).digest('hex');
      const result = identifySceneRegions({
        brief: JSON.parse(brief!.toString()),
        match: JSON.parse(match!.toString()),
        mockSha256,
        mockSize: await sharp(mock!).metadata(),
      });
      ctx.out(JSON.stringify(result, null, 2));
      return EXIT.ok;
    });
  },
};
