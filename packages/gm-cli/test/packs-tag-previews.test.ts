import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverTagTargets, prepareVisualPreviews, type TagTarget } from '../src/packs/tag.js';
import { library, tempDir } from './helpers.js';

const previews = vi.hoisted(() => ({ renderSheet: vi.fn(), renderCollectionSheet: vi.fn(), spriteSheet: vi.fn() }));

vi.mock('@ogm/asset-previews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ogm/asset-previews')>();
  return { ...actual, ...previews };
});

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
  const assetsRoot = library();
  await writeFile(join(assetsRoot, PACK, 'pack.json'), JSON.stringify({ current: 'v1' }));
  const { targets } = await discoverTagTargets(assetsRoot, 'model', 'kenney-mini-dungeon');
  for (const { card } of targets[0]?.cards ?? []) {
    const source = card.source?.files.find((file) => file.role === 'primary');
    if (!source) continue;
    const path = join(assetsRoot, PACK, 'v1/extracted', source.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'glb');
  }
  return { assetsRoot, targets };
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
    const { assetsRoot, targets } = await modelLibrary();
    const existing = await sheetOf(assetsRoot, `${PACK}/cards/wall.card.json`);
    if (!existing) throw new Error('fixture wall card lost its sheet key');
    await mkdir(dirname(join(assetsRoot, existing)), { recursive: true });
    await writeFile(join(assetsRoot, existing), 'webp');

    await prepareVisualPreviews({ assetsRoot, targets, kind: 'model', limit: 1, software: true });

    const rendered = previews.renderSheet.mock.calls.map(([glb]) => String(glb));
    expect(rendered.some((glb) => glb.endsWith('wall.glb'))).toBe(false);
    expect(previews.renderCollectionSheet).not.toHaveBeenCalled();
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
