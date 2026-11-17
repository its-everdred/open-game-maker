import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runL0 } from '../src/gates/l0-static.js';

it('reports explicit stretch and respects a reasoned exception', () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-stretch-'));
  try {
    writeFileSync(
      join(root, 'view.tsx'),
      [
        'const x = <img width="90" height="30" src="button.png" />;',
        'ctx.drawImage(img, 0, 0, 90, 30, 0, 0, 30, 30);',
        '/* gm-allow-stretch: intentional texture */',
        'ctx.drawImage(img, 0, 0, 90, 30, 0, 0, 30, 30);',
        'ctx.drawImage(img, 0, 0, 90, 30, 0, 0, 30, 30); /* gm-allow-stretch: intentional texture */',
        'ctx.drawImage(img, 0, 0, 90, 30, 0, 0, 30, 30);',
        'const y = <img width={w > 0 ? 90 : 30} height={30} src={url} />;',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'view.css'),
      [
        '.stretched { background-image: url("button.png"); background-size: 100% 100%; }',
        '.shorthand { background: var(--button) center / 100% 100% no-repeat; }',
        '.fixed { background-image: url("button.png"); background-size: 100px 50px; }',
        '.data { background-image: url(data:image/png;base64,aaa); background-size: 1in 2vmin; }',
        'img { object-fit: fill; }',
        '.slice { border-image: url("button.png") 10 fill / 10px stretch; }',
        '/* object-fit: fill; */',
      ].join('\n'),
    );
    const result = runL0(root, { checks: ['image-stretch'] });
    expect(result.ok).toBe(false);
    expect(result.checks.map((item) => [item.file, item.line])).toEqual(
      expect.arrayContaining([
        ['view.css', 1],
        ['view.css', 2],
        ['view.css', 3],
        ['view.css', 4],
        ['view.css', 5],
        ['view.tsx', 1],
        ['view.tsx', 2],
        ['view.tsx', 6],
        ['view.tsx', 7],
      ]),
    );
    expect(result.checks).toHaveLength(9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('recognizes stylesheet fits, style properties and variable-backed backgrounds', () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-stretch-styles-'));
  try {
    writeFileSync(
      join(root, 'page.html'),
      '<link rel="stylesheet" href="./page.css"><img class="safe" width="90" height="30"><!-- object-fit: fill -->',
    );
    writeFileSync(
      join(root, 'page.css'),
      '.safe { object-fit: contain; }\n.card { background: var(--art) center / 200% 100%; }\n.split { background-image: url(button.png); }\n.split { background-size: 60px 30px; }',
    );
    writeFileSync(
      join(root, 'view.tsx'),
      "element.style.objectFit = 'fill';\nconst node = <div style={{ backgroundSize: '90px 30px' }} />;\n// object-fit: fill is forbidden",
    );
    const result = runL0(root, { checks: ['image-stretch'] });
    expect(result.checks.map((item) => [item.file, item.line])).toEqual(
      expect.arrayContaining([
        ['page.css', 2],
        ['page.css', 4],
        ['view.tsx', 1],
        ['view.tsx', 2],
      ]),
    );
    expect(result.checks).toHaveLength(4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('detects literal stretch in setProperty and conditional inline styles', () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-stretch-dynamic-'));
  try {
    writeFileSync(
      join(root, 'view.tsx'),
      "element.style.setProperty('object-fit', 'fill');\nconst x = <img style={{ objectFit: selected ? 'contain' : 'fill' }} />;",
    );
    expect(runL0(root, { checks: ['image-stretch'] }).checks.map((item) => item.line)).toEqual([1, 2]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('ignores prototypes and does not borrow unrelated or conditional stylesheet rules', () => {
  const root = mkdtempSync(join(tmpdir(), 'gm-stretch-scope-'));
  try {
    writeFileSync(join(root, 'page.html'), '<img class="hero" width="90" height="30">');
    writeFileSync(join(root, 'other.css'), '.hero { object-fit: contain; }');
    mkdirSync(join(root, 'prototypes'));
    writeFileSync(join(root, 'prototypes/old.css'), '.old { object-fit: fill; }');
    let result = runL0(root, { checks: ['image-stretch'] });
    expect(result.checks.map((item) => item.file)).toEqual(['page.html']);
    writeFileSync(
      join(root, 'page.html'),
      '<link rel="stylesheet" href="./other.css"><img class="hero" width="90" height="30">',
    );
    writeFileSync(join(root, 'other.css'), '@media (min-width: 1000px) { .hero { object-fit: contain; } }');
    result = runL0(root, { checks: ['image-stretch'] });
    expect(result.checks.map((item) => item.file)).toEqual(['page.html']);
    writeFileSync(join(root, 'other.css'), '.hero { object-fit: contain; }');
    writeFileSync(
      join(root, 'page.html'),
      '<!-- <link href="./other.css"> --><img class="hero" width="90" height="30">',
    );
    expect(runL0(root, { checks: ['image-stretch'] }).checks.map((item) => item.file)).toEqual(['page.html']);
    for (const link of [
      '<link rel="stylesheet" href="./other.css" disabled>',
      '<link rel="preload" as="style" href="./other.css">',
    ]) {
      writeFileSync(join(root, 'page.html'), `${link}<img class="hero" width="90" height="30">`);
      expect(runL0(root, { checks: ['image-stretch'] }).checks.map((item) => item.file)).toEqual(['page.html']);
    }
    writeFileSync(
      join(root, 'page.html'),
      '<link href="./other.css" media="(min-width:1000px)"><img class="hero" width="90" height="30">',
    );
    expect(runL0(root, { checks: ['image-stretch'] }).checks.map((item) => item.file)).toEqual(['page.html']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
