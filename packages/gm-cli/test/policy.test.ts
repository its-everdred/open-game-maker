import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

function withBundle(paidApisDuringGameplay: boolean): string {
  const cwd = tempDir();
  mkdirSync(join(cwd, '.gm/context'), { recursive: true });
  writeFileSync(join(cwd, '.gm/context/bundle.json'), JSON.stringify({ gameContext: { paidApisDuringGameplay } }));
  return cwd;
}

describe('gm policy', () => {
  // Agents must assume paid APIs are off whenever they cannot see the admin's setting.
  it('says off when nothing tells it otherwise', async () => {
    const { code, out } = await gm(['policy', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toEqual({ paidApisDuringGameplay: false, source: 'default' });
  });

  it("reads the job's bundle", async () => {
    const { out } = await gm(['policy'], { cwd: withBundle(true) });
    expect(out).toEqual(['paid APIs during gameplay: on (bundle)']);
  });

  it('prefers the live setting over a bundle written when the job started', async () => {
    const secretFile = join(tempDir(), 'hook-secret');
    writeFileSync(secretFile, 'daemon-secret\n');
    const server = createServer((request, response) => {
      const ok = request.url === '/internal/gameplay' && request.headers.authorization === 'Bearer daemon-secret';
      response.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      response.end(JSON.stringify(ok ? { paidApisDuringGameplay: false } : {}));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const { out } = await gm(['policy', '--json'], {
        cwd: withBundle(true),
        env: { OGM_INTERNAL_URL: url, OGM_HOOK_SECRET_FILE: secretFile },
      });
      expect(JSON.parse(out[0]!)).toEqual({ paidApisDuringGameplay: false, source: 'live' });
    } finally {
      server.close();
    }
  });
});
