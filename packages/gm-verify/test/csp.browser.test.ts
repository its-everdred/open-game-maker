import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runBoot } from '../src/boot.js';
import { runVerify } from '../src/run.js';
import { serveStatic } from '../src/server.js';

const SOFTWARE = process.env.GM_VERIFY_SOFTWARE_GL === '1';

/*
 * The shape of RestoreBound before Open-Games #920: the game boots from its own script file, but the page wiring that
 * makes TAP TO PLAY work is inline. Prod's CSP drops the inline part; the game still reports ready.
 */
function inlineWiredGame(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gm-csp-game-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><canvas id="c" style="position:fixed;inset:0;width:100%;height:100%"></canvas>' +
      '<script src="game.js"></script><script>window.tapToPlay = true;</script>',
  );
  writeFileSync(
    join(dir, 'game.js'),
    `const c = document.getElementById('c');
c.width = 64; c.height = 64;
const g = c.getContext('2d');
for (let i = 0; i < 64; i++) { g.fillStyle = 'hsl(' + i * 5 + ',80%,50%)'; g.fillRect(i, 0, 1, 64); }
window.__gm = { ready: true };`,
  );
  return dir;
}

const runIn = (url: string) =>
  runVerify({
    url,
    outDir: mkdtempSync(join(tmpdir(), 'gm-csp-out-')),
    viewport: 'phone',
    tier: 'mobile',
    software: SOFTWARE,
    frames: [0],
    slots: { runtimeDir: mkdtempSync(join(tmpdir(), 'gm-slots-')) },
    readyTimeoutMs: 20_000,
  });

describe('captures under the games host CSP', () => {
  it('fail a game whose inline script prod refuses, which a header-less server hid', async () => {
    const dir = inlineWiredGame();
    const game = await serveStatic(dir, { game: true });
    const plain = await serveStatic(dir);
    try {
      const refused = await runIn(game.url);
      expect(refused.report.verdict).not.toBe('pass');
      expect(JSON.stringify(refused.report)).toMatch(/CSP violation: script-src-elem blocked inline/);

      const hidden = await runIn(plain.url);
      expect(JSON.stringify(hidden.report)).not.toMatch(/CSP violation/);
    } finally {
      await game.close();
      await plain.close();
    }
  });

  it('fail the boot check on a CSP violation', async () => {
    const game = await serveStatic(inlineWiredGame(), { game: true });
    try {
      const result = await runBoot({
        url: game.url,
        outDir: mkdtempSync(join(tmpdir(), 'gm-csp-boot-')),
        viewports: ['phone'],
        software: SOFTWARE,
        runtimeDir: mkdtempSync(join(tmpdir(), 'gm-slots-')),
      });
      expect(result.ok).toBe(false);
      expect(result.checks[0]?.detail).toMatch(/phone: CSP violation: script-src-elem blocked inline/);
    } finally {
      await game.close();
    }
  });
});
