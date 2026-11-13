import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { creditsDocumentSchema, DesignDocSchema, gameManifestSchema } from '@ogm/contracts';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultDesign } from '../src/game.js';
import { manifest } from '../src/manifest.js';

/* The publisher copies a build dir into the games host and the API parses these two files with these schemas. */
const root = fileURLToPath(new URL('..', import.meta.url));
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'gm-game-2d-build-'));
  await build({ root, mode: 'published', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
}, 300_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(outDir, path), 'utf8'));

describe('the build writes the files a published build needs', () => {
  it('dist/manifest.json is the game manifest', () => {
    expect(gameManifestSchema.parse(readJson('manifest.json'))).toEqual(manifest);
  });

  it('dist/design/design.json is the folded template design', () => {
    expect(DesignDocSchema.parse(readJson('design/design.json'))).toEqual({
      ...defaultDesign,
      globals: {
        ...defaultDesign.globals,
        'scenery.lighting': 'warm-forest',
        'scenery.terrain': [],
        'scenery.settings': {
          version: 1,
          lighting: 'warm-forest',
          terrain: [],
          camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
        },
      },
    });
  });

  it('dist/credits.json is regenerated from the template lock', () => {
    expect(creditsDocumentSchema.parse(readJson('credits.json'))).toEqual({ version: 1, packs: [] });
  });
});
