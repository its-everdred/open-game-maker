import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { pythonEnv } from '../../python-env.js';

export const command: GmCommand = {
  name: 'py',
  summary: 'run Python in the managed image-work environment',
  usage: '-- <python arguments>',
  example: 'py -- -c "import numpy, PIL, scipy, skimage"',
  flags: { env: { type: 'string', help: 'managed environment directory' } },
  async run(ctx, args, flags) {
    if (!args.length) throw new UsageError('Python arguments are required', 'gm py -- <python arguments>');
    const root = pythonEnv(ctx, flags.env);
    if (!existsSync(join(root, '.ready')))
      throw new UsageError(
        'managed image Python is not provisioned',
        'run gm py setup on the host before starting the sandbox',
      );
    const result = spawnSync(join(root, 'bin', 'python'), args, {
      cwd: ctx.cwd,
      encoding: 'utf8',
      env: ctx.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new CommandError(`Python could not start: ${result.error.message}`);
    for (const line of result.stdout.trimEnd().split('\n')) if (line) ctx.out(line);
    for (const line of result.stderr.trimEnd().split('\n')) if (line) ctx.err(line);
    return result.status ?? EXIT.failed;
  },
};
