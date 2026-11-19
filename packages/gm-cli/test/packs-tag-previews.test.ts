import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewKey } from '@ogm/asset-previews';

import { discoverTagTargets, prepareVisualPreviews, type TagTarget } from '../src/packs/tag.js';
import { library, tempDir } from './helpers.js';

const previews = vi.hoisted(() => ({ renderSheet: vi.fn(), renderCollectionSheet: vi.fn(), spriteSheet: vi.fn() }));

vi.mock('@ogm/asset-previews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ogm/asset-previews')>();
  return { ...actual, ...previews };
});

function tagLibrary(): string {
  const root = library();
  for (const name of ['broken-no-source.card.json', 'broken-status.card.json']) {
    rmSync(join(root, 'packs/kenney-mini-dungeon/cards', name), { force: true });
  }
  return root;
}

const PACK = 'packs/kenney-mini-dungeon';

const PRIVATE_RIGHTS = {
  uses: ['vision-input'],
  audience: 'private',
  redistribution: 'none',
  attribution: null,
  processing: 'local-only',
  basis: [
    {
      type: 'default',
      uses: ['vision-input'],
      audience: 'private',
      redistribution: 'none',
      set_by: { role: 'intake-code' },
      date: '2026-11-01',
    },
  ],
};

/** Gives every model card its extracted source file so the renderer path is reachable. */
async function modelLibrary(): Promise<{ assetsRoot: string; targets: TagTarget[] }> {
  const assetsRoot = tagLibrary();
  await writeFile(join(assetsRoot, PACK, 'pack.json'), JSON.stringify({ current: 'v1' }));
  for (const name of ['character-orc.card.json', 'wall.card.json']) {
    const path = join(assetsRoot, PACK, 'cards', name);
    const card = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    card.status = 'measured';
    await writeFile(path, JSON.stringify(card));
  }
  const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
  for (const { card, path: cardPath } of targets[0]?.cards ?? []) {
    const source = card.source?.files.find((file) => file.role === 'primary');
    if (!source) continue;
    const path = join(assetsRoot, PACK, 'v1/extracted', source.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'glb');
    source.sha256 = `sha256:${createHash('sha256').update('glb').digest('hex')}`;
    await writeFile(cardPath, JSON.stringify(card));
  }
  const refreshed = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
  return { assetsRoot, targets: refreshed.targets };
}

async function narrowCard(assetsRoot: string, name: string): Promise<void> {
  const path = join(assetsRoot, PACK, 'cards', name);
  const card = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  card.rights = PRIVATE_RIGHTS;
  await writeFile(path, `${JSON.stringify(card, null, 2)}\n`);
}

async function sheetOf(assetsRoot: string, file: string): Promise<string | undefined> {
  const card = JSON.parse(await readFile(join(assetsRoot, file), 'utf8')) as { previews?: { sheet?: string } };
  return card.previews?.sheet;
}

beforeEach(() => {
  previews.renderSheet.mockReset().mockResolvedValue({ key: '', width: 1, height: 1, renderer: 'stub' });
  previews.renderCollectionSheet.mockReset().mockImplementation(async (_thumbs: string[], out: string) => ({
    key: out,
    pages: [out],
  }));
});

