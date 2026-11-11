import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';

// Change the environment name when changing the pinned image stack, so an old installation is never mistaken for it.
const ENV_NAME = 'image-python-v1';
const PACKAGES = [
  'numpy==2.2.6',
  'Pillow==11.2.1',
  'scipy==1.15.3',
  'scikit-image==0.25.2',
  'imageio==2.38.1',
  'lazy-loader==0.6',
  'networkx==3.7',
  'packaging==26.3',
  'tifffile==2026.11.8',
];

export const command: GmCommand = {
  name: 'py',
  summary: 'run Python in the managed image-work environment',
  usage: '-- <python arguments>',
  example: 'py -- -c "import numpy, PIL, scipy, skimage"',
  flags: {},
  async run(ctx, args) {
    if (!args.length) throw new UsageError('Python arguments are required', 'gm py -- <python arguments>');
    const root = join(ctx.home ?? homedir(), '.local', 'share', 'ogm', ENV_NAME);
    const python = join(root, 'bin', 'python');
    const marker = join(root, '.ready');
    if (!existsSync(marker)) {
      mkdirSync(join(root, '..'), { recursive: true });
      // Hold a kernel lock over both steps. A killed installer leaves no ready marker and a later run retries.
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
    }
    const result = spawnSync(python, args, {
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
