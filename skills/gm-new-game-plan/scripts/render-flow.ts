/**
 * Renders a game's flow diagram. Every mermaid block in `<flowDir>/flow.md` becomes `<flowDir>/render/<n>-<heading>.png`,
 * with each screen image the block names (`src='screens/...'`) embedded, so the PNG is a storyboard of the game.
 *
 *   node .claude/skills/gm-new-game-plan/scripts/render-flow.ts games/<name>/design/flow
 *
 * Fails, naming the file, when a block points at a screen image that does not exist.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  const outDir = join(flowDir, 'render');
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'gm-flow-'));
  const written: string[] = [];
  try {
    for (const block of blocks) {
      const input = join(scratch, `${block.name}.mmd`);
      writeFileSync(input, embedScreens(block.source, flowDir));
      const output = join(outDir, `${block.name}.png`);
      execFileSync('npx', ['-y', MERMAID_CLI, '-i', input, '-o', output, '-s', '2', '-b', 'white'], {
        stdio: 'inherit',
      });
      written.push(output);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flowDir = process.argv[2];
  if (!flowDir) {
    console.error('usage: render-flow.ts <games/<name>/design/flow>');
    process.exit(2);
  }
  for (const path of renderFlow(flowDir)) console.log(path);
}
