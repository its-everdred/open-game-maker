import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import type { AppDeps } from '../../src/app/types.js';
import type { GameRow } from '../../src/games/games.js';
import { issueLiveAccess } from '../../src/previews/live.js';

vi.mock('../../src/gameplay/policy.js', () => ({ paidApisDuringGameplay: () => false }));

it('issues a private capability only for the active ticket and its granted workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'live-access-'));
  try {
    const workspace = join(home, 'workspace');
    const live = join(workspace, 'games/demo/.gm/live');
    const version = '11111111-1111-1111-1111-111111111111';
    await mkdir(join(live, 'versions', version, 'design'), { recursive: true });
    await writeFile(join(live, 'versions', version, 'index.html'), '<title>Demo</title>');
    await writeFile(
      join(live, 'versions', version, 'design/design.json'),
      JSON.stringify({ schemaVersion: 1, globals: {}, entities: {} }),
    );
    await symlink(`versions/${version}`, join(live, 'current'));
    const repo = 'example/games';
    const grantDir = join(home, '.config/ogm/preview-repos', createHash('sha256').update(repo).digest('hex'), 'grants');
    await mkdir(grantDir, { recursive: true });
    await writeFile(join(grantDir, '..', 'secret'), 'fixture-secret');
    await writeFile(
      join(grantDir, `${createHash('sha256').update(workspace).digest('hex')}.json`),
      JSON.stringify({ repo, ticket: '12', game: 'demo', workspace, grant: '11111111-1111-1111-1111-111111111111' }),
    );
    const trackerTicket = vi.fn(async () => ({ ticket: '12', labels: ['game:demo'], closedAt: null }));
    const deps = { config: { gamesRoot: join(home, 'games-root') }, registry: { trackerTicket } } as unknown as AppDeps;
    const game = {
      id: 'demo',
      slug: 'demo',
      githubOwner: 'example',
      githubRepo: 'games',
      githubPath: 'games/demo',
    } as GameRow;
    const access = await issueLiveAccess(deps, game, '12', home);
    expect(access.version).toBe(version);
    expect(JSON.stringify(access)).not.toContain(workspace);
    const record = JSON.parse(
      await readFile(join(deps.config.gamesRoot, '.live/demo', `${access.accessId}.json`), 'utf8'),
    );
    expect(record.root).toBe(live);
    trackerTicket.mockResolvedValueOnce({ ticket: '12', labels: ['game:other'], closedAt: null });
    await expect(issueLiveAccess(deps, game, '12', home)).rejects.toThrow();
    await writeFile(join(live, 'versions', version, 'secret.js'), `const key = "sk-${'a'.repeat(30)}";`);
    await expect(issueLiveAccess(deps, game, '12', home)).rejects.toMatchObject({ status: 422 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
