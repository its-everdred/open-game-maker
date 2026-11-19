import { UsageError, type GmCommand } from '../../command.js';
import { runSelected } from './index.js';

export const command: GmCommand = {
  name: 'check static',
  summary: 'run TypeScript and deterministic simulation-source gates',
  usage: '[--json]',
  example: 'check static',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check static');
    return runSelected(ctx, { checks: ['typecheck', 'no-wall-clock-in-sim', 'image-stretch'] });
  },
};
