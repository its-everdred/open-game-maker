import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IDLE_STOP_MS } from '../../src/fleet/fleet.js';
import { buildFleet, cleanupHomes, fakeFetch, liveRow, memoryStore, systemctlCalls, tempHome } from './helpers.js';

afterEach(cleanupHomes);

const okPreflight = async () => ({ ok: true as const });

// #1270: an operator-registered daemon (open-games, shared by Blobs, Dusk Helm and others) runs from its own checkout
// under its own unit. Stopping it, or marking it stopped, would refuse every game that shares it.
describe('a registered daemon', () => {
  const at = new Date('2026-11-01T12:00:00.000Z');

  it('is never stopped by the idle sweep, however long it has been idle', async () => {
    const home = await tempHome();
    const idleSince = new Date(at.getTime() - IDLE_STOP_MS * 4).toISOString();
    const store = memoryStore([liveRow(1, 'idle', { slug: 'blobs', checkoutPath: join(home, 'og'), idleSince })]);
    const { fleet, runner } = buildFleet(home, { store, preflight: okPreflight });

    await expect(fleet.stopIdleDaemons(at)).resolves.toEqual([]);
    expect(systemctlCalls(runner)).toEqual([]);
    expect(store.rows.get('blobs')).toMatchObject({ status: 'idle', idleSince });
  });

  it('is never restarted or stopped by the health check', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1, 'running', { slug: 'blobs', checkoutPath: join(home, 'og') })]);
    const { fleet, runner, alerts } = buildFleet(home, { store, fetch: fakeFetch([503]) });

    for (let tick = 0; tick < 6; tick += 1) await fleet.checkHealth();

    expect(systemctlCalls(runner)).toEqual([]);
    expect(store.rows.get('blobs')?.status).toBe('running');
    expect(alerts).toEqual([]);
  });

  // Without its own label prefix the fleet cannot know which `<prefix>:todo` label the daemon picks up.
  it('is refused, not guessed, when its config names no label prefix', async () => {
    const home = await tempHome();
    const checkout = join(home, 'og');
    await mkdir(join(checkout, '.aiur'), { recursive: true });
    await writeFile(join(checkout, '.aiur/config'), 'tracker:\n  github:\n    repo: owner/open-games\n');
    const store = memoryStore([
      liveRow(1, 'running', { slug: 'blobs', repo: 'owner/open-games', checkoutPath: checkout }),
    ]);
    const { fleet, runner } = buildFleet(home, { store, preflight: okPreflight });

    await expect(fleet.ensureDaemon({ slug: 'dusk-helm', repo: 'owner/open-games' }, 'feature')).resolves.toEqual({
      status: 'stopped',
      reasons: ['registered daemon blobs has no readable tracker label_prefix'],
    });
    expect(runner.calls).toEqual([]);
  });
});
