import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, library, tempDir } from './helpers.js';

const ORC = 't1:kenney-mini-dungeon/character-orc@2.0';
const DRUMS = 't1:sidetrax-pack-60-battle/war-drums@v1';

/** A game repo whose lockfile records `family`, plus an events file. */
function game(
  family: string,
  assets: { id: string }[] = [],
): { cwd: string; env: Record<string, string>; events: string } {
  const cwd = tempDir('gm-game-');
  writeFileSync(join(cwd, 'assets.lock.json'), JSON.stringify({ version: 1, family, pov: 'topdown', assets }));
  const events = join(cwd, 'events.jsonl');
  const root = library();
  addCollection(root, 'kenney-tiny-dungeon');
  return { cwd, env: { OGM_ASSETS_ROOT: root, GM_EVENTS_FILE: events }, events };
}

const eventsIn = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { event: string; payload: Record<string, unknown> });

const rows = (out: string[]) => out.map((line) => line.split('  ')[0]);

/** Give each synthetic sprite a real collection so rights can be inherited safely. */
function addCollection(root: string, pack: string): void {
  const collection = JSON.parse(
    readFileSync(join(root, 'packs', 'kenney-mini-dungeon', 'collection.card.json'), 'utf8'),
  ) as Record<string, unknown>;
  const directory = join(root, 'packs', pack);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'collection.card.json'), JSON.stringify({ ...collection, id: `t1:${pack}@1.0` }));
}

function addSmallScaleCard(root: string, pack: string, title: string, action?: string): string {
  type FixtureCard = {
    describe: Record<string, unknown>;
    source: { files: Array<Record<string, unknown>>; [key: string]: unknown };
    sprite: Record<string, unknown>;
    [key: string]: unknown;
  };
  const fixture = JSON.parse(
    readFileSync(join(root, 'packs', 'kenney-tiny-dungeon', 'cards', 'tiles', 'tile-0097.card.json'), 'utf8'),
  ) as FixtureCard;
  addCollection(root, pack);
  const id = `t1:${pack}/characters/${title.toLowerCase().replaceAll(' ', '-')}@1.0`;
  const card = {
    ...fixture,
    id,
    title,
    collection: `t1:${pack}@1.0`,
    describe: {
      ...fixture.describe,
      description: 'Vendor sprite character action sheet.',
      objects: ['sprite'],
      style_family: 'isometric-2d',
      set: 'smallscaleint',
    },
    source: { ...fixture.source, files: [{ ...fixture.source.files[0], path: `Sprites/${title}.png` }] },
    sprite: { ...fixture.sprite, ...(action ? { animations: [{ name: action, frames: [0, 1] }] } : {}) },
  };
  const path = join(
    root,
    'packs',
    pack,
    'cards',
    'characters',
    `${title.toLowerCase().replaceAll(' ', '-')}.card.json`,
  );
  mkdirSync(join(root, 'packs', pack, 'cards', 'characters'), { recursive: true });
  writeFileSync(path, JSON.stringify(card));
  rmSync(join(root, 'index', 'cards.index.json'), { force: true });
  return id;
}

