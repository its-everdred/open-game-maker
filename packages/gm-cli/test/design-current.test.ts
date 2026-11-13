import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('gm design current', () => {
  it('fetches the latest design for the current ticket without printing its credential', async () => {
    const cwd = tempDir('gm-design-');
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(join(cwd, '.gm/context'), { recursive: true });
    writeFileSync(join(cwd, '.gm/context/ticket'), '12\n');
    const secretFile = join(cwd, 'secret');
    writeFileSync(secretFile, 'example-secret');
    const snapshot = { rev: 2, buildId: null, doc: { schemaVersion: 1, globals: { scenery: 'forest' }, entities: {} } };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const result = await gm(['design', 'current', '--json'], {
      cwd,
      env: { OGM_INTERNAL_URL: 'http://127.0.0.1:1234', OGM_HOOK_SECRET_FILE: secretFile },
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toEqual(snapshot);
    expect(String(request.mock.calls[0]?.[0])).toBe('http://127.0.0.1:1234/internal/jobs/by-ticket/12/design');
    expect(result.out.join(' ')).not.toContain('example-secret');
  });

  it('fails closed for an invalid ticket instead of fetching an arbitrary path', async () => {
    const cwd = tempDir('gm-design-');
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(join(cwd, '.gm/context'), { recursive: true });
    writeFileSync(join(cwd, '.gm/context/ticket'), '../other');
    const secretFile = join(cwd, 'secret');
    writeFileSync(secretFile, 'example-secret');
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const result = await gm(['design', 'current', '--json'], {
      cwd,
      env: { OGM_INTERNAL_URL: 'http://127.0.0.1:1234', OGM_HOOK_SECRET_FILE: secretFile },
    });
    expect(result.code).not.toBe(0);
    expect(result.err.join(' ')).toContain('ticket identifier');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not fall back to stale data when the service returns malformed data', async () => {
    const cwd = tempDir('gm-design-');
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(join(cwd, '.gm/context'), { recursive: true });
    writeFileSync(join(cwd, '.gm/context/ticket'), '12');
    writeFileSync(
      join(cwd, '.gm/context/design.json'),
      JSON.stringify({ rev: 1, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } }),
    );
    const secretFile = join(cwd, 'secret');
    writeFileSync(secretFile, 'example-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad data', { status: 200 })));
    const result = await gm(['design', 'current', '--json'], {
      cwd,
      env: { OGM_INTERNAL_URL: 'http://127.0.0.1:1234', OGM_HOOK_SECRET_FILE: secretFile },
    });
    expect(result.code).toBe(1);
    expect(result.err.join(' ')).toContain('returned invalid data');
    expect(result.out).toEqual([]);
  });
});
