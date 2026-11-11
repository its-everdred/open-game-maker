import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { PACKAGES, pythonEnv } from '../../python-env.js';

export const command: GmCommand = {
  name: 'py setup',
  summary: 'provision the managed image Python environment before entering the offline sandbox',
  flags: { env: { type: 'string', help: 'managed environment directory' } },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError('unexpected arguments', 'gm py setup');
    if (ctx.config.sandbox)
      throw new UsageError('Python setup needs a provisioned host', 'run gm py setup outside the sandbox');
    const root = pythonEnv(ctx, flags.env);
    mkdirSync(dirname(root), { recursive: true });
    const setup = spawnSync(
      'flock',
      [
        '-x',
        `${root}.lock`,
        'sh',
        '-c',
        'root=$1; shift; if [ ! -f "$root/.ready" ]; then python3 -m venv "$root" && "$root/bin/python" -m pip install "$@" && printf "ready\\n" > "$root/.ready"; fi',
        'gm-py-setup',
        root,
        ...PACKAGES,
      ],
      { cwd: ctx.cwd, encoding: 'utf8', env: ctx.env },
    );
    if (setup.status !== 0)
      throw new CommandError(`Python environment setup failed: ${setup.stderr || setup.error?.message}`);
    ctx.out('Managed image Python ready');
    return EXIT.ok;
  },
};
