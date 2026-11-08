/**
 * Renders a game's flow diagram. Every mermaid block in `<flowDir>/flow.md` becomes `<flowDir>/render/<n>-<heading>.png`,
 * with each screen image the block names (`src='screens/...'`) embedded, so the PNG is a storyboard of the game.
 *
 *   node .claude/skills/gm-new-game-plan/scripts/render-flow.ts games/<name>/design/flow
 *
 * Run it from a host checkout: it fetches the pinned Mermaid CLI once, so the network-off build sandbox cannot render.
 * Fails, naming the file, when a block points at a screen image that does not exist or a block is never closed. The
 * render directory is replaced only after every block rendered, so a removed level leaves no stale image.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type FlowBlock = { name: string; source: string };

const MERMAID_CLI = '@mermaid-js/mermaid-cli@11.4.2';
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The mermaid blocks of a flow file, in order, each named `<n>-<slug of the nearest ## heading above it>`. */
export function flowBlocks(markdown: string): FlowBlock[] {
  const blocks: FlowBlock[] = [];
  let heading = 'flow';
  let source: string[] | undefined;
  for (const line of markdown.split('\n')) {
    if (source) {
      if (line.trim() === '```') {
        blocks.push({ name: `${blocks.length + 1}-${slug(heading)}`, source: source.join('\n') });
        source = undefined;
      } else source.push(line);
    } else if (line.trim() === '```mermaid') source = [];
    else if (line.startsWith('## ')) heading = line.slice(3);
  }
  if (source) throw new Error(`unclosed mermaid block under "## ${heading}"`);
  return blocks;
}

const SCREEN_IMG = /<img\s+src=(['"])(screens\/[^'"]+)\1[^>]*>/g;
const SCREEN_IMG_RUN = /(?:<img\s+src=(['"])screens\/[^'"]+\1[^>]*>)+/g;
const PANEL = { width: 200, height: 433, gap: 10 };

/**
 * Replaces each run of adjacent `<img src='screens/<file>'>` tags (a node's target and live stills) with one SVG that
 * holds the files side by side, two slots wide at least so a screen without its live still keeps the same scale.
 * Mermaid stretches every label image to the node's width, so separate tags would always stack.
 */
export function embedScreens(source: string, flowDir: string): string {
  const missing: string[] = [];
  const dataUri = (path: string): string => {
    try {
      const mime = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
      return `data:${mime};base64,${readFileSync(join(flowDir, path)).toString('base64')}`;
    } catch {
      missing.push(path);
      return '';
    }
  };
  const embedded = source.replace(SCREEN_IMG_RUN, (run) => {
    const paths = [...run.matchAll(SCREEN_IMG)].map((match) => match[2] as string);
    const uris = paths.map(dataUri);
    const slots = Math.max(2, uris.length);
    const width = slots * PANEL.width + (slots - 1) * PANEL.gap;
    const panels = uris
      .map(
        (uri, i) =>
          `<image href="${uri}" x="${i * (PANEL.width + PANEL.gap)}" y="0" width="${PANEL.width}" height="${PANEL.height}"/>`,
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${PANEL.height}">${panels}</svg>`;
    return `<img src='data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}'/>`;
  });
  if (missing.length > 0) throw new Error(`missing screen images in ${flowDir}: ${missing.join(', ')}`);
  return embedded;
}

export function renderFlow(flowDir: string): string[] {
  const blocks = flowBlocks(readFileSync(join(flowDir, 'flow.md'), 'utf8'));
  if (blocks.length === 0) throw new Error(`no mermaid blocks in ${join(flowDir, 'flow.md')}`);
  const sources = blocks.map((block) => ({ name: block.name, source: embedScreens(block.source, flowDir) }));
  const outDir = join(flowDir, 'render');
  const scratch = mkdtempSync(join(flowDir, '.render-'));
  try {
    /* Embedded screenshots run to megabytes; Mermaid's default 50,000-character limit would draw an error box. */
    const config = join(scratch, 'mermaid.json');
    writeFileSync(config, JSON.stringify({ maxTextSize: 100_000_000 }));
    for (const { name, source } of sources) {
      const input = join(scratch, `${name}.mmd`);
      writeFileSync(input, source);
      execFileSync(
        'npx',
        ['-y', MERMAID_CLI, '-i', input, '-o', join(scratch, `${name}.png`), '-c', config, '-s', '2', '-b', 'white'],
        { stdio: 'inherit' },
      );
      rmSync(input);
    }
    rmSync(config);
    rmSync(outDir, { recursive: true, force: true });
    renameSync(scratch, outDir);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return sources.map(({ name }) => join(outDir, `${name}.png`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flowDir = process.argv[2];
  if (!flowDir) {
    console.error('usage: render-flow.ts <games/<name>/design/flow>');
    process.exit(2);
  }
  for (const path of renderFlow(flowDir)) console.log(path);
}
