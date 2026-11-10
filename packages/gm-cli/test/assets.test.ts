import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, library, tempDir } from './helpers.js';

const ORC = 't1:kenney-mini-dungeon/character-orc@2.0';

describe('gm assets search', () => {
  it('prints the orc first as a contract row', async () => {
    const root = library();
    const result = await gm(['assets', 'search', 'orc'], { env: { OGM_ASSETS_ROOT: root } });
    expect(result.code).toBe(0);
    expect(result.out[0]).toBe(`${ORC}  model/character  reviewed  chunky-low-poly  Orc`);
  }, 10_000);

  it('prints one parseable resolved card per line with --json and honours --fields', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    const json = await gm(['assets', 'search', 'orc', '--json'], { env });
    const cards = json.out.map((line) => JSON.parse(line) as { id: string; resolved: { rights: { uses: string[] } } });
    expect(cards[0].id).toBe(ORC);
    expect(cards[0].resolved.rights.uses).toContain('in-game');
    const fields = await gm(['assets', 'search', 'orc', '--json', '--fields', 'id,status'], { env });
    expect(JSON.parse(fields.out[0])).toEqual({ id: ORC, status: 'reviewed' });
  });

  it('defaults to 10 rows and obeys --limit', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    const all = await gm(['assets', 'search', '--use', 'vision-input', '--include-draft'], { env });
    expect(all.out.length).toBe(10);
    expect((await gm(['assets', 'search', '--use', 'vision-input', '--limit', '2'], { env })).out).toHaveLength(2);
  });

  it('finds the library by walking up from cwd to assets-local/catalog.json', async () => {
    const project = tempDir();
    const { cpSync, mkdirSync } = await import('node:fs');
    cpSync(library(), join(project, 'assets-local'), { recursive: true });
    writeFileSync(join(project, 'assets-local', 'catalog.json'), '{"packs":[]}\n');
    mkdirSync(join(project, 'game', 'src'), { recursive: true });
    const result = await gm(['assets', 'search', 'orc'], { cwd: join(project, 'game', 'src') });
    expect(result.out[0]?.startsWith(ORC)).toBe(true);
  });

  it('exits 2 naming OGM_ASSETS_ROOT when no library can be found', async () => {
    const result = await gm(['assets', 'search', 'orc'], {
      cwd: mkdtempSync('/tmp/gm-no-assets-library-'),
      env: { OGM_ASSETS_ROOT: '' },
    });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain('OGM_ASSETS_ROOT');
    expect(result.err[0]).toContain('. Try: ');
  });

  it('appends one assets.search event to $GM_EVENTS_FILE, and nothing when it is unset', async () => {
    const root = library();
    const events = join(tempDir(), 'events.jsonl');
    await gm(['assets', 'search', 'orc'], { env: { OGM_ASSETS_ROOT: root, GM_EVENTS_FILE: events, GM_JOB: 'j_1' } });
    const lines = readFileSync(events, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'assets.search', job_id: 'j_1', payload: { args: ['orc'], hits: 2 } });
    expect(typeof lines[0].ts).toBe('string');

    await gm(['assets', 'search', 'orc'], { env: { OGM_ASSETS_ROOT: root } });
    expect(readFileSync(events, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('refuses an unknown use', async () => {
    const result = await gm(['assets', 'search', 'orc', '--use', 'anything'], { env: { OGM_ASSETS_ROOT: library() } });
    expect(result.code).toBe(2);
  });

  it('refuses a --directions count that is not a positive whole number', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    expect((await gm(['assets', 'search', 'orc', '--directions', '0'], { env })).code).toBe(2);
    expect((await gm(['assets', 'search', 'orc', '--directions', '1.5'], { env })).code).toBe(2);
  });
});

describe('gm assets facets, info, sheet, list', () => {
  it('prints facet rows and a +N more line past --limit', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    const result = await gm(['assets', 'facets', '--kind', 'model', '--limit', '1'], { env });
    expect(result.out).toContain('collection  t1:kenney-mini-dungeon@2.0  3');
    expect(result.out).toContain('collection  +1 more values  (--limit 2)');
  });

  it('finds audio by mood and genre for the style picker', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    const byMood = await gm(['assets', 'search', '--kind', 'audio', '--mood', 'tense'], { env });
    expect(byMood.code).toBe(0);
    expect(byMood.out).toEqual([
      't1:kenney-music-loops/loops/infinite-descent@1.1  audio/music/loop  tagged  any  Infinite Descent',
    ]);
    const both = await gm(['assets', 'search', '--kind', 'audio', '--mood', 'tense', '--mood', 'cheerful'], { env });
    expect(both.out).toEqual([]);
    const byGenre = await gm(['assets', 'search', '--genre', 'chiptune'], { env });
    expect(byGenre.out).toHaveLength(1);
    const counts = await gm(['assets', 'facets', '--kind', 'audio', '--include-draft'], { env });
    expect(counts.out).toContain('genre  chiptune  1');
    expect(counts.out).toContain('game_fit  menu  1');
  });

  it('refuses a mood or genre the card schema cannot hold', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    const mood = await gm(['assets', 'search', '--mood', 'happy'], { env });
    expect(mood.code).toBe(2);
    expect(mood.err[0]).toContain('unknown mood "happy"');
    expect(mood.err[0]).toContain('gm assets facets lists what the cards carry');
    const genre = await gm(['assets', 'search', '--genre', 'polka'], { env });
    expect(genre.code).toBe(2);
    expect(genre.err[0]).toContain('unknown genre "polka"');
  });

  it('prints one info row per id and exits 2 on an unknown id', async () => {
    const env = { OGM_ASSETS_ROOT: library() };
    const ok = await gm(['assets', 'info', ORC], { env });
    expect(ok.out).toEqual([
      `${ORC}  model/character  0.78x0.78x0.33m  374tris  rig:2ca4677e40f4  meta=rig,geometry  CC0-1.0  derive-layout,in-game,placeholder,style-reference,vision-input`,
    ]);
    const missing = await gm(['assets', 'info', ORC, 'nope'], { env });
    expect(missing.code).toBe(2);
    expect(missing.out).toHaveLength(1);
  });

  it('writes a PNG sheet to --out', async () => {
    const out = join(tempDir(), 'sheet.png');
    const result = await gm(['assets', 'sheet', ORC, 't1:kenney-mini-dungeon/wall@2.0', '--out', out], {
      env: { OGM_ASSETS_ROOT: library() },
    });
    expect(result.code).toBe(0);
    const png = readFileSync(out);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThan(png.readUInt32BE(20)); // IHDR width > height
  });

  it('lists a lockfile read-only and notes when there is none', async () => {
    const cwd = tempDir();
    expect(await gm(['assets', 'list'], { cwd })).toEqual({ code: 0, out: [], err: ['no assets.lock.json here'] });
    const lock = join(cwd, 'assets.lock.json');
    writeFileSync(lock, JSON.stringify({ assets: [{ id: ORC, path: 'assets/orc.glb', license: 'CC0-1.0' }] }));
    const before = readFileSync(lock, 'utf8');
    expect((await gm(['assets', 'list'], { cwd })).out).toEqual([`${ORC}  assets/orc.glb  CC0-1.0`]);
    expect(readFileSync(lock, 'utf8')).toBe(before);
    expect(existsSync(join(cwd, 'sheet.png'))).toBe(false);
  });
});
