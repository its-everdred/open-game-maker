import { lstat, mkdir, readFile, readlink, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { renderDaemonFiles } from '@ogm/game-repo-template';

import { IDLE_STOP_MS } from '../../src/fleet/fleet.js';
import { READY_TIMEOUT_MS, START_POLL_MS } from '../../src/fleet/health.js';
import { daemonPaths, writeAtomic } from '../../src/fleet/secrets.js';
import { preflight as realPreflight } from '../../src/policy/preflight.js';
import { buildFleet, cleanupHomes, fakeFetch, liveRow, memoryStore, systemctlCalls, tempHome } from './helpers.js';

afterEach(cleanupHomes);

// One instance repository holds every game; a daemon is keyed by the game's own slug.
const repo = 'everdred-games/instance';
const slug = 'castle-run';
const okPreflight = async () => ({ ok: true as const });

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe('ensureDaemon', () => {
  it('renders the directory, writes 0600 secrets, mints two tokens, starts the unit and polls health to running', async () => {
    const home = await tempHome();
    const preflight = vi.fn(async () => ({ ok: true as const }));
    const { fleet, store, runner, fetch, sleeps } = buildFleet(home, { fetch: fakeFetch([503, 503, 200]), preflight });

    const result = await fleet.ensureDaemon({ slug, repo }, 'feature');

    expect(result).toMatchObject({ status: 'running', daemon: { port: 4101, clientToken: 'aiur_token1' } });
    const dir = join(home, '.local/share/ogm/daemons', slug);
    const config = parse(await readFile(join(dir, '.aiur/config'), 'utf8'));
    expect(config.tracker.github.repo).toBe(repo);
    expect(config.tracker.github.label_prefix).toBe(slug);
    expect(config.server).toMatchObject({ host: '127.0.0.1', port: 4101 });
    expect(config.instance.id).toBe(slug);
    expect(await readFile(join(dir, '.aiur/hooks'), 'utf8')).toBe(renderDaemonFiles({ gameSlug: slug }).hooks);
    expect(await readFile(join(dir, '.aiur/prompt.md'), 'utf8')).toBe(renderDaemonFiles({ gameSlug: slug }).prompt);
    expect((await stat(join(dir, 'workspaces'))).isDirectory()).toBe(true);

    const envFile = join(home, '.config/ogm/env', `ogm-aiur@${slug}.env`);
    expect(await mode(envFile)).toBe(0o600);
    for (const name of ['client-token', 'read-token', 'hook-secret']) {
      expect(await mode(join(home, '.config/ogm/daemons', slug, name))).toBe(0o600);
    }
    expect((await readFile(join(home, '.config/ogm/daemons', slug, 'read-token'), 'utf8')).trim()).toBe('aiur_token2');

    expect(preflight).toHaveBeenCalledWith(dir, expect.objectContaining({ repo, port: 4101 }));
    const tokenCalls = runner.calls.filter((call) => call.args[0] === 'token' && call.args[1] === 'create');
    expect(tokenCalls.map((call) => [call.args.slice(2), call.cwd])).toEqual([
      [['ogm-api', '--scope', 'write'], dir],
      [['operator', '--scope', 'read'], dir],
    ]);
    expect(systemctlCalls(runner)).toEqual([`--user start ogm-aiur@${slug}.service`]);
    expect(fetch.urls).toEqual(Array(3).fill('http://127.0.0.1:4101/healthz'));
    expect(sleeps).toEqual([START_POLL_MS, START_POLL_MS]);
    expect(store.rows.get(slug)?.status).toBe('running');
    expect(JSON.stringify([...store.rows.values()])).not.toContain('aiur_token');
  });

  it('starts nothing when preflight fails and stores the reasons on the row', async () => {
    const home = await tempHome();
    const preflight = async () => ({ ok: false as const, reasons: ['config drift: agent.codex'] });
    const { fleet, store, runner } = buildFleet(home, { preflight });

    const result = await fleet.ensureDaemon({ slug, repo }, 'feature');

    expect(result).toEqual({ status: 'stopped', reasons: ['config drift: agent.codex'] });
    expect(systemctlCalls(runner)).toEqual([]);
    expect(runner.calls).toEqual([]);
    expect(store.rows.get(slug)).toMatchObject({ status: 'stopped', lastError: 'config drift: agent.codex' });
  });

  it('runs the real preflight against the rendered files', async () => {
    const home = await tempHome();
    const { fleet } = buildFleet(home);

    await expect(fleet.ensureDaemon({ slug, repo }, 'feature')).resolves.toMatchObject({ status: 'running' });
  });

  it('isolates daemon Codex homes and refreshes every live profile when membership changes', async () => {
    const home = await tempHome();
    const preflight = vi.fn(realPreflight);
    const { fleet, store, runner } = buildFleet(home, {
      preflight,
      jobs: { alpha: ['feature'], charlie: ['feature'] },
    });
    const games = ['alpha', 'bravo', 'charlie'];

    for (const game of games) {
      await expect(fleet.ensureDaemon({ slug: game, repo }, 'feature')).resolves.toMatchObject({ status: 'running' });
    }

    const sharedAuth = join(home, '.config/ogm/codex-gamebuilder/auth.json');
    for (const game of games) {
      const codexHome = join(home, '.config/ogm/codex', game);
      const profile = await readFile(join(codexHome, 'config.toml'), 'utf8');
      const daemonDir = join(home, '.local/share/ogm/daemons', game);
      const config = parse(await readFile(join(daemonDir, '.aiur/config'), 'utf8'));
      const envFile = await readFile(join(home, '.config/ogm/env', `ogm-aiur@${game}.env`), 'utf8');

      expect(config.agent.accounts.codex).toEqual([]);
      expect(envFile).toContain(`CODEX_HOME=${codexHome}\n`);
      expect((await lstat(join(codexHome, 'auth.json'))).isSymbolicLink()).toBe(true);
      expect(await readlink(join(codexHome, 'auth.json'))).toBe(sharedAuth);
      for (const other of games.filter((other) => other !== game)) {
        expect(profile).toContain(join(home, '.local/share/ogm/daemons', other, 'workspaces'));
      }
    }

    expect(preflight).toHaveBeenCalledTimes(6);
    expect(new Set(preflight.mock.calls.slice(-3).map(([daemonDir]) => daemonDir))).toEqual(
      new Set(games.map((game) => join(home, '.local/share/ogm/daemons', game))),
    );

    await store.update('bravo', {
      status: 'idle',
      idleSince: new Date(Date.now() - IDLE_STOP_MS).toISOString(),
    });
    await expect(fleet.stopIdleDaemons()).resolves.toEqual(['bravo']);

    expect(preflight).toHaveBeenCalledTimes(8);
    expect(new Set(preflight.mock.calls.slice(-2).map(([daemonDir]) => daemonDir))).toEqual(
      new Set(['alpha', 'charlie'].map((game) => join(home, '.local/share/ogm/daemons', game))),
    );
    expect(store.rows.get('alpha')?.status).toBe('running');
    expect(store.rows.get('charlie')?.status).toBe('running');
    expect(systemctlCalls(runner).filter((call) => call.includes('@alpha') || call.includes('@charlie'))).toEqual([
      '--user start ogm-aiur@alpha.service',
      '--user start ogm-aiur@charlie.service',
    ]);
  });

  it('fails closed when a live peer cannot pass membership refresh preflight', async () => {
    const home = await tempHome();
    const { fleet, runner } = buildFleet(home);

    await expect(fleet.ensureDaemon({ slug: 'alpha', repo }, 'feature')).resolves.toMatchObject({ status: 'running' });
    await expect(fleet.ensureDaemon({ slug: 'bravo', repo }, 'feature')).resolves.toMatchObject({ status: 'running' });
    await rm(join(home, '.local/share/ogm/daemons/alpha/.aiur/config'));

    await expect(fleet.ensureDaemon({ slug: 'charlie', repo }, 'feature')).resolves.toEqual({
      status: 'stopped',
      reasons: ['alpha: missing .aiur/config'],
    });
    expect(systemctlCalls(runner)).not.toContain('--user start ogm-aiur@charlie.service');
  });

  it('refuses a fifth daemon with waiting_capacity while four are live, without touching systemd', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1), liveRow(2, 'idle'), liveRow(3), liveRow(4)]);
    const { fleet, runner } = buildFleet(home, { store });

    await expect(fleet.ensureDaemon({ slug, repo }, 'feature')).resolves.toEqual({
      status: 'waiting_capacity',
      live: 4,
    });
    expect(runner.calls).toEqual([]);
  });

  it('holds the cap when several games are admitted at once', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1), liveRow(2), liveRow(3)]);
    const { fleet } = buildFleet(home, { store, preflight: okPreflight });

    const results = await Promise.all(
      ['a', 'b', 'c'].map((game) => fleet.ensureDaemon({ slug: game, repo }, 'feature')),
    );

    expect(results.map((result) => result.status).sort()).toEqual(['running', 'waiting_capacity', 'waiting_capacity']);
    expect(new Set([...store.rows.values()].map((row) => row.port)).size).toBe(store.rows.size);
  });

  it('does not count a starting row left by a previous process, and frees it on the idle sweep', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1), liveRow(2), liveRow(3), liveRow(4, 'starting')]);
    const { fleet, runner } = buildFleet(home, { store, preflight: okPreflight });

    await expect(fleet.ensureDaemon({ slug, repo }, 'feature')).resolves.toMatchObject({ status: 'running' });
    await expect(fleet.stopIdleDaemons()).resolves.toContain('owner-game4');
    expect(systemctlCalls(runner)).toContain('--user stop ogm-aiur@owner-game4.service');
    expect(store.rows.get('owner-game4')?.status).toBe('stopped');
  });

  it('normalises a game slug to lower case and looks the daemon up by it', async () => {
    const home = await tempHome();
    const { fleet, store } = buildFleet(home);

    await fleet.ensureDaemon({ slug: 'My-Game', repo: 'Owner/Instance' }, 'feature');
    await expect(fleet.daemonFor('MY-GAME')).resolves.toMatchObject({ daemon: { port: 4101 } });

    expect([...store.rows.keys()]).toEqual(['my-game']);
    expect(store.rows.get('my-game')?.repo).toBe('owner/instance');
  });

  it('starts a daemon when three are live and a fourth is stopped', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1), liveRow(2), liveRow(3), liveRow(4, 'stopped')]);
    const { fleet } = buildFleet(home, { store, preflight: okPreflight });

    await expect(fleet.ensureDaemon({ slug, repo }, 'feature')).resolves.toMatchObject({
      status: 'running',
      daemon: { port: 4105 },
    });
  });

  it('wakes an idle daemon for a new job without starting another unit', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1, 'idle', { idleSince: '2026-11-01T00:00:00.000Z' })]);
    const { fleet, runner } = buildFleet(home, { store });

    await expect(fleet.ensureDaemon({ slug: 'owner-game1', repo: 'owner/game1' }, 'feature')).resolves.toMatchObject({
      status: 'running',
    });
    expect(runner.calls).toEqual([]);
    expect(store.rows.get('owner-game1')).toMatchObject({ status: 'running', idleSince: null });
  });

  it('allows two agents only when a creation and an edit are admitted on the same repo', async () => {
    const home = await tempHome();
    const { fleet, store, jobs } = buildFleet(home);

    await fleet.ensureDaemon({ slug, repo }, 'new_game');
    expect(store.rows.get(slug)?.maxConcurrentAgents).toBe(1);

    jobs[slug] = ['new_game'];
    await fleet.ensureDaemon({ slug, repo }, 'feature');
    expect(store.rows.get(slug)?.maxConcurrentAgents).toBe(2);
    const config = parse(await readFile(join(home, '.local/share/ogm/daemons', slug, '.aiur/config'), 'utf8'));
    expect(config.agent.max_concurrent_agents).toBe(2);
  });

  it('restarts once when health never answers, then stops the unit and records the error', async () => {
    const home = await tempHome();
    const { fleet, store, runner, alerts } = buildFleet(home, { fetch: fakeFetch([503]) });

    const result = await fleet.ensureDaemon({ slug, repo }, 'feature');

    expect(result).toMatchObject({ status: 'stopped' });
    expect(systemctlCalls(runner)).toEqual([
      `--user start ogm-aiur@${slug}.service`,
      `--user restart ogm-aiur@${slug}.service`,
      `--user stop ogm-aiur@${slug}.service`,
    ]);
    expect(store.rows.get(slug)?.status).toBe('stopped');
    expect(store.rows.get(slug)?.lastError).toContain('healthz');
    expect(alerts).toHaveLength(1);
  });

  it('reaches running when the daemon answers after its one restart', async () => {
    const home = await tempHome();
    const firstWindow = READY_TIMEOUT_MS / START_POLL_MS + 1;
    const { fleet, runner } = buildFleet(home, { fetch: fakeFetch([...Array(firstWindow).fill(503), 200]) });

    await expect(fleet.ensureDaemon({ slug, repo }, 'feature')).resolves.toMatchObject({ status: 'running' });
    expect(systemctlCalls(runner)).toEqual([
      `--user start ogm-aiur@${slug}.service`,
      `--user restart ogm-aiur@${slug}.service`,
    ]);
  });

  it('refuses to start when the builder bot token is missing, naming the variable only', async () => {
    const home = await tempHome();
    const { fleet, runner } = buildFleet(home, {
      env: { ...(await import('./helpers.js')).fleetEnv(home), builderBotToken: undefined },
    });

    await expect(fleet.ensureDaemon({ slug, repo }, 'feature')).resolves.toEqual({
      status: 'stopped',
      reasons: ['OGM_BUILDER_BOT_TOKEN is not set'],
    });
    expect(runner.calls).toEqual([]);
  });
});

