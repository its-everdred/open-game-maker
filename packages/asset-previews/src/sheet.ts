import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import sharp, { type Sharp } from 'sharp';

import { renderModelViews, type BrowserRenderOptions } from './browser.js';
import { VIEWS, type View } from './page.js';
import { outputKey } from './key.js';

export type RenderSheetOptions = BrowserRenderOptions & {
  assetsRoot?: string;
  cellSize?: number;
  size?: number;
  label?: string;
  views?: readonly View[];
};

export type RenderSheetResult = {
  out: string;
  key: string;
  width: number;
  height: number;
  renderer: string;
  software: boolean;
  views: readonly View[];
};

async function atomicWebp(image: Sharp, out: string, assetsRoot?: string): Promise<void> {
  const key = outputKey(out, assetsRoot);
  const root = resolve(out, ...key.split('/').map(() => '..'));
  const canonicalRoot = await realpath(root);
  let current = root;
  for (const part of key.split('/').slice(0, -1)) {
    current = join(current, part);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('preview output resolves outside the asset library or uses a symlink');
    }
    const local = relative(canonicalRoot, await realpath(current));
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
      throw new Error('preview output resolves outside the asset library');
    }
  }
  const staged = `${out}.part-${randomUUID()}`;
  try {
    await writeFile(staged, await image.webp({ quality: 82 }).toBuffer(), { flag: 'wx' });
    await rename(staged, out);
  } catch (error) {
    await unlink(staged).catch(() => undefined);
    throw error;
  }
}

export async function renderSheet(
  glb: string,
  out: string,
  options: RenderSheetOptions = {},
): Promise<RenderSheetResult> {
  const key = outputKey(out, options.assetsRoot);
  const views = options.views ?? VIEWS;
  if (views.length === 0) throw new Error('at least one model view is required');
  const cellSize = options.size ?? options.cellSize ?? 384;
  const rendered = await renderModelViews(glb, views, options);
  const columns = Math.min(3, views.length);
  const rows = Math.ceil(views.length / columns);
  const cells = await Promise.all(
    rendered.cells.map((cell) => sharp(cell).resize(cellSize, cellSize, { fit: 'fill' }).png().toBuffer()),
  );
  const label = (options.label ?? basename(glb)).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
  const labelStrip = Buffer.from(
    `<svg width="${columns * cellSize}" height="24"><rect width="100%" height="24" fill="#333"/><text x="8" y="17" fill="white" font-family="sans-serif" font-size="12">${label}</text></svg>`,
  );
  await atomicWebp(
    sharp({
      create: { width: columns * cellSize, height: rows * cellSize, channels: 3, background: '#9a9a9a' },
    }).composite([
      ...cells.map((input, index) => ({
        input,
        left: (index % columns) * cellSize,
        top: Math.floor(index / columns) * cellSize,
      })),
      { input: labelStrip, left: 0, top: rows * cellSize - 24 },
    ]),
    out,
    options.assetsRoot,
  );
  return {
    out,
    key,
    width: columns * cellSize,
    height: rows * cellSize,
    renderer: rendered.renderer,
    software: rendered.software,
    views,
  };
}

export { atomicWebp };
