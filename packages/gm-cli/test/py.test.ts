import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

describe('gm py', () => {
  it('runs the managed interpreter and forwards Python flags and exit status', async () => {
    const home = tempDir();
    const env = join(home, '.local/share/ogm/image-python-v1');
    mkdirSync(join(env, 'bin'), { recursive: true });
    writeFileSync(join(env, '.ready'), 'ready\n');
    const python = join(env, 'bin/python');
    writeFileSync(python, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n');
    chmodSync(python, 0o755);
    const result = await gm(['py', '--', '-c', 'print(1)'], { home });
    expect(result.code).toBe(7);
    expect(result.out).toEqual(['-c', 'print(1)']);
  });

  it('creates the environment once before using it', async () => {
    const home = tempDir();
    const bin = join(home, 'fake-bin');
    mkdirSync(bin);
    const bootstrap = join(bin, 'python3');
    writeFileSync(
      bootstrap,
      '#!/bin/sh\nmkdir -p "$3/bin"\ncat > "$3/bin/python" <<\'PY\'\n#!/bin/sh\nif [ "$1" = "-m" ]; then exit 0; fi\nprintf "ran %s\\n" "$1"\nPY\nchmod +x "$3/bin/python"\n',
    );
    chmodSync(bootstrap, 0o755);
    const env = { PATH: `${bin}:${process.env.PATH}` };
    const result = await gm(['py', '--', 'image.py'], { home, env });
    expect(result).toMatchObject({ code: 0, out: ['ran image.py'] });
    const again = await gm(['py', '--', 'another.py'], { home, env });
    expect(again).toMatchObject({ code: 0, out: ['ran another.py'] });
  });
});
