import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { embedScreens, flowBlocks } from './render-flow.js';

const TEMPLATE = fileURLToPath(new URL('../references/flow-template.md', import.meta.url));

function flowDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gm-flow-test-'));
  mkdirSync(join(dir, 'screens'));
  return dir;
}

describe('render-flow', () => {
  it('names each mermaid block by its level heading so the renders read as the four levels in order', () => {
    const blocks = flowBlocks(readFileSync(TEMPLATE, 'utf8'));
    expect(blocks.map((block) => block.name)).toEqual([
      '1-core-loop',
      '2-session-loop',
      '3-meta-loop',
      '4-navigation',
    ]);
    expect(blocks[3]?.source).toMatch(/^flowchart TD/);
    expect(blocks[3]?.source).not.toContain('```');
  });

  it('embeds a node\'s target and live stills side by side, every screen at one scale, so the render is a storyboard', () => {
    const dir = flowDir();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    writeFileSync(join(dir, 'screens/title.target.png'), png);
    writeFileSync(join(dir, 'screens/title.live.jpg'), Buffer.from([0xff, 0xd8]));
    writeFileSync(join(dir, 'screens/pause.target.png'), png);

    const source = [
      'flowchart TD',
      `  title["<img src='screens/title.target.png'/><img src="screens/title.live.jpg" width='90'/><br/>title"]`,
      `  pause["<img src='screens/pause.target.png'/><br/>pause"]`,
      '  title -->|Pause| pause',
    ].join('\n');
    const out = embedScreens(source, dir);
    const imgs = [...out.matchAll(/<img src='([^']+)'\/>/g)].map((match) => match[1] as string);

    expect(imgs).toHaveLength(2);
    const pair = Buffer.from((imgs[0] as string).replace('data:image/svg+xml;base64,', ''), 'base64').toString();
    expect(pair).toContain(`href="data:image/png;base64,${png.toString('base64')}" x="0"`);
    expect(pair).toContain('href="data:image/jpeg;base64,/9g=" x="210"');
    const single = Buffer.from((imgs[1] as string).replace('data:image/svg+xml;base64,', ''), 'base64').toString();
    expect(single).toContain('viewBox="0 0 410 433"');
    expect(single.match(/<image /g)).toHaveLength(1);
    expect(out).not.toContain('screens/');
    expect(out).toContain('<br/>title"]');
    expect(out).toContain('title -->|Pause| pause');
  });

  it('fails naming every missing screen image instead of rendering an empty node', () => {
    const dir = flowDir();
    const source = `a["<img src='screens/a.target.png'/>"] --> b["<img src='screens/b.live.png'/>"]`;
    expect(() => embedScreens(source, dir)).toThrow('screens/a.target.png, screens/b.live.png');
  });
});
