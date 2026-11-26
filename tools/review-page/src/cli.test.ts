import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { renderPage } from './build.js';

it('restores media for a recent answered card on the first build', () => {
  const root = mkdtempSync(join(tmpdir(), 'review-migration-'));
  try {
    const state = join(root, 'state');
    const legacy = join(root, 'legacy');
    mkdirSync(state);
    mkdirSync(legacy);
    writeFileSync(join(legacy, 'old.jpg'), 'snapshot');
    const card = {
      key: 'old',
      repo: 'core',
      ticket: 0,
      decision: '',
      title: 'Old review',
      at: '',
      mode: 'review' as const,
      shared: [{ kind: 'img' as const, src: 'm/old.jpg' }],
      options: [],
    };
    const page = join(root, 'old.html');
    writeFileSync(page, renderPage(readFileSync(resolve('src/page.html'), 'utf8'), [card]));
    writeFileSync(join(state, 'picks-at.json'), JSON.stringify({ old: Date.now() }));
    const inventory = join(root, 'inventory.json');
    writeFileSync(inventory, '[]');
    const config = join(root, 'config.json');
    const output = join(root, 'output');
    writeFileSync(
      config,
      JSON.stringify({
        sources: [],
        mediaRoots: [legacy],
        output,
        state,
        artifactUrl: 'https://example.invalid',
        initialPublished: inventory,
        initialPage: page,
        legacyMedia: legacy,
      }),
    );
    execFileSync(process.execPath, [resolve('src/cli.ts'), 'build', config]);
    expect(readFileSync(join(output, 'm/old.jpg'), 'utf8')).toBe('snapshot');
    expect(JSON.parse(readFileSync(join(output, 'bundle.json'), 'utf8')).files['m/old.jpg']).toBe('m/old.jpg');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

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
    expect(() => run('build', config)).toThrow();
    const bundle = JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')) as { files: Record<string, string> };
    expect(Object.keys(bundle.files)).toHaveLength(1);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('Which one?');
    run('record', config, 'version-1');
    run('build', config);
    expect(JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')).files).toEqual({});
    run('record', config, 'version-2');
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
    // A legacy key-only ledger is bound to its imported historical pick,
    // then a later answer for that card can be delivered.
    writeFileSync(join(state, 'relayed.txt'), 'pack-rounds-extra\n');
    writeFileSync(join(state, 'baselines.json'), '{}');
    const oldPick = { at, repo: 'core', ticket: 0, decision: '', choice: 'like', label: 'Like' };
    writeFileSync(picks, JSON.stringify({ 'pack-rounds-extra': oldPick }));
    expect(() => run('relay', config, picks)).toThrow();
    const initialPicks = join(root, 'historical.json');
    writeFileSync(initialPicks, readFileSync(picks));
    const configData = JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;
    writeFileSync(config, JSON.stringify({ ...configData, initialPicks }));
    run('relay', config, picks);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(state, 'baselines.json'), 'utf8'))['pack-rounds-extra'].at).toBe(at);
    writeFileSync(picks, JSON.stringify({ 'pack-rounds-extra': { ...oldPick, at: at + 1 } }));
    run('relay', config, picks);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(3);
    const cardFile = join(state, 'cards.json');
    const cards = JSON.parse(readFileSync(cardFile, 'utf8')) as unknown[];
    const multi = {
      key: 'multi',
      repo: 'core',
      ticket: 0,
      decision: '',
      title: 'Multi',
      at: '',
      mode: 'multi',
      shared: [],
      options: [],
      groups: ['a', 'b'].map((id) => ({ id, label: id, media: [], options: [{ id: 'yes', label: 'Yes', media: [] }] })),
    };
    writeFileSync(cardFile, JSON.stringify([...cards, multi]));
    const partial = { at, repo: 'core', ticket: 0, decision: '', choice: { a: 'yes' }, label: 'A' };
    writeFileSync(picks, JSON.stringify({ multi: partial }));
    run('relay', config, picks);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(state, 'picks-at.json'), 'utf8')).multi).toBeUndefined();
    writeFileSync(picks, JSON.stringify({ multi: { ...partial, at: at + 2, choice: { a: 'yes', b: 'yes' } } }));
    run('relay', config, picks);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(4);
    writeFileSync(cardFile, JSON.stringify(cards));
    writeFileSync(closed, '');
    run('build', config);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('Which one?');
    run('record', config, 'version-3');
    writeFileSync(join(state, 'picks-at.json'), JSON.stringify({ dec_ab: Date.now() - 600_001 }));
    run('build', config);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).not.toContain('Which one?');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
