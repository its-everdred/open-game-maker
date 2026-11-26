import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('builds a publish bundle, records a version, and relays picks once', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-cli-'));
  try {
    const bin = join(root, 'bin');
    const assets = join(root, 'assets');
    const out = join(root, 'out');
    const state = join(root, 'state');
    mkdirSync(bin);
    mkdirSync(assets);
    const image = join(assets, 'sample.png');
    writeFileSync(image, 'image bytes');
    const executable = (name: string, code: string) => {
      const path = join(bin, name);
      writeFileSync(path, `#!${process.execPath}\n${code}\n`);
      chmodSync(path, 0o755);
      return path;
    };
    const command = {
      decision_id: 'dec_ab',
      version: 1,
      question: 'Which one?',
      created_at: '2026-11-26T00:00:00Z',
      ticket: { identifier: '9' },
      media: [{ locator: { kind: 'path', value: image } }],
      options: [{ id: 'yes', label: 'Yes' }],
    };
    const closed = join(root, 'closed');
    const aiur = executable(
      'aiur',
      `import { existsSync } from 'node:fs'; if(process.argv.includes('--filter')) console.log(existsSync(${JSON.stringify(closed)}) ? 'Commands captured' : 'Commands captured\\ndec_ab Needs you'); else console.log(${JSON.stringify(JSON.stringify({ data: { selected: command } }))});`,
    );
    const gh = executable('gh', `console.log(process.argv.includes('labels') ? '{"labels":[]}' : '[]');`);
    const log = join(root, 'sent');
    const fail = join(root, 'fail');
    const decide = executable(
      'decide',
      `import { appendFileSync, existsSync } from 'node:fs'; if (existsSync(${JSON.stringify(fail)})) process.exit(1); appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');`,
    );
    const message = executable(
      'message',
      `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');`,
    );
    const ffmpeg = executable(
      'ffmpeg',
      `import { copyFileSync } from 'node:fs'; const a=process.argv; copyFileSync(a[a.indexOf('-i')+1],a.at(-1));`,
    );
    const config = join(root, 'config.json');
    const inventory = join(root, 'inventory.json');
    const feed = join(root, 'rounds.jsonl');
    writeFileSync(inventory, '[]');
    writeFileSync(feed, JSON.stringify({ key: 'extra', title: 'Extra', image }));
    writeFileSync(
      config,
      JSON.stringify({
        sources: [{ key: 'core', checkout: root, repository: 'example/repo', aiur, gh, decideRepo: 'core' }],
        mediaRoots: [assets],
        feeds: { rounds: feed },
        output: out,
        state,
        artifactUrl: 'https://example.invalid/artifact',
        decide,
        message,
        ffmpeg,
        initialPublished: inventory,
      }),
    );
    const cli = resolve('src/cli.ts');
    const run = (...args: string[]) =>
      execFileSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
      });
    run('build', config);
    const bundle = JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')) as { files: Record<string, string> };
    expect(Object.keys(bundle.files)).toHaveLength(1);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('Which one?');
    run('record', config, 'version-1');
    run('build', config);
    expect(JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')).files).toEqual({});
    const picks = join(root, 'picks.json');
    const at = Date.now();
    writeFileSync(
      picks,
      JSON.stringify({
        dec_ab: { at, repo: 'core', ticket: 9, decision: 'dec_ab', choice: 'yes', label: 'Yes' },
        'pack-rounds-extra': { at, repo: 'core', ticket: 0, decision: '', choice: 'like', label: 'Like' },
      }),
    );
    writeFileSync(fail, '');
    expect(() => run('relay', config, picks)).toThrow();
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(join(state, 'relay-pending.json'), 'utf8')).toContain('dec_ab');
    rmSync(fail);
    writeFileSync(picks, '[]');
    run('relay', config, picks);
    expect(JSON.parse(readFileSync(join(state, 'relay-pending.json'), 'utf8'))).toEqual({});
    run('relay', config, picks);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(2);
    writeFileSync(closed, '');
    run('build', config);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('Which one?');
    writeFileSync(join(state, 'picks-at.json'), JSON.stringify({ dec_ab: Date.now() - 600_001 }));
    run('build', config);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).not.toContain('Which one?');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
