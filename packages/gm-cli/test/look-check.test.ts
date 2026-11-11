import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
async function look(
  root: string,
  name: string,
  broker: Broker,
  refs: string[] = [STILL, 'design/target.png'],
): Promise<string> {
  let request = '';
  writeFileSync(join(root, 'questions.md'), 'Does the still match the target?');
  const args = ['--kind', 'look', '--name', name, '--out', 'looks', '--prompt-file', 'questions.md'];
  const wait = broker === 'silent' ? '1' : '30';
  const child = spawn(
    'python3',
    ['-I', REQUEST_MOCK, ...args, ...refs.flatMap((ref) => ['--ref', ref])].concat(['--wait', wait]),
    {
      cwd: root,
      stdio: 'ignore',
    },
  );
  const exited = new Promise((resolve) => child.on('close', resolve));
  if (broker !== 'silent') {
    const requests = join(root, '.gm-mock/requests');
    let posted: string | undefined;
    while (!posted) {
      posted = existsSync(requests)
        ? readdirSync(requests).find((file) => file.startsWith(`${name}-`) && file.endsWith('.json'))
        : undefined;
      if (!posted) await sleep(20);
    }
    // The host broker consumes each request it answers and names the answer after the request id.
    request = readFileSync(join(requests, posted), 'utf8');
    rmSync(join(requests, posted));
    const id = (JSON.parse(request) as { id: string }).id;
    const done = join(root, '.gm-mock/done', `${id}.json`);
    if ('answer' in broker) {
      mkdirSync(join(root, 'looks'), { recursive: true });
      writeFileSync(join(root, 'looks', `${id}.look.md`), broker.answer);
      writeFileSync(done, JSON.stringify({ ok: true, file: `${id}.look.md` }));
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
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toMatch(
      new RegExp(
        `^fail ${STILL}: VERDICT: fail in looks/first-[0-9a-f]{8}\\.look\\.md; fix what it names, then look again\\nThe HUD covers the player\\.`,
      ),
    );
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

  // Evidence committed under review/<ticket>/ for a PR is an archive, not this run's render: an earlier ticket's still
  // there must neither replace nor fail the current one.
  it('ignores stills kept as review evidence under review/', async () => {
    const root = game();
    mkdirSync(join(root, 'review/208/stills'), { recursive: true });
    writeFileSync(join(root, 'review/208/stills/t2.png'), 'an older ticket');
    commit(root);
    await look(root, 'first', { answer: 'VERDICT: pass' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.err).toEqual([]);
    expect(result.out).toEqual(['look ok: 1 committed stills pass']);
  });

  it('ignores review/ stills in a repo that renders without committing', async () => {
    const root = game({ commitStills: false });
    mkdirSync(join(root, 'review/208'), { recursive: true });
    writeFileSync(join(root, 'review/208/t2.png'), 'an older ticket');
    await look(root, 'first', { answer: 'VERDICT: pass' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.err).toEqual([]);
    expect(result.out).toEqual(['look ok: 1 rendered stills pass']);
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

  it('does not trust an answer file that changed after its look (a later look reusing the name overwrote it)', async () => {
    const root = game();
    const request = JSON.parse(await look(root, 'first', { answer: 'VERDICT: fail' })) as { id: string };
    writeFileSync(join(root, 'looks', `${request.id}.look.md`), 'VERDICT: pass');

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err[0]).toMatch(
      new RegExp(`^missing ${STILL}: looks/${request.id}\\.look\\.md changed after the look; `),
    );
  });

  it('lets the newest look decide and fails an answer that does not end in a verdict', async () => {
    const root = game();
    await look(root, 'first', { answer: 'VERDICT: fail' });
    await look(root, 'second', {
      answer: 'VERDICT: pass\n\nCorrection: the image did not load, so I cannot judge it.',
    });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toMatch(
      new RegExp(`^fail ${STILL}: looks/second-[0-9a-f]{8}\\.look\\.md does not end in a VERDICT line\\nVERDICT: pass`),
    );
    expect(result.err[0]).toContain('Correction: the image did not load');
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
    expect(request.prompt).toContain('List the differences to fix, worst first.');
  });
});

describe('changed look checks', () => {
  it('checks ignored rendered stills even though Git cannot list them in the diff', async () => {
    const root = game({ commitStills: false });
    const base = git(root, 'rev-parse', 'HEAD').trim();
    const result = await gm(['look', 'check', '--changed', base, '--json'], { cwd: root });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out[0]!).stills[0].path).toBe(STILL);
  });

  it('does not accept an old sheet when its approved target changes', async () => {
    const root = game();
    mkdirSync(join(root, 'review'), { recursive: true });
    mkdirSync(join(root, 'look'), { recursive: true });
    writeFileSync(join(root, 'review/decisions.json'), '{"screens":{"play":{"target":"design/target.png"}}}');
    writeFileSync(join(root, 'look/play.sheet.png'), 'old sheet');
    commit(root);
    const base = git(root, 'rev-parse', 'HEAD').trim();
    await look(root, 'sheet', { answer: 'VERDICT: pass' }, ['look/play.sheet.png']);
    writeFileSync(join(root, 'design/target.png'), 'new target');
    commit(root);
    const result = await gm(['look', 'check', '--changed', base, '--json'], { cwd: root });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out[0]!).stills[0].detail).toContain('target changed; regenerate');
  });

  it('ignores changes made only on the base branch', async () => {
    const root = game();
    git(root, 'branch', 'base');
    git(root, 'switch', '-q', 'base');
    writeFileSync(join(root, STILL), 'base-only');
    commit(root);
    git(root, 'switch', '-q', '-');
    writeFileSync(join(root, 'ticket.txt'), 'ticket');
    commit(root);
    const result = await gm(['look', 'check', '--changed', 'base', '--json'], { cwd: root });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!).stills).toEqual([]);
    expect(JSON.parse(result.out[0]!).inherited[0].path).toBe(STILL);
  });

  it('ignores another game changing a same-named target', async () => {
    const root = game();
    mkdirSync(join(root, 'games/a/review'), { recursive: true });
    writeFileSync(join(root, 'games/a/gm.manifest.json'), '{}');
    writeFileSync(join(root, 'games/a/review/decisions.json'), '{"screens":{"play":{"target":"design/target.png"}}}');
    mkdirSync(join(root, 'games/b/design/flow/screens/target'), { recursive: true });
    commit(root);
    const base = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'games/b/design/flow/screens/target/play.png'), 'other game');
    commit(root);
    const result = await gm(['look', 'check', '--changed', base, '--json'], { cwd: join(root, 'games/a') });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!).stills).toEqual([]);
    expect(
      JSON.parse(result.out[0]!).inherited.some(
        (item: { path: string }) => item.path === 'games/a/look/play.sheet.png',
      ),
    ).toBe(true);
  });

  it('selects only screens whose decision changed', async () => {
    const root = game();
    mkdirSync(join(root, 'review'), { recursive: true });
    const decisions = join(root, 'review/decisions.json');
    writeFileSync(
      decisions,
      JSON.stringify({ screens: { play: { target: 'design/target.png' }, title: { target: 'design/title.png' } } }),
    );
    commit(root);
    const base = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(
      decisions,
      JSON.stringify({ screens: { play: { target: 'design/new.png' }, title: { target: 'design/title.png' } } }),
    );
    commit(root);
    const result = await gm(['look', 'check', '--changed', base, '--json'], { cwd: root });
    const report = JSON.parse(result.out[0]!);
    expect(result.code).toBe(1);
    expect(report.stills.map((item: { path: string }) => item.path)).toEqual(['look/play.sheet.png']);
    expect(report.inherited.some((item: { path: string }) => item.path === 'look/title.sheet.png')).toBe(true);
  });

  it('selects changed targets and explicitly named screens', async () => {
    const root = game();
    mkdirSync(join(root, 'review'), { recursive: true });
    mkdirSync(join(root, 'design/flow/screens/target'), { recursive: true });
    writeFileSync(join(root, 'design/flow/screens/target/play.png'), 'play');
    writeFileSync(join(root, 'design/flow/screens/target/title.png'), 'title');
    writeFileSync(
      join(root, 'review/decisions.json'),
      JSON.stringify({
        screens: {
          play: { target: 'design/flow/screens/target/play.png' },
          title: { target: 'design/flow/screens/target/title.png' },
        },
      }),
    );
    commit(root);
    const base = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'design/flow/screens/target/play.png'), 'changed');
    commit(root);
    const result = await gm(['look', 'check', '--changed', base, '--json'], { cwd: root });
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out[0]!);
    expect(report.stills.map((r: { path: string }) => r.path)).toEqual(['look/play.sheet.png']);
    expect(report.inherited.some((r: { path: string }) => r.path === 'look/title.sheet.png')).toBe(true);
    const named = await gm(['look', 'check', '--changed', base, '--screen', 'title', '--json'], { cwd: root });
    expect(JSON.parse(named.out[0]!).stills.map((r: { path: string }) => r.path)).toContain('look/title.sheet.png');
  });

  it('gates changed stills and reports inherited missing answers separately', async () => {
    const root = game();
    mkdirSync(join(root, 'shots/other'), { recursive: true });
    writeFileSync(join(root, 'shots/other/t2.png'), 'old');
    commit(root);
    const base = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(root, STILL), 'new');
    commit(root);
    const missing = await gm(['look', 'check', '--changed', base, '--json'], { cwd: root });
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.out[0]!).stills.map((r: { path: string }) => r.path)).toEqual([STILL]);
    await look(root, 'changed', { answer: 'VERDICT: pass' });
    const passed = await gm(['look', 'check', '--changed', base, '--json'], { cwd: root });
    expect(passed.code).toBe(0);
    expect(JSON.parse(passed.out[0]!).inherited[0].path).toBe('shots/other/t2.png');
    expect((await gm(['look', 'check', '--all'], { cwd: root })).code).toBe(1);
  });
});

