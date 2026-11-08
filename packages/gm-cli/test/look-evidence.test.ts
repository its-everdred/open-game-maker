import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { linkedEvidence } from '../src/commands/look/evidence.js';
import { gm, tempDir } from './helpers.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

/**
 * An Open-Games style monorepo: one game in games/blobs with a sheet committed under review/210/, plus a sheet left
 * in the workspace's assets-local/, the way Open-Games PR #214 linked evidence that vanished with its workspace.
 */
function monorepo(): { root: string; game: string } {
  const root = tempDir('gm-evidence-');
  const game = join(root, 'games/blobs');
  git(root, 'init', '-q');
  mkdirSync(join(game, 'review/210'), { recursive: true });
  writeFileSync(join(game, 'gm.manifest.json'), '{}');
  writeFileSync(join(game, 'review/210/sheet-phone.png'), 'sheet');
  writeFileSync(join(root, '.gitignore'), 'assets-local/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'evidence');
  mkdirSync(join(root, 'assets-local/review/blobs/208'), { recursive: true });
  writeFileSync(join(root, 'assets-local/review/blobs/208/sheet-390x844.png'), 'gone after cleanup');
  return { root, game };
}

function body(root: string, text: string): string {
  writeFileSync(join(root, 'pr-body.md'), text);
  return join(root, 'pr-body.md');
}

describe('gm look evidence', () => {
  it('passes when every linked sheet is committed, by repository or game path', async () => {
    const { root, game } = monorepo();
    const file = body(
      root,
      '- `games/blobs/review/210/sheet-phone.png`\n- ![after](review/210/sheet-phone.png)\n' +
        '- https://github.com/user-attachments/assets/x.png\n',
    );
    const result = await gm(['look', 'evidence', '--body', file], { cwd: game });
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(['evidence ok: 2 linked files committed']);
  });

  // The #214 failure: the sheet existed on disk when the PR opened, then the workspace was trashed. On-disk is not
  // enough; only bytes committed at HEAD survive cleanup.
  it('fails a PR that links a sheet only present in the workspace', async () => {
    const { root, game } = monorepo();
    const file = body(root, 'Evidence sheet: `assets-local/review/blobs/208/sheet-390x844.png`\n');
    const result = await gm(['look', 'evidence', '--body', file], { cwd: game });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('missing assets-local/review/blobs/208/sheet-390x844.png');
    expect(result.err.join('\n')).toContain('review/<ticket>/');
  });

  it('fails a sheet that exists on disk in the game folder but was never committed', async () => {
    const { root, game } = monorepo();
    writeFileSync(join(game, 'review/210/uncommitted.png'), 'not yet added');
    const file = body(root, '`review/210/uncommitted.png`');
    const result = await gm(['look', 'evidence', '--body', file, '--json'], { cwd: game });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out.join('\n'))).toEqual({
      ok: false,
      linked: ['review/210/uncommitted.png'],
      missing: ['review/210/uncommitted.png'],
    });
  });

  it('fails absolute paths and paths that climb out of the repository', async () => {
    const { root, game } = monorepo();
    const file = body(root, '`/home/user/sheet.png` and `../../../review/210/sheet-phone.png`');
    const result = await gm(['look', 'evidence', '--body', file, '--json'], { cwd: game });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out.join('\n')).missing).toEqual([
      '/home/user/sheet.png',
      '../../../review/210/sheet-phone.png',
    ]);
  });

  // A symlink committed in place of the sheet keeps its name at HEAD but points at a workspace file that goes away.
  it('fails a committed symlink to a workspace sheet', async () => {
    const { root, game } = monorepo();
    symlinkSync(join(root, 'assets-local/review/blobs/208/sheet-390x844.png'), join(game, 'review/210/linked.png'));
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'link');
    const file = body(root, '`review/210/linked.png`');
    expect((await gm(['look', 'evidence', '--body', file], { cwd: game })).code).toBe(1);
  });

  it('requires --body', async () => {
    const { game } = monorepo();
    expect((await gm(['look', 'evidence'], { cwd: game })).code).toBe(2);
  });
});

describe('linkedEvidence', () => {
  it('reads backticked, linked and bare media paths once each, skipping URLs and directories', () => {
    expect(
      linkedEvidence(
        [
          '- `a/sheet.png`: approved render (`review/x.jpg`) · clip a/run.mp4.',
          '![s](a/sheet.png) [clip](https://example.test/c.webm) stills in `a/stills/`',
        ].join('\n'),
      ),
    ).toEqual(['a/sheet.png', 'review/x.jpg', 'a/run.mp4']);
  });

  // Each of these forms named the #214 sheet and slipped past the first version of the gate.
  it('reads <img src>, bold, quoted, table and ?raw links, decoding %-escapes', () => {
    expect(
      linkedEvidence(
        [
          '<img src="assets-local/a.png" width=300> <img src=b.png>',
          '**c.png** "e.webp" | f.jpg | ![g](g.png?raw=true) [h](h%20i.mp4#t=1)',
          'https://example.test/view?file=j.png <https://example.test/k.png>',
        ].join('\n'),
      ),
    ).toEqual(['assets-local/a.png', 'b.png', 'c.png', 'e.webp', 'f.jpg', 'g.png', 'h i.mp4']);
  });
});
