// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { creditsDocumentSchema, type GameManifest } from '@ogm/contracts';

import { foldDesignFiles, gmBuildArtifacts, regenerateCredits, sceneryArtifact } from './index.js';

const entity = (id: string) => ({ id, prefab: 'spawn', level: 'main', origin: 'build', props: {} });
const A = 'spawn_01K8ZTEMP00000000000000001';
const B = 'spawn_01K8ZTEMP00000000000000002';

function designDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gm-design-'));
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(doc));
  return dir;
}

/* A game may split its design across design/*.json; the published build carries exactly one doc the API can load. */
describe('foldDesignFiles', () => {
  it('folds every design file into one doc', () => {
    const dir = designDir({
      'b.json': { schemaVersion: 1, globals: { speed: 2 }, entities: { [B]: entity(B) } },
      'a.json': { schemaVersion: 1, globals: { width: 10 }, entities: { [A]: entity(A) } },
      'notes.txt': 'ignored',
    });
    expect(foldDesignFiles(dir)).toEqual({
      schemaVersion: 1,
      globals: { width: 10, speed: 2 },
      entities: { [A]: entity(A), [B]: entity(B) },
    });
  });

  it('leaves the creator feedback ledger and the decision record out of the design doc', () => {
    const dir = designDir({
      'a.json': { schemaVersion: 1, globals: { width: 10 }, entities: { [A]: entity(A) } },
      'feedback.json': { schemaVersion: 1, entries: [] },
      'decisions.json': { schemaVersion: 1, decisions: [] },
    });
    expect(foldDesignFiles(dir)).toEqual({
      schemaVersion: 1,
      globals: { width: 10 },
      entities: { [A]: entity(A) },
    });
  });

  it('excludes visual scope evidence from the published design', () => {
    const dir = designDir({
      'a.json': { schemaVersion: 1, globals: { width: 10 }, entities: { [A]: entity(A) } },
      'look-scope.json': { source: 'commit', screens: { play: { sheet: 'evidence' } } },
    });
    expect(foldDesignFiles(dir)).toEqual({ schemaVersion: 1, globals: { width: 10 }, entities: { [A]: entity(A) } });
  });

  it('refuses an entity defined by two files instead of silently keeping one', () => {
    const doc = { schemaVersion: 1, globals: {}, entities: { [A]: entity(A) } };
    expect(() => foldDesignFiles(designDir({ 'a.json': doc, 'b.json': doc }))).toThrow(
      `design/b.json: entity "${A}" is already defined by another design file`,
    );
  });

  it('refuses a design file whose entity ids are not stable ids', () => {
    const dir = designDir({ 'a.json': { schemaVersion: 1, globals: {}, entities: { spawn_a: entity('spawn_a') } } });
    expect(() => foldDesignFiles(dir)).toThrow(/design\/a\.json is not a valid design doc/);
  });

  it('refuses a global defined by two files', () => {
    const doc = { schemaVersion: 1, globals: { speed: 1 }, entities: {} };
    expect(() => foldDesignFiles(designDir({ 'a.json': doc, 'b.json': doc }))).toThrow(
      'design/b.json: global "speed" is already defined by another design file',
    );
  });

  it('names the design file that is not JSON', () => {
    const dir = designDir({});
    writeFileSync(join(dir, 'level.json'), '{ broken');
    expect(() => foldDesignFiles(dir)).toThrow(/^design\/level\.json is not valid JSON/);
  });

  it('refuses files with different schema versions', () => {
    const dir = designDir({
      'a.json': { schemaVersion: 1, globals: {}, entities: {} },
      'b.json': { schemaVersion: 2, globals: {}, entities: {} },
    });
    expect(() => foldDesignFiles(dir)).toThrow('design/b.json: schemaVersion 2 differs from 1');
  });
});

describe('regenerateCredits', () => {
  it('keeps the original manifest-and-design plugin call compatible', () => {
    expect(gmBuildArtifacts({ manifest: {} as GameManifest, designDir: '/game/design' }).name).toBe(
      'gm-build-artifacts',
    );
  });

  it('writes markdown and machine-readable credits from the current lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-credits-'));
    const lockFile = join(dir, 'assets.lock.json');
    const creditsFile = join(dir, 'CREDITS.md');
    writeFileSync(
      lockFile,
      JSON.stringify({
        version: 1,
        family: 'pixel-art',
        pov: 'side',
        assets: [
          {
            id: 't1:example-pack/hero@1',
            sha256: 'a'.repeat(64),
            path: 'hero.png',
            source: 'library',
            license: 'CC-BY-4.0',
            rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: 'Example Artist' },
            credit: {
              pack: 'example-pack',
              title: 'Example Pack',
              licenseSource: 'https://example.test/license',
              attribution: 'Example Artist',
              source: { label: 'Example', url: 'https://example.test/source' },
            },
            added: '2026-11-02',
          },
        ],
      }),
    );

    const document = regenerateCredits(lockFile, creditsFile);

    expect(creditsDocumentSchema.parse(document).packs[0]).toMatchObject({
      pack: 'example-pack',
      attribution: 'Example Artist',
    });
    expect(readFileSync(creditsFile, 'utf8')).toContain('Example Pack — Example Artist');
  });
});

