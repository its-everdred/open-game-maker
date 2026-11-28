import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import type { SceneDoc, SceneHead, SceneRevision } from '@ogm/contracts/browser';
import { commitScene, emptyScene } from '@ogm/design-log';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';
import { spritePng, type Shape } from './support/map-sprites';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

/**
 * Kevin's map maker flow (#1209): open a scene document, place, move, turn and delete pieces, paint terrain, undo,
 * save and reload. Saves go through #1207's `commitScene` as the API does, so the head the agent's `gm scene pull`
 * reads is checked too. `OGM_MAP_PROOF=<dir>` swaps in a real scene (`scene.json`: doc and sprite paths) and writes
 * stills and the saved scene files there.
 */
const proof = process.env.OGM_MAP_PROOF; // eslint-disable-line no-restricted-properties -- local proof runs only

type Fixture = { doc: SceneDoc; sprites: Record<string, Record<string, () => Buffer>> };

const SYNTHETIC: Record<string, { shape: Shape; rgb: [number, number, number] }> = {
  't3:fixture/tiles/ground-a1': { shape: 'floor', rgb: [92, 140, 70] },
  't3:fixture/tiles/ground-b1': { shape: 'floor', rgb: [150, 120, 80] },
  't3:fixture/tiles/wall-a1': { shape: 'wall', rgb: [120, 116, 130] },
  't3:fixture/tiles/stone-a1': { shape: 'decor', rgb: [150, 150, 150] },
  't3:fixture/tiles/chest-a1': { shape: 'decor', rgb: [220, 170, 60] },
};

function synthetic(): Fixture {
  const floor: Record<string, { asset: string; facing: string }> = {};
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) floor[`${x},${y}`] = { asset: 't3:fixture/tiles/ground-a1', facing: 'E' };
  const wall: Record<string, { asset: string; facing: string }> = {};
  for (let x = 0; x < 8; x++) wall[`${x},0`] = { asset: 't3:fixture/tiles/wall-a1', facing: 'E' };
  const doc: SceneDoc = {
    ...emptyScene('dusk-helm', 'goblin-cave', 'smallscaleint'),
    bounds: { width: 8, height: 8 },
    layers: {
      floor: { kind: 'tiles', order: 0, tiles: floor },
      wall: { kind: 'tiles', order: 1, tiles: wall },
      decor: { kind: 'tiles', order: 2, tiles: { '5,5': { asset: 't3:fixture/tiles/stone-a1', facing: 'E' } } },
      roof: { kind: 'tiles', order: 3, tiles: {} },
      spawns: { kind: 'objects', order: 4 },
    },
  };
  const sprites = Object.fromEntries(
    Object.entries(SYNTHETIC).map(([asset, { shape, rgb }]) => [
      asset,
      Object.fromEntries(['E', 'N', 'W', 'S'].map((facing) => [facing, () => spritePng(shape, rgb, facing)])),
    ]),
  );
  return { doc, sprites };
}

/** A real scene staged locally: `scene.json` holds `{ doc, sprites: { asset: { facings: { E: 'file.png' } } } }`. */
function staged(dir: string): Fixture {
  const scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8')) as {
    doc: SceneDoc;
    sprites: Record<string, { facings: Record<string, string> }>;
  };
  const sprites = Object.fromEntries(
    Object.entries(scene.sprites).map(([asset, { facings }]) => [
      asset,
      Object.fromEntries(
        Object.entries(facings).map(([facing, file]) => [facing, () => readFileSync(join(dir, file))]),
      ),
    ]),
  );
  return { doc: scene.doc, sprites };
}

const real = proof !== undefined && existsSync(join(proof, 'scene.json'));
const fixture = real ? staged(proof) : synthetic();
const pieces = {
  ground: real
    ? 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/ground-e1@2026-11-01'
    : 't3:fixture/tiles/ground-b1',
  chest: real
    ? 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/chest-a1@2026-11-01'
    : 't3:fixture/tiles/chest-a1',
};

