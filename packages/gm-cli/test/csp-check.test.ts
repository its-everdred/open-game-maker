import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cspProblemsInCss, cspProblemsInHtml } from '../src/csp-check.js';
import { checkPublishDist } from '../src/dist-validation.js';

/** A complete dist whose index.html the test chooses. */
function dist(indexHtml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gm-csp-'));
  mkdirSync(join(dir, 'design'));
  for (const file of ['manifest.json', 'design/design.json', 'credits.json']) writeFileSync(join(dir, file), '{}');
  writeFileSync(join(dir, 'index.html'), indexHtml);
  return dir;
}

describe('the games host CSP check on a built dist', () => {
  // RestoreBound before Open-Games #920: the page script was inline, so prod never wired TAP TO PLAY.
  it('refuses to publish a page whose start-up script is inline', () => {
    const problems = checkPublishDist(
      dist('<body><button id="start">TAP TO PLAY</button><script>start.onclick = () => go();</script></body>'),
    );
    expect(problems).toEqual(["dist/index.html has an inline <script>, which the games host's CSP blocks"]);
  });

  it('passes a vite build that loads only its own files', () => {
    expect(
      checkPublishDist(
        dist(
          '<head><link rel="stylesheet" href="./assets/a.css"><script type="module" crossorigin src="./assets/a.js"></script></head>' +
            '<body style="margin:0"><script type="application/json" id="data">{"a":1}</script><a href="https://example.com">x</a></body>',
        ),
      ),
    ).toEqual([]);
  });

  it('checks every HTML page in the dist, not only index.html', () => {
    const dir = dist('<script src="./a.js"></script>');
    mkdirSync(join(dir, 'help'));
    writeFileSync(join(dir, 'help/page.html'), '<button onclick="back()">Back</button>');
    expect(checkPublishDist(dir)).toEqual([
      "dist/help/page.html has an inline onclick handler on <button>, which the games host's CSP blocks",
    ]);
  });

  it.each([
    ['<button onClick="go()">', 'an inline onclick handler on <button>'],
    ['<a href=" javascript:go()">', 'a javascript: URL on <a>'],
    ['<script type="module">go()</script>', 'an inline <script>'],
    ['<script type="importmap">{"imports":{}}</script>', 'an inline <script>'],
    [
      '<script src="https://cdn.example/x.js"></script>',
      '<script> loading https://cdn.example/x.js from another origin',
    ],
    [
      '<link rel="stylesheet" href="//fonts.example/f.css">',
      '<link> loading //fonts.example/f.css from another origin',
    ],
    ['<img src="http://example.com/a.png">', '<img> loading http://example.com/a.png from another origin'],
    ['<iframe src="./other.html"></iframe>', 'an <iframe>'],
    [
      '<img srcset="./a.png 1x, https://cdn.example/b.png 2x">',
      '<img> loading https://cdn.example/b.png from another origin',
    ],
    ['<video poster="//cdn.example/p.jpg"></video>', '<video> loading //cdn.example/p.jpg from another origin'],
  ])('flags %s', (html, problem) => {
    expect(cspProblemsInHtml(html)).toEqual([problem]);
  });

  it.each([
    ['handler text inside a comment', '<!-- <button onclick="go()"> -->'],
    ['handler text inside a script file body', '<script src="./a.js">/* onclick= */</script>'],
    ['an empty inline script', '<script>  </script>'],
    ['a data URL image', '<img src="data:image/png;base64,AAAA">'],
    ['an off-origin link that loads nothing', '<link rel="canonical" href="https://example.com/">'],
    ['a handler-like word in an attribute value', '<div title="on=1 onclick=go()">'],
  ])('allows %s', (_name, html) => {
    expect(cspProblemsInHtml(html)).toEqual([]);
  });

  it('checks stylesheets for off-origin fonts and imports, but not their own files', () => {
    expect(
      cspProblemsInCss(
        "@import 'https://fonts.example/a.css'; @font-face { src: url(https://fonts.example/f.woff2) }" +
          ' .a { background: url("./bg.png") } .b { background: url(data:image/png;base64,AA) } /* url(https://x.example/c) */',
      ),
    ).toEqual([
      'a stylesheet load of https://fonts.example/a.css from another origin',
      'a stylesheet load of https://fonts.example/f.woff2 from another origin',
    ]);
    const dir = dist('<link rel="stylesheet" href="./assets/a.css">');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/a.css'), 'body { font-family: x; src: url(//fonts.example/x.woff2) }');
    expect(checkPublishDist(dir)).toEqual([
      "dist/assets/a.css has a stylesheet load of //fonts.example/x.woff2 from another origin, which the games host's CSP blocks",
    ]);
  });
});