describe('sceneryArtifact', () => {
  it('publishes a validated scene and rejects assets absent from the lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-scenery-'));
    const lock = join(dir, 'assets.lock.json');
    writeFileSync(lock, JSON.stringify({ version: 1, family: 'pixel-art', pov: 'side', assets: [] }));
    expect(sceneryArtifact(dir, lock)).toBeUndefined();
    const scene = {
      version: 1,
      items: [],
      terrain: [],
      lighting: 'night',
      camera: { position: [0, 1, 2], target: [0, 0, 0], zoom: 1 },
    };
    writeFileSync(join(dir, 'scenery.json'), JSON.stringify(scene));
    expect(JSON.parse(sceneryArtifact(dir, lock)!)).toEqual(scene);
    scene.items.push({
      id: 'tree',
      assetId: 'missing',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      layer: 'mid',
    } as never);
    writeFileSync(join(dir, 'scenery.json'), JSON.stringify(scene));
    expect(() => sceneryArtifact(dir, lock)).toThrow('Scenery asset is not in the lock');
  });
});

describe('scenery build integration', () => {
  it('includes opt-in scenery as stable editable design entities', () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-scenery-build-'));
    const design = join(root, 'design');
    mkdirSync(design);
    writeFileSync(join(design, 'level.json'), JSON.stringify({ schemaVersion: 1, globals: {}, entities: {} }));
    const id = 't1:example/tree@1';
    writeFileSync(
      join(root, 'assets.lock.json'),
      JSON.stringify({
        version: 1,
        family: 'pixel-art',
        pov: 'side',
        assets: [
          {
            id,
            sha256: 'a'.repeat(64),
            path: 'tree.glb',
            license: 'CC0-1.0',
            rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
            credit: {
              pack: 'example',
              title: 'Example',
              licenseSource: 'fixture',
              attribution: 'none required',
              source: { label: 'fixture' },
            },
            added: '2026-11-01',
          },
        ],
      }),
    );
    writeFileSync(
      join(root, 'scenery.json'),
      JSON.stringify({
        version: 1,
        items: [{ id: 'oak', assetId: id, position: [1, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1], layer: 'back' }],
        terrain: [],
        lighting: 'night',
        camera: { position: [0, 5, 5], target: [0, 0, 0], zoom: 1 },
      }),
    );
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), '../contracts/fixtures/game.v1.json'), 'utf8'),
    ) as GameManifest;
    const files: Record<string, string> = {};
    gmBuildArtifacts({ manifest, designDir: design }).generateBundle.call({
      emitFile(file) {
        files[file.fileName] = file.source;
        return file.fileName;
      },
    });
    expect(Object.keys(JSON.parse(files['design/design.json']!).entities)).toHaveLength(0);
    manifest.capabilities.push('scenery');
    gmBuildArtifacts({ manifest, designDir: design }).generateBundle.call({
      emitFile(file) {
        files[file.fileName] = file.source;
        return file.fileName;
      },
    });
    const result = JSON.parse(files['design/design.json']!);
    expect(Object.values(result.entities)).toEqual([
      expect.objectContaining({ prefab: `scenery:${id}`, props: expect.objectContaining({ sceneryItemId: 'oak' }) }),
    ]);
    expect(result.globals['scenery.settings'].lighting).toBe('night');
    const first = Object.keys(result.entities)[0];
    gmBuildArtifacts({ manifest, designDir: design }).generateBundle.call({
      emitFile(file) {
        files[file.fileName] = file.source;
        return file.fileName;
      },
    });
    expect(Object.keys(JSON.parse(files['design/design.json']!).entities)[0]).toBe(first);
    rmSync(join(root, 'scenery.json'));
    gmBuildArtifacts({ manifest, designDir: design }).generateBundle.call({
      emitFile(file) {
        files[file.fileName] = file.source;
        return file.fileName;
      },
    });
    const empty = JSON.parse(files['design/design.json']!);
    expect(empty.globals['scenery.settings'].lighting).toBe('warm-forest');
    expect(empty.entities).toEqual({});
  });
});