/** Free cells for the chest, a rock to delete and a strip of ground to repaint, on each scene. */
const at = real
  ? {
      place: [6, 6],
      via: [7, 5],
      to: [7, 4],
      rock: [1, 6],
      strip: [
        [5, 3],
        [5, 4],
        [5, 5],
      ],
    }
  : {
      place: [2, 4],
      via: [3, 3],
      to: [4, 2],
      rock: [5, 5],
      strip: [
        [1, 2],
        [1, 3],
        [1, 4],
      ],
    };

type Store = { head: SceneHead; log: SceneRevision[] };

async function installScene(page: Page, store: Store) {
  const saves: { baseRev: number; doc: SceneDoc }[] = [];
  const sprites = Object.fromEntries(
    Object.entries(fixture.sprites).map(([asset, facings]) => [
      asset,
      {
        facings: Object.fromEntries(
          Object.keys(facings).map((facing) => [
            facing,
            `/api/v1/games/game/scenery/assets/${encodeURIComponent(asset)}/${facing}.png`,
          ]),
        ),
      },
    ]),
  );
  await page.route('**/api/v1/games/game/scenery/assets/**', (route) => {
    const [asset, file] = new URL(route.request().url()).pathname.split('/').slice(-2) as [string, string];
    const image = fixture.sprites[decodeURIComponent(asset)]?.[file.replace('.png', '')];
    return image ? route.fulfill({ contentType: 'image/png', body: image() }) : route.fulfill({ status: 404 });
  });
  await page.route('**/api/v1/games/game/editor/scenes', (route) =>
    route.fulfill({
      json: {
        scenes: [
          {
            id: 'goblin-cave',
            rev: store.head.rev,
            author: store.log.at(-1)!.author,
            updatedAt: store.log.at(-1)!.createdAt,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/games/game/editor/scenes/goblin-cave', (route) =>
    route.fulfill({ json: { rev: store.head.rev, doc: store.head.doc, author: store.log.at(-1)!.author, sprites } }),
  );
  await page.route('**/api/v1/games/game/editor/scenes/goblin-cave/revisions', (route) => {
    const body = route.request().postDataJSON() as { baseRev: number; doc: SceneDoc; label: string };
    saves.push(body);
    const result = commitScene({ ...store, ...body, author: 'kevin', source: 'editor', now: new Date() });
    if (!result.ok) return route.fulfill({ status: 409, json: { error: 'scene_conflict' } });
    if (result.revision) {
      store.head = result.head;
      store.log.push(result.revision);
    }
    return route.fulfill({ json: { rev: result.head.rev, doc: result.head.doc, saved: result.revision !== null } });
  });
  return saves;
}

/** The scene as an agent left it: revision 1, before Kevin opens it. */
function agentScene(): Store {
  const first = commitScene({
    head: { rev: 0, doc: emptyScene('dusk-helm', 'goblin-cave', 'smallscaleint') },
    log: [],
    doc: fixture.doc,
    baseRev: 0,
    author: 'agent:1208',
    source: 'cli',
    label: 'convert the goblin cave',
    now: new Date('2026-11-22T00:00:00Z'),
  });
  if (!first.ok || !first.revision) throw new Error('fixture scene');
  return { head: first.head, log: [first.revision] };
}

async function openEditor(page: Page) {
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page, undefined, 'Dusk Helm');
  await page.route('**/api/v1/me/commands**', (route) => route.fulfill({ json: { commands: [], sessions: [] } }));
  await page.route('**/api/v1/me/core-commands', (route) => route.fulfill({ json: { commands: [], targets: [] } }));
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { user: { id: 'u1' }, platformRole: 'none', capability: 'creator' } }),
  );
  await page.route('**/api/v1/me/executor/thread', (route) => route.fulfill({ status: 403, json: {} }));
  await page.route('**/api/v1/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/games/game/branches', (route) => route.fulfill({ json: { branches: [] } }));
  await page.route('**/api/v1/games', (route) => route.fulfill({ json: { games: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
}

/** Where a cell's ground diamond is centred on screen, from the canvas's view transform. */
async function cellPoint(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas[aria-label="Map"]');
  await expect(canvas).toHaveAttribute('data-view', /./);
  const [scale, offsetX, offsetY] = (await canvas.getAttribute('data-view'))!.split(' ').map(Number) as [
    number,
    number,
    number,
  ];
  const box = (await canvas.boundingBox())!;
  const height = fixture.doc.bounds!.height;
  return {
    x: box.x + offsetX + (height * 64 + (x - y) * 64) * scale,
    y: box.y + offsetY + (64 + (x + y) * 32) * scale,
  };
}

async function tap(page: Page, x: number, y: number) {
  const point = await cellPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function drag(page: Page, cells: readonly (readonly [number, number])[]) {
  const [first, ...rest] = cells;
  const start = await cellPoint(page, first![0], first![1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [x, y] of rest) {
    const point = await cellPoint(page, x, y);
    await page.mouse.move(point.x, point.y, { steps: 6 });
  }
  await page.mouse.up();
}

async function still(
  page: Page,
  name: string,
  testInfo: { attach(name: string, options: { body: Buffer; contentType: string }): Promise<void> },
) {
  await page.waitForTimeout(150);
  const body = await page.screenshot();
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (proof) {
    mkdirSync(join(proof, 'out'), { recursive: true });
    writeFileSync(join(proof, 'out', `${name}.png`), body);
  }
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`Kevin edits a scene and the agent's next pull sees it (${viewport.name})`, async ({
    browser,
    page: shared,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets its own viewport');
    const size = { width: viewport.width, height: viewport.height };
    /* A proof run draws a real pack's sprites and records the flow at its own size, for a clip to watch on a phone. */
    let recording: BrowserContext | undefined;
    if (proof) {
      test.setTimeout(180_000);
      recording = await browser.newContext({
        ...(testInfo.project.use.baseURL ? { baseURL: testInfo.project.use.baseURL } : {}),
        viewport: size,
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
        recordVideo: { dir: join(proof, 'out', 'video', viewport.name), size },
      });
    }
    const page = recording ? await recording.newPage() : shared;
    await page.setViewportSize(size);
    const store = agentScene();
    await openEditor(page);
    const saves = await installScene(page, store);
    await page.goto('/g/game?mode=edit&scene=goblin-cave&test', { waitUntil: 'domcontentloaded' });
    /* The app shell boots first; a loaded runner can take a while. */
    await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled({ timeout: 30_000 });
    await still(page, `${viewport.name}-1-open`, testInfo);

    // Place: pick the chest from the tray and tap a cell.
    await page.getByRole('tab', { name: 'Decor' }).click();
    await page.getByRole('option', { name: real ? /^Chest a1, smallscaleint fantasy/i : /^Chest a1$/i }).click();
    await tap(page, ...(at.place as [number, number]));
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Move: drag it two cells over with the select tool.
    await page.getByRole('button', { name: 'Select and move' }).click();
    await drag(page, [at.place, at.via, at.to] as [number, number][]);
    // Turn it.
    await expect(page.getByRole('toolbar', { name: 'Selected piece' })).toBeVisible();
    await still(page, `${viewport.name}-2-selected`, testInfo);
    await page.getByRole('button', { name: 'Turn' }).click();

    // Delete the rock.
    await tap(page, ...(at.rock as [number, number]));
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('toolbar', { name: 'Selected piece' })).toHaveCount(0);

    // Paint terrain in one stroke, undo it, and redo it.
    await page.getByRole('tab', { name: 'Floor' }).click();
    await page
      .getByRole('option', {
        name: new RegExp(`^${pieces.ground.split('/').at(-1)!.replace(/@.*$/, '').replace('-', ' ')}$`, 'i'),
      })
      .click();
    await drag(page, at.strip as [number, number][]);
    await still(page, `${viewport.name}-3-painted`, testInfo);
    await page.getByRole('button', { name: 'Undo' }).click();
    await still(page, `${viewport.name}-4-undone`, testInfo);
    await page.getByRole('button', { name: 'Redo' }).click();

    // Save.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.baseRev).toBe(1);
    const decor = store.head.doc.layers.decor!.tiles!;
    expect(decor[`${at.to[0]},${at.to[1]}`]).toEqual({ asset: pieces.chest, facing: 'N', lockedBy: 'creator' });
    expect(decor[`${at.place[0]},${at.place[1]}`]).toBeUndefined();
    expect(decor[`${at.rock[0]},${at.rock[1]}`]).toBeUndefined();
    for (const cell of at.strip.map(([x, y]) => `${x},${y}`)) {
      expect(store.head.doc.layers.floor!.tiles![cell]).toEqual({
        asset: pieces.ground,
        facing: 'E',
        lockedBy: 'creator',
      });
    }

    // Reload: the saved head opens, with the chest where Kevin left it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await tap(page, ...(at.to as [number, number]));
    await expect(page.getByRole('toolbar', { name: 'Selected piece' })).toBeVisible();
    await still(page, `${viewport.name}-5-reloaded`, testInfo);

    // The agent's next pull starts from Kevin's revision: his units are locked against its pushes.
    expect(store.log.map((revision) => [revision.rev, revision.author, revision.source])).toEqual([
      [1, 'agent:1208', 'cli'],
      [2, 'kevin', 'editor'],
    ]);
    const agent = structuredClone(store.head.doc);
    agent.layers.decor!.tiles![`${at.to[0]},${at.to[1]}`] = { asset: pieces.chest, facing: 'S' };
    const refused = commitScene({
      ...store,
      doc: agent,
      baseRev: 2,
      author: 'agent:1300',
      source: 'cli',
      label: '',
      now: new Date(),
    });
    expect(refused.ok).toBe(false);
    if (proof) {
      const scenes = join(proof, 'out', viewport.name, 'games', 'dusk-helm', 'scenes');
      mkdirSync(scenes, { recursive: true });
      writeFileSync(join(proof, 'out', viewport.name, 'games', 'dusk-helm', 'gm.manifest.json'), '{}');
      writeFileSync(join(scenes, 'goblin-cave.scene.json'), `${JSON.stringify(store.head, null, 2)}\n`);
      writeFileSync(
        join(scenes, 'goblin-cave.revs.jsonl'),
        store.log.map((revision) => `${JSON.stringify(revision)}\n`).join(''),
      );
    }
    await recording?.close();
  });
}

test('edits made while a save is on its way are kept for the next save', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop' || real, 'one synthetic run covers the race');
  await page.setViewportSize({ width: 1280, height: 800 });
  const store = agentScene();
  await openEditor(page);
  const saves = await installScene(page, store);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  await page.route('**/api/v1/games/game/editor/scenes/goblin-cave/revisions', async (route) => {
    // Kevin's first save is slow; he keeps painting before it lands.
    if (first) {
      first = false;
      await held;
    }
    await route.fallback();
  });
  await page.goto('/g/game?mode=edit&scene=goblin-cave&test', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Decor' }).click();
  await page.getByRole('option', { name: /^Chest a1$/i }).click();
  await tap(page, ...(at.place as [number, number]));
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('tab', { name: 'Floor' }).click();
  await page.getByRole('option', { name: /^Ground b1$/i }).click();
  await tap(page, 6, 6);
  release();
  await expect.poll(() => saves.length).toBe(1);
  // The answer to the first save must not wipe the cell painted after it was sent.
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  expect(saves).toHaveLength(2);
  expect(saves[1]!.baseRev).toBe(2);
  expect(store.head.doc.layers.floor!.tiles!['6,6']).toMatchObject({ asset: pieces.ground });
  expect(store.head.doc.layers.decor!.tiles![`${at.place[0]},${at.place[1]}`]).toMatchObject({ asset: pieces.chest });
});
