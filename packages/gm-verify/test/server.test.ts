import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { serveStatic } from '../src/server.js';

describe('serveStatic', () => {
  it('drops a response for an unreadable file and keeps serving', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-serve-'));
    writeFileSync(join(root, 'index.html'), '<p>game</p>');
    writeFileSync(join(root, 'locked.js'), 'x');
    chmodSync(join(root, 'locked.js'), 0o000);
    const server = await serveStatic(root);
    try {
      await fetch(new URL('locked.js', server.url))
        .then((r) => r.text())
        .catch(() => '');
      expect(await (await fetch(server.url)).text()).toBe('<p>game</p>');
    } finally {
      await server.close();
    }
  });
});

describe('serveStatic for a game', () => {
  it("sends the games host's CSP and headers with game files, and none with other files", async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-serve-'));
    writeFileSync(join(root, 'index.html'), '<p>game</p>');
    const game = await serveStatic(root, { game: true });
    const plain = await serveStatic(root);
    try {
      const headers = (await fetch(game.url)).headers;
      expect(headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(headers.get('content-security-policy')).toContain('frame-ancestors http://127.0.0.1:*');
      expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect((await fetch(new URL('game-cache.js', game.url))).headers.get('content-security-policy')).toBeTruthy();
      expect((await fetch(plain.url)).headers.get('content-security-policy')).toBeNull();
    } finally {
      await game.close();
      await plain.close();
    }
  });
});
