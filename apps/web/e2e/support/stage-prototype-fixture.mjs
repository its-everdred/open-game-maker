import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { stagePrototype } from '../../tools/stage-prototype.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'ogm-prototype-browser-'));
const fixture = join(fixtureRoot, 'studio-v0');

try {
  await cp(join(root, 'prototypes', 'studio-v0'), fixture, { recursive: true });
  await Promise.all([
    mkdir(join(fixture, 'art'), { recursive: true }),
    mkdir(join(fixture, 'demo'), { recursive: true }),
    mkdir(join(fixture, 'town'), { recursive: true }),
  ]);
  // Tiny images keep the staged scene module and splat mask loadable without host-local asset packs in CI.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const scenes = await readFile(join(fixture, 'scenes.js'), 'utf8');
  const sceneArt = [...scenes.matchAll(/'art\/([^']+)'/g)].map((match) => match[1]);
  const splats = [
    '00',
    '01',
    '02',
    '03',
    '05',
    '07',
    '10',
    '11',
    '14',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '24',
    '27',
    '28',
    '29',
    '30',
    '31',
    '33',
    '34',
    '35',
  ].map((name) => `splats/splat${name}.png`);
  await mkdir(join(fixture, 'art', 'splats'), { recursive: true });
  await mkdir(join(fixture, 'demo', 'assets', 'img'), { recursive: true });
  await Promise.all([...sceneArt, ...splats].map((name) => writeFile(join(fixture, 'art', name), pixel)));
  await writeFile(join(fixture, 'demo', 'assets', 'img', 'paper-bg.png'), pixel);
  await Promise.all([
    writeFile(join(fixture, 'art', 'logo-big.webp'), ''),
    writeFile(join(fixture, 'demo', 'index.html'), '<!doctype html><title>Prototype demo fixture</title>'),
    writeFile(join(fixture, 'town', 'index.html'), '<!doctype html><title>Prototype town fixture</title>'),
  ]);
  await stagePrototype(fixture, join(root, 'prototypes', 'ui-v0', 'site'), join(root, 'apps', 'web', 'dist', 'proto'));
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
