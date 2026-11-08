import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const REQUEST_MOCK = fileURLToPath(new URL('../../../skills/gm-image-mock/scripts/request-mock.py', import.meta.url));
const STILL = 'shots/desktop/t2.png';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

/** A game repo with one committed still (and its target mock) at HEAD. */
function game(stillBytes = 'frame-a'): string {
  const root = tempDir('gm-look-');
  git(root, 'init', '-q');
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  mkdirSync(join(root, 'shots/desktop'), { recursive: true });
  mkdirSync(join(root, 'design'), { recursive: true });
  writeFileSync(join(root, STILL), stillBytes);
  writeFileSync(join(root, 'design/target.png'), 'target');
  commit(root);
  return root;
}

function commit(root: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'stills');
}

/**
 * Runs gm-image-mock's real look request against a broker that has already answered, so the test exercises the
 * log format `request-mock.py` writes and `gm look check` reads.
 */
function look(root: string, name: string, broker: { answer: string } | { error: string }): void {
  mkdirSync(join(root, '.gm-mock/done'), { recursive: true });
  mkdirSync(join(root, 'looks'), { recursive: true });
  if ('answer' in broker) {
    writeFileSync(join(root, 'looks', `${name}.look.md`), broker.answer);
    writeFileSync(join(root, '.gm-mock/done', `${name}.json`), JSON.stringify({ ok: true, file: `${name}.look.md` }));
  } else {
    writeFileSync(join(root, '.gm-mock/done', `${name}.json`), JSON.stringify({ ok: false, error: broker.error }));
  }
  writeFileSync(join(root, 'questions.md'), 'Does the still match the target?');
  const args = ['--kind', 'look', '--name', name, '--out', 'looks', '--prompt-file', 'questions.md'];
  try {
    execFileSync(
      'python3',
      ['-I', REQUEST_MOCK, ...args, '--ref', STILL, '--ref', 'design/target.png', '--wait', '5'],
      {
        cwd: root,
        stdio: 'pipe',
      },
    );
  } catch {
    // A broker error exits non-zero; the outcome is still logged for the gate.
  }
}

describe('gm look check', () => {
  it('passes when the newest look at the committed still answers VERDICT: pass', async () => {
    const root = game();
    look(root, 'first', { answer: 'Matches the target.\n\nVERDICT: pass\n' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.err).toEqual([]);
    expect(result.out).toEqual(['look ok: 1 committed stills pass']);
    expect(result.code).toBe(0);
  });

  it('fails a still whose look answered VERDICT: fail, so the worker cannot push past it (Blobs #117)', async () => {
    const root = game();
    look(root, 'first', { answer: 'The HUD covers the player.\n\n**VERDICT: fail**\n' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`fail ${STILL}: VERDICT: fail in looks/first.look.md`]);
  });

  it('reports a broker error such as 402 as blocked, never as a pass', async () => {
    const root = game();
    look(root, 'first', { answer: 'VERDICT: pass' });
    look(root, 'second', { error: '402 Payment Required' });

    const result = await gm(['look', 'check', '--json'], { cwd: root });

    expect(result.code).toBe(1);
    expect(JSON.parse(result.out.join('\n'))).toEqual({
      ok: false,
      blocked: true,
      stills: [{ path: STILL, status: 'blocked', detail: 'look broker error: 402 Payment Required' }],
    });
  });

  it('judges the bytes at HEAD: a pass on an older render does not cover a re-rendered still', async () => {
    const root = game('frame-a');
    look(root, 'first', { answer: 'VERDICT: pass' });
    writeFileSync(join(root, STILL), 'frame-b');
    commit(root);

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`missing ${STILL}: no look answer for this version of the still`]);
  });

  it('lets the newest look decide and fails an answer with no verdict line', async () => {
    const root = game();
    look(root, 'first', { answer: 'VERDICT: fail' });
    look(root, 'second', { answer: 'Looks fine to me.' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`fail ${STILL}: no VERDICT line in looks/second.look.md`]);
  });

  it('asks the look model for the verdict line the gate reads', () => {
    const root = game();
    look(root, 'first', { answer: 'VERDICT: pass' });

    const request = execFileSync('cat', [join(root, '.gm-mock/requests/first.json')], { encoding: 'utf8' });
    expect(JSON.parse(request).prompt).toMatch(/VERDICT: pass` or `VERDICT: fail`\.$/);
  });
});
