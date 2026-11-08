import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
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

/** A game repo with one still and its target mock; `commitStills: false` is an instance repo that ignores `*.png`. */
function game({ stillBytes = 'frame-a', commitStills = true } = {}): string {
  const root = tempDir('gm-look-');
  git(root, 'init', '-q');
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  if (!commitStills) writeFileSync(join(root, '.gitignore'), '*.png\n');
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

type Broker = { answer: string } | { error: string } | 'silent';

/**
 * Runs gm-image-mock's real look request and answers it the way the host broker does (once the request file
 * lands), so the test exercises the log format `request-mock.py` writes and `gm look check` reads.
 */
async function look(root: string, name: string, broker: Broker): Promise<string> {
  let request = '';
  writeFileSync(join(root, 'questions.md'), 'Does the still match the target?');
  const args = ['--kind', 'look', '--name', name, '--out', 'looks', '--prompt-file', 'questions.md'];
  const wait = broker === 'silent' ? '1' : '30';
  const child = spawn(
    'python3',
    ['-I', REQUEST_MOCK, ...args, '--ref', STILL, '--ref', 'design/target.png'].concat(['--wait', wait]),
    {
      cwd: root,
      stdio: 'ignore',
    },
  );
  const exited = new Promise((resolve) => child.on('close', resolve));
  if (broker !== 'silent') {
    const posted = join(root, '.gm-mock/requests', `${name}.json`);
    while (!existsSync(posted)) await sleep(20);
    // The host broker consumes each request it answers.
    request = readFileSync(posted, 'utf8');
    rmSync(posted);
    const done = join(root, '.gm-mock/done', `${name}.json`);
    if ('answer' in broker) {
      mkdirSync(join(root, 'looks'), { recursive: true });
      writeFileSync(join(root, 'looks', `${name}.look.md`), broker.answer);
      writeFileSync(done, JSON.stringify({ ok: true, file: `${name}.look.md` }));
    } else writeFileSync(done, JSON.stringify({ ok: false, error: broker.error }));
  }
  await exited;
  return request;
}

describe('gm look check', { timeout: 60_000 }, () => {
  it('passes when the newest look at the committed still answers VERDICT: pass', async () => {
    const root = game();
    await look(root, 'first', { answer: 'Matches the target.\n\nVERDICT: pass\n' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.err).toEqual([]);
    expect(result.out).toEqual(['look ok: 1 committed stills pass']);
    expect(result.code).toBe(0);
  });

  it('fails a still whose look answered VERDICT: fail, so the worker cannot push past it (Blobs #117)', async () => {
    const root = game();
    await look(root, 'first', { answer: 'The HUD covers the player.\n\n**VERDICT: fail**\n' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `fail ${STILL}: VERDICT: fail in looks/first.look.md; fix what it names, then look again`,
    ]);
  });

  it('reports a broker error such as 402 as blocked, never as a pass', async () => {
    const root = game();
    await look(root, 'first', { answer: 'VERDICT: pass' });
    await look(root, 'second', { error: '402 Payment Required' });

    const result = await gm(['look', 'check', '--json'], { cwd: root });

    expect(result.code).toBe(1);
    expect(JSON.parse(result.out.join('\n'))).toEqual({
      ok: false,
      blocked: true,
      stills: [{ path: STILL, status: 'blocked', detail: 'look broker error: 402 Payment Required' }],
    });
  });

  it('reports a broker that never answers as blocked', async () => {
    const root = game();
    await look(root, 'first', 'silent');

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err[0]).toBe(`blocked ${STILL}: look broker error: no answer from the mock broker in 1s`);
  });

  it('judges the bytes at HEAD: a pass on an older render does not cover a re-rendered still', async () => {
    const root = game({ stillBytes: 'frame-a' });
    await look(root, 'first', { answer: 'VERDICT: pass' });
    writeFileSync(join(root, STILL), 'frame-b');
    commit(root);

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err[0]).toMatch(new RegExp(`^missing ${STILL}: no look answer for this version of the still; `));
  });

  it('does not reuse the last answer when a request name is reused for new bytes', async () => {
    const root = game({ stillBytes: 'frame-a' });
    await look(root, 'first', { answer: 'VERDICT: pass' });
    writeFileSync(join(root, STILL), 'frame-b');
    commit(root);
    // The broker has not answered the new bytes yet: the old pass must not be taken as their answer.
    await look(root, 'first', 'silent');

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err[0]).toBe(`blocked ${STILL}: look broker error: no answer from the mock broker in 1s`);
  });

  it('lets the newest look decide and fails an answer that does not end in a verdict', async () => {
    const root = game();
    await look(root, 'first', { answer: 'VERDICT: fail' });
    await look(root, 'second', {
      answer: 'VERDICT: pass\n\nCorrection: the image did not load, so I cannot judge it.',
    });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`fail ${STILL}: looks/second.look.md does not end in a VERDICT line`]);
  });

  it('judges rendered stills in a repo that ignores *.png, and never passes with nothing to judge', async () => {
    const root = game({ commitStills: false });
    rmSync(join(root, STILL));
    const empty = await gm(['look', 'check'], { cwd: root });
    writeFileSync(join(root, STILL), 'frame-a');
    await look(root, 'first', { answer: 'VERDICT: pass' });
    const judged = await gm(['look', 'check'], { cwd: root });

    expect(empty.code).toBe(1);
    expect(empty.err).toEqual(['no tN.png stills to judge: run gm run, then look at its stills']);
    expect(judged.out).toEqual(['look ok: 1 rendered stills pass']);
    expect(judged.code).toBe(0);
  });

  it('asks the look model for the verdict line the gate reads', async () => {
    const root = game();
    const request = JSON.parse(await look(root, 'first', { answer: 'VERDICT: pass' })) as { prompt: string };

    expect(request.prompt).toMatch(/VERDICT: pass` or `VERDICT: fail`\.$/);
  });
});
