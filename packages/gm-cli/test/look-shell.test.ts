import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { gm, tempDir } from './helpers.js';
import { run } from '../src/cli.js';
import { captureScratch } from '../src/commands/look/shell.js';

const capture = vi.hoisted(() => ({ calls: [] as string[][], fail: false, timeout: false }));
vi.mock('../src/commands/capture/shell.js', async (original) => {
  const actual = await original<typeof import('../src/commands/capture/shell.js')>();
  return {
    ...actual,
    runChild: async (_cwd: string, args: string[]) => {
      capture.calls.push(args);
      if (capture.timeout) return 3;
      if (capture.fail) return 1;
      const out = args[2]!;
      for (const size of ['390x844', '844x390', '820x1180', '1180x820']) {
        for (const prefix of ['play', 'menu', 'ingame', 'edit'])
          writeFileSync(join(out, `${prefix}-${size}.png`), prefix);
        writeFileSync(join(out, `motion-${size}.mp4`), 'video');
      }
      return 0;
    },
  };
});

describe('gm look shell', () => {
  it('uses the workspace for scratch when the system temporary directory is unavailable', () => {
    const root = tempDir();
    const scratch = captureScratch(root, join(root, 'missing'));
    try {
      expect(scratch.local).toBe(true);
      expect(scratch.path.startsWith(join(root, '.gm-look-shell-'))).toBe(true);
      expect(existsSync(scratch.path)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a configured shared capture slot when scratch falls back to the workspace', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = join(root, 'missing');
    try {
      const code = await run(['look', 'shell', '--dist', 'dist', '--out', 'shots'], {
        cwd: root,
        env: { XDG_RUNTIME_DIR: join(root, 'shared') },
        out: () => {},
        err: () => {},
      });
      expect(code).toBe(0);
      expect(existsSync(join(root, 'shared/ogm-verify/slot-0.lock'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('uses workspace slots when both configured runtime and system scratch are unavailable', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    writeFileSync(join(root, 'not-a-directory'), '');
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = join(root, 'not-a-directory');
    try {
      const code = await run(['look', 'shell', '--dist', 'dist', '--out', 'shots'], {
        cwd: root,
        env: { XDG_RUNTIME_DIR: join(root, 'not-a-directory') },
        out: () => {},
        err: () => {},
      });
      expect(code).toBe(0);
      expect(existsSync(join(root, '.gm-verify-runtime/ogm-verify/slot-0.lock'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('explains a browser timeout', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    capture.timeout = true;
    try {
      const result = await gm(['look', 'shell', '--dist', 'dist', '--out', 'shots'], {
        cwd: root,
        env: { XDG_RUNTIME_DIR: root },
      });
      expect(result.code).toBe(3);
      expect(result.err.join('\n')).toContain('timed out while running the browser');
    } finally {
      capture.timeout = false;
    }
  }, 60_000);

  it('captures the requested sequence, editor and video and replaces old output', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    mkdirSync(join(root, 'shots'));
    writeFileSync(join(root, 'shots/play-390x844.png'), 'old');
    const result = await gm(
      ['look', 'shell', '--dist', 'dist', '--out', 'shots', '--tap', 'Play>Endless', '--edit', '--mp4'],
      { cwd: root, env: { XDG_RUNTIME_DIR: root } },
    );
    expect(result.code).toBe(0);
    expect(capture.calls.at(-1)?.slice(3, 6)).toEqual(['["Play","Endless"]', '1', '1']);
    expect(readFileSync(join(root, 'shots/play-390x844.png'), 'utf8')).toBe('play');
    expect(existsSync(join(root, 'shots/edit-1180x820.png'))).toBe(true);
    expect(existsSync(join(root, 'shots/motion-1180x820.mp4'))).toBe(true);
  });

  it('leaves prior stills intact when capture fails', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    mkdirSync(join(root, 'shots'));
    writeFileSync(join(root, 'shots/play-390x844.png'), 'old');
    capture.fail = true;
    try {
      const result = await gm(['look', 'shell', '--dist', 'dist', '--out', 'shots'], {
        cwd: root,
        env: { XDG_RUNTIME_DIR: root },
      });
      expect(result.code).toBe(1);
      expect(readFileSync(join(root, 'shots/play-390x844.png'), 'utf8')).toBe('old');
    } finally {
      capture.fail = false;
    }
  });

  it('writes through an explicitly selected shared-library symlink', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    mkdirSync(join(root, 'library'));
    symlinkSync(join(root, 'library'), join(root, 'assets-local'));
    const result = await gm(['look', 'shell', '--dist', 'dist', '--out', 'assets-local/review/ticket', '--json'], {
      cwd: root,
      env: { XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(0);
    expect(readFileSync(join(root, 'library/review/ticket/play-390x844.png'), 'utf8')).toBe('play');
    expect(JSON.parse(result.out.join('\n'))).toMatchObject({ files: expect.arrayContaining(['play-390x844.png']) });
  });

  it('restores earlier captures when an output path prevents publication', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    mkdirSync(join(root, 'shots/menu-1180x820.png'), { recursive: true });
    writeFileSync(join(root, 'shots/play-390x844.png'), 'old');
    const result = await gm(['look', 'shell', '--dist', 'dist', '--out', 'shots'], {
      cwd: root,
      env: { XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(1);
    expect(readFileSync(join(root, 'shots/play-390x844.png'), 'utf8')).toBe('old');
  });

  it('rejects a second capture using the same output directory', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist/design'), { recursive: true });
    writeFileSync(join(root, 'dist/index.html'), 'game');
    writeFileSync(join(root, 'dist/design/design.json'), '{}');
    mkdirSync(join(root, 'shots/.gm-shell-lock'), { recursive: true });
    const result = await gm(['look', 'shell', '--dist', 'dist', '--out', 'shots'], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('another capture owns');
  });

  it('rejects empty steps in a tap sequence', async () => {
    const result = await gm(['look', 'shell', '--dist', 'dist', '--out', 'shots', '--tap', 'Play>>Endless']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('empty tap target');
  });
});