describe('stopIdleDaemons', () => {
  const at = new Date('2026-11-01T12:00:00.000Z');
  const ago = (ms: number) => new Date(at.getTime() - ms).toISOString();

  it('stops only daemons idle for at least 30 minutes with no active job', async () => {
    const home = await tempHome();
    const store = memoryStore([
      liveRow(1, 'idle', { idleSince: ago(31 * 60_000) }),
      liveRow(2, 'idle', { idleSince: ago(31 * 60_000) }),
      liveRow(3, 'idle', { idleSince: ago(IDLE_STOP_MS - 60_000) }),
      liveRow(4, 'running'),
    ]);
    const { fleet, runner } = buildFleet(home, {
      store,
      jobs: { 'owner-game2': ['feature'] },
      preflight: okPreflight,
    });

    await expect(fleet.stopIdleDaemons(at)).resolves.toEqual(['owner-game1']);
    expect(systemctlCalls(runner)).toEqual(['--user stop ogm-aiur@owner-game1.service']);
    expect(store.rows.get('owner-game1')?.status).toBe('stopped');
    expect(store.rows.get('owner-game2')).toMatchObject({ status: 'running', idleSince: null });
    expect(store.rows.get('owner-game3')?.status).toBe('idle');
    expect(store.rows.get('owner-game4')).toMatchObject({ status: 'idle', idleSince: at.toISOString() });
  });

  it('keeps the workspaces directory when it stops a daemon', async () => {
    const home = await tempHome();
    const { fleet, store } = buildFleet(home);
    await fleet.ensureDaemon({ slug, repo }, 'feature');
    await store.update(slug, { status: 'idle', idleSince: ago(IDLE_STOP_MS) });

    await fleet.stopIdleDaemons(at);

    expect((await stat(join(home, '.local/share/ogm/daemons', slug, 'workspaces'))).isDirectory()).toBe(true);
  });
});