describe('prepareVisualPreviews', () => {
  it('keeps a card that narrows redistribution, and its collection sheet, out of public previews', async () => {
    const { assetsRoot } = await modelLibrary();
    await narrowCard(assetsRoot, 'character-orc.card.json');
    const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');

    await prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 0, software: true });

    expect(await sheetOf(assetsRoot, `${PACK}/cards/character-orc.card.json`)).toMatch(/^private\/previews\//);
    expect(await sheetOf(assetsRoot, `${PACK}/cards/wall.card.json`)).toMatch(/^previews\//);
    expect(previews.renderCollectionSheet).toHaveBeenCalledTimes(1);
    expect(await sheetOf(assetsRoot, `${PACK}/collection.card.json`)).toMatch(/^private\/previews\//);
  });

  it('skips cards whose sheet already exists and the collection sheet on a limited run', async () => {
    const { assetsRoot } = await modelLibrary();
    const wallPath = join(assetsRoot, PACK, 'cards/wall.card.json');
    const wall = JSON.parse(await readFile(wallPath, 'utf8')) as {
      source: { files: Array<{ sha256: string }> };
      previews: { sheet: string };
    };
    const existing = previewKey(wall.source.files[0]!.sha256.replace(/^sha256:/, ''), 'model-sheet', 'free', {
      version: 1,
    });
    wall.previews.sheet = existing;
    await writeFile(wallPath, JSON.stringify(wall));
    const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
    await mkdir(dirname(join(assetsRoot, existing)), { recursive: true });
    await writeFile(join(assetsRoot, existing), 'webp');

    await prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 1, software: true });

    const rendered = previews.renderSheet.mock.calls.map(([glb]) => String(glb));
    expect(rendered.some((glb) => glb.endsWith('wall.glb'))).toBe(false);
    expect(previews.renderCollectionSheet).not.toHaveBeenCalled();
  });

  it('excludes root-locked cards before applying the limit', async () => {
    const { assetsRoot } = await modelLibrary();
    const path = join(assetsRoot, PACK, 'cards/character-orc.card.json');
    const card = JSON.parse(await readFile(path, 'utf8')) as { provenance: Record<string, { locked?: boolean }> };
    card.provenance['*'] = { ...card.provenance['*'], locked: true };
    await writeFile(path, JSON.stringify(card));
    const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
    await prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 1, software: true });
    expect(previews.renderSheet).toHaveBeenCalledTimes(1);
    expect(String(previews.renderSheet.mock.calls[0]?.[0])).toContain('wall');
  });

  it('does not render a source restricted by another card', async () => {
    const { assetsRoot } = await modelLibrary();
    const original = JSON.parse(
      await readFile(join(assetsRoot, PACK, 'cards/character-orc.card.json'), 'utf8'),
    ) as Record<string, unknown>;
    const duplicate = structuredClone(original);
    duplicate.id = 't1:kenney-mini-dungeon/restricted-orc@2.0';
    duplicate.rights = { ...PRIVATE_RIGHTS, uses: [], basis: [{ ...PRIVATE_RIGHTS.basis[0], uses: [] }] };
    await writeFile(join(assetsRoot, PACK, 'cards/restricted-orc.card.json'), JSON.stringify(duplicate));
    const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
    expect(targets[0]?.cards.some(({ card }) => card.id.includes('orc'))).toBe(false);
  });

  it('rejects a restrictive card that aliases another source', async () => {
    const { assetsRoot } = await modelLibrary();
    const original = JSON.parse(await readFile(join(assetsRoot, PACK, 'cards/character-orc.card.json'), 'utf8')) as {
      id: string;
      source: { files: Array<{ path: string }> };
      rights?: unknown;
    };
    const real = join(assetsRoot, PACK, 'v1/extracted', original.source.files[0]!.path);
    const alias = join(dirname(real), 'alias.glb');
    await symlink(real, alias);
    original.id = 't1:kenney-mini-dungeon/restricted-alias@2.0';
    original.source.files[0]!.path = original.source.files[0]!.path.replace(/[^/]+$/, 'alias.glb');
    original.rights = { ...PRIVATE_RIGHTS, uses: [], basis: [{ ...PRIVATE_RIGHTS.basis[0], uses: [] }] };
    await writeFile(join(assetsRoot, PACK, 'cards/alias.card.json'), JSON.stringify(original));
    await expect(discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon')).rejects.toThrow('source alias');
  });

  it('refuses a symlink at an otherwise valid existing sheet key', async () => {
    const { assetsRoot } = await modelLibrary();
    const path = join(assetsRoot, PACK, 'cards/character-orc.card.json');
    const card = JSON.parse(await readFile(path, 'utf8')) as {
      source: { files: Array<{ sha256: string }> };
      previews: { sheet: string };
    };
    const key = previewKey(card.source.files[0]!.sha256.replace(/^sha256:/, ''), 'model-sheet', 'free', { version: 1 });
    card.previews.sheet = key;
    await writeFile(path, JSON.stringify(card));
    const output = join(assetsRoot, key);
    await mkdir(dirname(output), { recursive: true });
    const outside = join(tempDir('gm-preview-outside-'), 'private.webp');
    await writeFile(outside, 'private');
    await symlink(outside, output);
    const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
    await expect(
      prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 0, software: true }),
    ).rejects.toThrow('symlink');
  });

  it('refuses a source whose bytes do not match its card hash', async () => {
    const { assetsRoot, targets } = await modelLibrary();
    const source = targets[0]!.cards[0]!.card.source!.files[0]!;
    await writeFile(join(assetsRoot, PACK, 'v1/extracted', source.path), 'different bytes');
    await expect(
      prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 1, software: true }),
    ).rejects.toThrow('source hash does not match');
    expect(previews.renderSheet).not.toHaveBeenCalled();
  });

  it('refuses a source file that resolves outside the extracted collection', async () => {
    const { assetsRoot, targets } = await modelLibrary();
    const outside = join(tempDir('gm-outside-'), 'secret.glb');
    await writeFile(outside, 'glb');
    const orc = targets[0]?.cards.find(({ card }) => card.id.includes('orc'))?.card;
    const source = orc?.source?.files.find((file) => file.role === 'primary');
    if (!source) throw new Error('fixture orc card lost its primary source');
    const path = join(assetsRoot, PACK, 'v1/extracted', source.path);
    await rm(path);
    await symlink(outside, path);

    await expect(
      prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 0, software: true }),
    ).rejects.toThrow(/resolves outside its collection/);
  });
});
