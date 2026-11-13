import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

describe('gm preview', () => {
  it('builds the current uncommitted workspace and uploads it to the ticket without publishing', async () => {
    const root = tempDir('gm-preview-');
    const game = join(root, 'games', 'blobs');
    const bin = join(root, 'bin');
    mkdirSync(join(game, 'design'), { recursive: true });
    mkdirSync(bin);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
        encoding: 'utf8',
      }).trim();
    git('init', '-q', '-b', 'aiur/42-preview');
    writeFileSync(join(game, 'package.json'), JSON.stringify({ scripts: { build: 'custom' } }));
    writeFileSync(join(game, 'manifest.json'), '{}');
    writeFileSync(join(game, 'design', 'design.json'), '{"base":true}');
    git('add', 'games');
    git('commit', '-qm', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    writeFileSync(join(game, 'current.txt'), 'uncommitted workspace');
    const secretFile = join(root, 'secret');
    writeFileSync(secretFile, 'fixture-secret');
    writeFileSync(
      join(bin, 'pnpm'),
      `#!/bin/sh\nset -eu\ntest -z "\${OGM_HOOK_SECRET_FILE:-}"\nmkdir -p dist/design\ncp current.txt dist/index.html\necho '{}' > dist/manifest.json\necho '{"folded":true}' > dist/design/design.json\necho '{}' > dist/credits.json\n`,
    );
    chmodSync(join(bin, 'pnpm'), 0o755);
    const received: { path?: string; auth?: string; sha?: string; body?: Buffer } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.path = req.url;
        received.auth = req.headers.authorization;
        received.sha = req.headers['x-gm-sha'] as string;
        received.body = Buffer.concat(chunks);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ gameId: 'g_game', buildId: 'preview-123', accessId: 'pv-secret' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await gm(['preview', '--json'], {
        cwd: root,
        env: {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          OGM_INTERNAL_URL: `http://127.0.0.1:${port}`,
          OGM_HOOK_SECRET_FILE: secretFile,
        },
      });
      expect(result.code).toBe(0);
      expect(JSON.stringify(result)).not.toContain('pv-secret');
      expect(received).toMatchObject({ path: '/internal/games/blobs/previews/42', auth: 'Bearer fixture-secret', sha });
      const archive = join(root, 'received.tgz');
      writeFileSync(archive, received.body!);
      expect(execFileSync('tar', ['-xOzf', archive, './index.html'], { encoding: 'utf8' })).toBe(
        'uncommitted workspace',
      );
      expect(JSON.parse(execFileSync('tar', ['-xOzf', archive, './design/design.json'], { encoding: 'utf8' }))).toEqual(
        { folded: true },
      );
      expect(readFileSync(join(game, 'current.txt'), 'utf8')).toBe('uncommitted workspace');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