describe('checkHealth', () => {
  it('restarts after three misses and stops with an alert after six', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1)]);
    const { fleet, runner, alerts } = buildFleet(home, { store, fetch: fakeFetch([503]) });

    for (let tick = 0; tick < 3; tick += 1) await fleet.checkHealth();
    expect(systemctlCalls(runner)).toEqual(['--user restart ogm-aiur@owner-game1.service']);

    for (let tick = 0; tick < 3; tick += 1) await fleet.checkHealth();
    expect(systemctlCalls(runner)).toEqual([
      '--user restart ogm-aiur@owner-game1.service',
      '--user stop ogm-aiur@owner-game1.service',
    ]);
    expect(store.rows.get('owner-game1')?.status).toBe('stopped');
    expect(alerts).toHaveLength(2);
  });
});

describe('daemonFor and listDaemons', () => {
  it('isolates unreadable read tokens and resumes the daemon after recovery', async () => {
    const home = await tempHome();
    const rows = [liveRow(1), liveRow(2)];
    const store = memoryStore(rows);
    const statuses: { daemon: string; missing: boolean }[] = [];
    const broken = daemonPaths(home, rows[0].slug);
    for (const row of rows) {
      const paths = daemonPaths(home, row.slug);
      await writeAtomic(paths.clientToken, 'client-token\n', 0o600);
      await writeAtomic(paths.readToken, 'read-token\n', 0o600);
    }
    await rm(broken.readToken);
    await mkdir(broken.readToken);
    const { fleet } = buildFleet(home, {
      store,
      readTokenStatus: (daemon: string, missing: boolean) => statuses.push({ daemon, missing }),
    });
    const poll = () => Promise.all(rows.map((row) => fleet.daemonFor(row.slug)));

    for (let tick = 0; tick < 2; tick += 1) {
      await expect(poll()).resolves.toEqual([null, expect.objectContaining({ daemon: expect.any(Object) })]);
    }
    expect(statuses).toEqual([{ daemon: rows[0].slug, missing: true }]);

    await rm(broken.readToken, { recursive: true });
    await writeAtomic(broken.readToken, 'recovered-read-token\n', 0o600);
    for (let tick = 0; tick < 2; tick += 1) {
      const daemons = await poll();
      expect(daemons.every((daemon) => daemon !== null)).toBe(true);
    }
    expect(statuses).toEqual([
      { daemon: rows[0].slug, missing: true },
      { daemon: rows[0].slug, missing: false },
    ]);
  });

  it('reports read-token state changes once and withholds an unsupervised client', async () => {
    const home = await tempHome();
    const store = memoryStore([liveRow(1)]);
    const statuses: { daemon: string; missing: boolean }[] = [];
    const { clientToken, readToken } = daemonPaths(home, 'owner-game1');
    await writeAtomic(clientToken, 'client-token\n', 0o600);
    const { fleet } = buildFleet(home, {
      store,
      readTokenStatus: (daemon: string, missing: boolean) => statuses.push({ daemon, missing }),
    });

    await expect(fleet.daemonFor('owner-game1')).resolves.toBeNull();
    await expect(fleet.daemonFor('owner-game1')).resolves.toBeNull();
    await writeAtomic(readToken, 'read-token\n', 0o600);
    await expect(fleet.daemonFor('owner-game1')).resolves.not.toBeNull();
    await expect(fleet.daemonFor('owner-game1')).resolves.not.toBeNull();

    expect(statuses).toEqual([
      { daemon: 'owner-game1', missing: true },
      { daemon: 'owner-game1', missing: false },
    ]);
  });

  it('returns a client for a running daemon and nothing for an unknown game', async () => {
    const home = await tempHome();
    const { fleet } = buildFleet(home);
    await fleet.ensureDaemon({ slug, repo }, 'feature');

    const found = await fleet.daemonFor(slug);
    expect(found?.client.baseUrl).toBe('http://127.0.0.1:4101');
    expect(found?.daemon.clientToken).toBe('aiur_token1');
    await expect(fleet.daemonFor('no-such-game')).resolves.toBeNull();
    await expect(fleet.listDaemons('running')).resolves.toHaveLength(1);
    await expect(fleet.listDaemons('stopped')).resolves.toHaveLength(0);
  });
});
