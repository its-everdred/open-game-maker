import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sharp from 'sharp';

const WIDTHS = [320, 640, 960, 1440, 2048];
const FORMATS = ['avif', 'webp', 'png'] as const;
type Format = (typeof FORMATS)[number];
export type DisplayImage = {
  width: number;
  height: number;
  sources: Record<Format, { width: number; path: string }[]>;
};

/** Build content-addressed display media for a published build. */
export async function makeDisplayImages(
  root: string,
  logo?: string,
  loading: readonly string[] = [],
  variants: readonly string[] = [],
): Promise<Record<string, DisplayImage>> {
  const media = join(root, 'media');
  const output = join(media, 'ogm-variants');
  const entries: { name: string; path: string; isFile: boolean }[] = [];
  const scan = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (prefix === '' && entry.name === 'ogm-variants') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await scan(join(directory, entry.name), relative);
      else entries.push({ name: relative, path: join(directory, entry.name), isFile: entry.isFile() });
    }
  };
  await scan(media, '');
  const images: Record<string, DisplayImage> = {};
  let outputCreated = false;
  for (const entry of entries) {
    if (
      !entry.isFile ||
      (entry.name !== 'thumbnail.png' &&
        `media/${entry.name}` !== logo &&
        !loading.includes(`media/${entry.name}`) &&
        !variants.includes(`media/${entry.name}`)) ||
      !['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extname(entry.name).toLowerCase())
    )
      continue;
    const input = await readFile(entry.path);
    const meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.width || !meta.height) throw new Error('display_image_invalid');
    const { width: sourceWidth, height: sourceHeight } = meta.autoOrient ?? meta;
    const widths = WIDTHS.filter((width) => width < sourceWidth);
    widths.push(Math.min(sourceWidth, WIDTHS[WIDTHS.length - 1]!));
    const sources: DisplayImage['sources'] = { avif: [], webp: [], png: [] };
    if (!outputCreated) {
      await mkdir(output, { recursive: true });
      outputCreated = true;
    }
    for (const width of widths) {
      for (const format of FORMATS) {
        const bytes = await sharp(input, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width })
          .toFormat(format)
          .toBuffer();
        const hash = createHash('sha256').update(bytes).digest('hex');
        const name = `${hash}.${format}`;
        const target = join(output, name);
        const temporary = join(output, `.tmp-${randomUUID()}`);
        try {
          await writeFile(temporary, bytes, { flag: 'wx' });
          try {
            await link(temporary, target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await readFile(target)).equals(bytes))
              throw error;
          }
        } finally {
          await rm(temporary, { force: true });
        }
        sources[format].push({ width, path: `media/ogm-variants/${name}` });
      }
    }
    images[`media/${entry.name}`] = { width: sourceWidth, height: sourceHeight, sources };
  }
  return images;
}