describe('gm assets search in a game repo (R55 family default)', () => {
  it("hides another family's cards, keeps style-neutral ones, and logs nothing", async () => {
    const { cwd, env, events } = game('pixel-art');
    const orc = await gm(['assets', 'search', 'orc'], { cwd, env });
    expect(orc.code).toBe(0);
    expect(orc.out).toEqual([]);
    const drums = await gm(['assets', 'search', 'drums', '--use', 'vision-input'], { cwd, env });
    expect(rows(drums.out)).toContain(DRUMS);
    expect(eventsIn(events).map((line) => line.event)).toEqual(['assets.search', 'assets.search']);
  });

  it('--any-family --reason lifts the filter and writes one assets.family_exception with the reason', async () => {
    const { cwd, env, events } = game('pixel-art');
    const result = await gm(['assets', 'search', 'orc', '--any-family', '--reason', 'x'], { cwd, env });
    expect(rows(result.out)[0]).toBe(ORC);
    const exceptions = eventsIn(events).filter((line) => line.event === 'assets.family_exception');
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].payload).toEqual({ family: 'pixel-art', reason: 'x', query: 'orc' });
  });

  it('searches every pack in a locked set by default, but not a different set in the same family', async () => {
    const pixelPlatformer = game('pixel-art', [{ id: 't1:kenney-pixel-platformer/tiles@1.0' }]);
    const outside = await gm(['assets', 'search', 'knight'], pixelPlatformer);
    expect(rows(outside.out)).not.toContain('t1:kenney-tiny-dungeon/tiles/tile-0097@1.0');

    const tinyTown = game('pixel-art', [{ id: 't1:kenney-tiny-town/tiles@1.0' }]);
    const sibling = await gm(['assets', 'search', 'knight'], tinyTown);
    expect(rows(sibling.out)).toContain('t1:kenney-tiny-dungeon/tiles/tile-0097@1.0');
  });

  it('finds SmallScaleInt actions without a lock and sibling packs with the set lock', async () => {
    const root = library();
    const knight = addSmallScaleCard(root, 'smallscaleint-2d-character-knight', '1Knight', 'attack');
    const zombie = addSmallScaleCard(root, 'smallscaleint-2d-hd-zombie-pack-1', 'Zombie');
    const cwd = tempDir('gm-smallscaleint-');
    const events = join(cwd, 'events.jsonl');
    const env = { OGM_ASSETS_ROOT: root, GM_EVENTS_FILE: events };

    expect(rows((await gm(['assets', 'search', 'knight', 'attack'], { cwd, env })).out)).toContain(knight);
    expect(rows((await gm(['assets', 'search', 'knight', '--set', 'smallscaleint'], { cwd, env })).out)).toContain(
      knight,
    );
    expect(rows((await gm(['assets', 'search', 'knight', '--set', 'kenney-tiny'], { cwd, env })).out)).not.toContain(
      knight,
    );
    expect(rows((await gm(['assets', 'search', 'zombie'], { cwd, env })).out)).toContain(zombie);

    writeFileSync(
      join(cwd, 'assets.lock.json'),
      JSON.stringify({ version: 1, family: 'isometric-2d', assets: [{ id: knight }] }),
    );
    expect(rows((await gm(['assets', 'search', 'zombie'], { cwd, env })).out)).toContain(zombie);
    expect(rows((await gm(['assets', 'search', 'knight', '--set', 'smallscaleint'], { cwd, env })).out)).toContain(
      knight,
    );
  });

  it("does not let an asset from another family's set narrow the game's default search", async () => {
    const chunkyGame = game('chunky-low-poly', [{ id: 't1:kenney-tiny-town/tiles@1.0' }]);
    const result = await gm(['assets', 'search', 'orc'], chunkyGame);
    expect(rows(result.out)[0]).toBe(ORC);
  });

  it('refuses --any-family without a reason', async () => {
    const { cwd, env } = game('pixel-art');
    const result = await gm(['assets', 'search', 'orc', '--any-family'], { cwd, env });
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('--reason');
  });

  it('--family of another family is a lineup that needs a logged reason; the game family itself needs none', async () => {
    const { cwd, env, events } = game('pixel-art');
    const refused = await gm(['assets', 'search', 'orc', '--family', 'chunky-low-poly'], { cwd, env });
    expect(refused.code).toBe(2);
    expect(refused.err[0]).toContain('--reason');

    const lineup = await gm(['assets', 'search', 'orc', '--family', 'chunky-low-poly', '--reason', 'lineup'], {
      cwd,
      env,
    });
    expect(rows(lineup.out)[0]).toBe(ORC);
    const same = await gm(['assets', 'search', 'tile', '--family', 'pixel-art'], { cwd, env });
    expect(same.code).toBe(0);
    const exceptions = eventsIn(events).filter((line) => line.event === 'assets.family_exception');
    expect(exceptions.map((line) => line.payload)).toEqual([{ family: 'pixel-art', reason: 'lineup', query: 'orc' }]);
  });

  it('refuses a lockfile that is not JSON or has no family instead of searching every family', async () => {
    const { cwd, env } = game('pixel-art');
    writeFileSync(join(cwd, 'assets.lock.json'), JSON.stringify({ version: 1, pov: 'topdown', assets: [] }));
    const missing = await gm(['assets', 'search', 'orc'], { cwd, env });
    expect(missing.code).toBe(2);
    expect(missing.err[0]).toContain('no style family');
    writeFileSync(join(cwd, 'assets.lock.json'), '{ not json');
    expect((await gm(['assets', 'search', 'orc'], { cwd, env })).code).toBe(2);
  });

  it('applies no default without a lockfile', async () => {
    const events = join(tempDir(), 'events.jsonl');
    const env = { OGM_ASSETS_ROOT: library(), GM_EVENTS_FILE: events };
    const result = await gm(['assets', 'search', 'orc'], { env });
    expect(rows(result.out)[0]).toBe(ORC);
    const withFlag = await gm(['assets', 'search', 'orc', '--any-family', '--reason', 'x'], { env });
    expect(rows(withFlag.out)[0]).toBe(ORC);
    expect(eventsIn(events).map((line) => line.event)).toEqual(['assets.search', 'assets.search']);
  });
});