describe('gm look check with approved targets', { timeout: 60_000 }, () => {
  const SHEET = 'look/select.sheet.png';

  it('requires each target file to be recorded before accepting its judged sheet', async () => {
    const root = game();
    const target = 'design/flow/screens/target/play.png';
    mkdirSync(join(root, 'design/flow/screens/target'), { recursive: true });
    writeFileSync(join(root, target), 'approved');
    await look(root, 'still', { answer: 'VERDICT: pass' });
    const missing = await gm(['look', 'check'], { cwd: root });
    expect(missing.code).toBe(1);
    expect(missing.err.join('\n')).toContain('approved target "play" is not recorded');

    mkdirSync(join(root, 'review'));
    writeFileSync(join(root, 'review/decisions.json'), JSON.stringify({ screens: { play: { target } } }));
    mkdirSync(join(root, 'look'));
    writeFileSync(join(root, 'look/play.sheet.png'), 'sheet');
    await look(root, 'sheet', { answer: 'VERDICT: pass' }, ['look/play.sheet.png']);
    expect((await gm(['look', 'check'], { cwd: root })).code).toBe(0);
  });

  it('reports every target whose actual path is absent from the decisions', async () => {
    const root = game();
    mkdirSync(join(root, 'design/flow/screens/target'), { recursive: true });
    writeFileSync(join(root, 'design/flow/screens/target/play.png'), 'play');
    writeFileSync(join(root, 'design/flow/screens/target/title.png'), 'title');
    mkdirSync(join(root, 'review'));
    writeFileSync(join(root, 'review/decisions.json'), '{"screens":{"play":{"target":"design/target.png"}}}');
    await look(root, 'still', { answer: 'VERDICT: pass' });

    const result = await gm(['look', 'check'], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('approved target "play" is not recorded');
    expect(result.err.join('\n')).toContain('approved target "title" is not recorded');
  });

  it('does not silently skip a symlinked target', async () => {
    const root = game();
    mkdirSync(join(root, 'design/flow/screens/target'), { recursive: true });
    symlinkSync('../../../target.png', join(root, 'design/flow/screens/target/play.png'));
    await look(root, 'still', { answer: 'VERDICT: pass' });
    const result = await gm(['look', 'check'], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('approved target "play" is not recorded');
  });

  // Kevin judged Blobs against its renders on an iPad (#642): a screen with an approved target is only checked when
  // its still sits beside that target, so a look can say "this looks nothing like the render".
  function approved(): string {
    const root = game();
    mkdirSync(join(root, 'review'), { recursive: true });
    writeFileSync(join(root, 'review/decisions.json'), '{"screens":{"select":{"target":"design/target.png"}}}');
    return root;
  }

  it('fails while a screen with an approved target has no sheet, naming the command that makes one', async () => {
    const root = approved();
    await look(root, 'still', { answer: 'VERDICT: pass' });

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `missing ${SHEET}: no sheet of "select" beside its target: gm look sheet select --still <png>`,
    ]);
  });

  it('fails when the look at the sheet reads a mismatch with the target, and passes when it reads a match', async () => {
    const root = approved();
    await look(root, 'still', { answer: 'VERDICT: pass' });
    mkdirSync(join(root, 'look'));
    writeFileSync(join(root, SHEET), 'still-beside-target');
    await look(root, 'sheet', { answer: 'The board is missing; the render shows it.\n\nVERDICT: fail' }, [SHEET]);
    const mismatch = await gm(['look', 'check'], { cwd: root });
    await look(root, 'sheet-2', { answer: 'Matches the render.\n\nVERDICT: pass' }, [SHEET]);
    const match = await gm(['look', 'check'], { cwd: root });

    expect(mismatch.code).toBe(1);
    expect(mismatch.err[0]).toMatch(new RegExp(`^fail ${SHEET}: VERDICT: fail in looks/sheet-`));
    expect(mismatch.err[0]).toContain('The board is missing; the render shows it.');
    expect(match.code).toBe(0);
  });

  it('a new sheet needs a new look: an answer for the old bytes does not cover it', async () => {
    const root = approved();
    await look(root, 'still', { answer: 'VERDICT: pass' });
    mkdirSync(join(root, 'look'));
    writeFileSync(join(root, SHEET), 'old-sheet');
    await look(root, 'sheet', { answer: 'VERDICT: pass' }, [SHEET]);
    writeFileSync(join(root, SHEET), 'new-sheet');

    const result = await gm(['look', 'check'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err[0]).toMatch(new RegExp(`^missing ${SHEET}: no look answer for this version`));
  });

  it('gm look sheet takes the target from review/decisions.json and refuses a screen it does not name', async () => {
    const root = approved();
    const unknown = await gm(['look', 'sheet', 'play', '--still', STILL], { cwd: root });
    expect(unknown.code).toBe(2);
    expect(unknown.err[0]).toMatch(/no approved target for "play"/);
  });
});
