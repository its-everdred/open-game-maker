import { createServer } from 'node:net';
import { createAiurClient, type AiurClient } from '@ogm/aiur-client';

import { preflight } from '../policy/preflight.js';
import {
  aiurRoot,
  codexAuthFor,
  gameRepoDaemonFiles,
  materialize,
  materializeCodexHome,
  renderInputFor,
  type DaemonFilesProvider,
} from './daemon-dir.js';
import { createMissCounter, passes, realSleep, waitHealthy, type Sleep } from './health.js';
import { writeRegistry } from './registry.js';
import { daemonPaths, parseEnv, readIfPresent, writeDaemonSecrets } from './secrets.js';
import { createSystemctl, mintTokens, nodeRunner, unitName, type Runner, type Systemctl } from './systemctl.js';
import {
  LIVE_STATUSES,
  MAX_LIVE_DAEMONS,
  assertTransition,
  daemonSlugFor,
  type ActiveJobs,
  type DaemonKey,
  type DaemonRow,
  type DaemonStatus,
  type DaemonStore,
  type FleetEnv,
  type GameDaemon,
  type JobKind,
} from './types.js';

export const FIRST_PORT = 4101;
export const LAST_PORT = 4199;
export const IDLE_STOP_MS = 30 * 60_000;

export type EnsureResult =
  | { status: 'running'; daemon: GameDaemon }
  | { status: 'waiting_capacity'; live: number }
  | { status: 'stopped'; reasons: string[] };

export type FleetDeps = {
  store: DaemonStore;
  activeJobs: ActiveJobs;
  env: FleetEnv;
  runner?: Runner;
  systemctl?: Systemctl;
  files?: DaemonFilesProvider;
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => Date;
  portFree?: (port: number) => Promise<boolean>;
  alert?: (message: string) => void | Promise<void>;
  readTokenStatus?: (daemon: string, missing: boolean) => void;
  preflight?: typeof preflight;
};

export function createFleet(deps: FleetDeps) {
  const { store, activeJobs, env } = deps;
  const runner = deps.runner ?? nodeRunner;
  const systemctl = deps.systemctl ?? createSystemctl(runner);
  const files = deps.files ?? gameRepoDaemonFiles;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => new Date());
  const portFree = deps.portFree ?? probePort;
  const alert = deps.alert ?? (() => undefined);
  const checkPolicy = deps.preflight ?? preflight;
  const misses = createMissCounter();
  const missingReadTokens = new Set<string>();
  const inFlight = new Map<string, Promise<EnsureResult>>();
  // Slugs this process is starting; a stored `starting` row outside this set was left by a previous process.
  const starting = new Set<string>();
  let chain: Promise<unknown> = Promise.resolve();

  class FleetPreflightError extends Error {
    constructor(readonly reasons: string[]) {
      super(reasons.join('; '));
    }
  }

  // Serializes every read-check-write on rows (capacity claims, port allocation, idle stops, health stops).
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn);
    chain = result.catch(() => undefined);
    return result;
  }

  const isStale = (row: DaemonRow) => row.status === 'starting' && !starting.has(row.slug);

  function clientFor(row: DaemonRow, token: string): AiurClient {
    return createAiurClient({ baseUrl: `http://127.0.0.1:${row.port}`, token }, deps.fetch);
  }

  function recordReadTokenStatus(daemon: string, missing: boolean): void {
    if (missing === missingReadTokens.has(daemon)) return;
    if (missing) missingReadTokens.add(daemon);
    else missingReadTokens.delete(daemon);
    deps.readTokenStatus?.(daemon, missing);
  }

  async function supervisedClientFor(row: DaemonRow, token: string): Promise<AiurClient | null> {
    // An unreadable credential makes only this daemon unavailable until the file is repaired.
    const supervisorToken =
      (await readIfPresent(daemonPaths(env.home, row.slug).readToken).catch(() => null))?.trim() ?? '';
    recordReadTokenStatus(row.slug, supervisorToken === '');
    if (supervisorToken === '') return null;
    return createAiurClient({ baseUrl: `http://127.0.0.1:${row.port}`, token, supervisorToken }, deps.fetch);
  }

  async function setStatus(row: DaemonRow, to: DaemonStatus, patch: Partial<DaemonRow> = {}): Promise<DaemonRow> {
    if (row.status !== to) assertTransition(row.status, to);
    return store.update(row.slug, { ...patch, status: to });
  }

  async function allocatePort(rows: DaemonRow[]): Promise<number> {
    const taken = new Set(rows.map((row) => row.port));
    for (let port = Math.max(FIRST_PORT - 1, ...taken) + 1; port <= LAST_PORT; port += 1) {
      if (!taken.has(port) && (await portFree(port))) return port;
    }
    for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
      if (!taken.has(port) && (await portFree(port))) return port;
    }
    throw new Error(`no free daemon port in ${FIRST_PORT}-${LAST_PORT}`);
  }

  // One row per game: the slug is the game's slug and `repo` is the instance repository it lives in.
  async function rowFor(key: DaemonKey): Promise<DaemonRow> {
    const slug = daemonSlugFor(key.slug);
    const repo = key.repo.toLowerCase();
    // A game's daemon row follows its game's repository: when the game moves into the instance repo the row follows
    // it. A daemon that is already live picks the new repo up when it next starts (its config is rendered then).
    const existing = await store.bySlug(slug);
    if (existing) return existing.repo === repo ? existing : store.update(slug, { repo });
    const rows = await store.list();
    const paths = daemonPaths(env.home, slug);
    const row: DaemonRow = {
      slug,
      repo,
      checkoutPath: paths.dir,
      unit: unitName(slug),
      envFile: paths.envFile,
      port: await allocatePort(rows),
      status: 'stopped',
      lastHealthAt: null,
      lastError: null,
      startedAt: null,
      idleSince: null,
      maxConcurrentAgents: 1,
      createdAt: now().toISOString(),
    };
    await store.insert(row);
    return row;
  }

  // 2 agents only when a creation and an edit are both admitted on this repo; admission caps the fleet total.
  function jobShape(kind: JobKind, jobs: { kind: JobKind }[]): { kind: JobKind; max: 1 | 2 } {
    const kinds = new Set([kind, ...jobs.map((job) => job.kind)]);
    const creating = kinds.has('new_game');
    const editing = kinds.has('feature') || kinds.has('repair');
    return { kind: creating ? 'new_game' : kind, max: creating && editing ? 2 : 1 };
  }

  async function render(row: DaemonRow, kind: JobKind, rows: DaemonRow[]) {
    const paths = daemonPaths(env.home, row.slug);
    const input = renderInputFor(row, paths, env, kind, rows);
    await materialize(paths, input, await files(row), codexAuthFor(env));
    return { paths, input };
  }

  async function refreshLiveProfiles(rows: DaemonRow[], currentSlug: string): Promise<void> {
    for (const row of rows) {
      if (!LIVE_STATUSES.includes(row.status)) continue;
      const paths = daemonPaths(env.home, row.slug);
      const input = renderInputFor(row, paths, env, 'feature', rows);
      if (row.slug !== currentSlug) await materializeCodexHome(input, codexAuthFor(env));
      const verdict = await checkPolicy(paths.dir, input);
      if (!verdict.ok) {
        const reasons =
          row.slug === currentSlug ? verdict.reasons : verdict.reasons.map((reason) => `${row.slug}: ${reason}`);
        throw new FleetPreflightError(reasons);
      }
    }
  }

  async function prepare(row: DaemonRow, kind: JobKind) {
    const rows = await store.list();
    const rendered = await render(row, kind, rows);
    await writeDaemonSecrets(rendered.paths, env, rendered.input.codexHome as string);
    await refreshLiveProfiles(rows, row.slug);
    return rendered;
  }

  async function toDaemon(row: DaemonRow): Promise<GameDaemon> {
    const clientToken = (await readIfPresent(daemonPaths(env.home, row.slug).clientToken))?.trim() ?? '';
    return {
      slug: row.slug,
      repo: row.repo,
      checkoutPath: row.checkoutPath,
      unit: row.unit,
      envFile: row.envFile,
      port: row.port,
      clientToken,
      status: row.status,
    };
  }

  async function fail(row: DaemonRow, reasons: string[]): Promise<EnsureResult> {
    await setStatus(row, 'stopped', { lastError: reasons.join('; ') });
    return { status: 'stopped', reasons };
  }

  // `row` is already claimed as `starting`; every exit that does not reach `running` returns it to `stopped`.
  async function start(row: DaemonRow, kind: JobKind): Promise<EnsureResult> {
    let current = row;
    let unitStarted = false;
    try {
      const { paths } = await locked(() => prepare(row, kind));

      unitStarted = true;
      await systemctl.start(row.slug);
      const daemonEnv = parseEnv((await readIfPresent(paths.envFile)) ?? '');
      const { clientToken } = await mintTokens(runner, paths, aiurRoot(env), daemonEnv);
      await writeRegistry(env.home, await store.list());

      const client = clientFor(current, clientToken);
      let healthy = await waitHealthy(() => client.healthz(), sleep);
      if (!healthy) {
        await systemctl.restart(row.slug);
        healthy = await waitHealthy(() => client.healthz(), sleep);
      }
      if (!healthy) {
        await systemctl.stop(row.slug).catch(() => undefined);
        await alert(`${row.unit} did not answer /healthz after a restart`);
        return fail(current, ['healthz did not answer within 120 s after a restart']);
      }

      current = await setStatus(current, 'running', { lastHealthAt: now().toISOString() });
      misses.reset(row.slug);
      return { status: 'running', daemon: await toDaemon(current) };
    } catch (error) {
      if (unitStarted) await systemctl.stop(row.slug).catch(() => undefined);
      return fail(current, error instanceof FleetPreflightError ? error.reasons : [(error as Error).message]);
    }
  }

  type Claim = { done: EnsureResult } | { row: DaemonRow; kind: JobKind };

  async function claim(key: DaemonKey, kind: JobKind): Promise<Claim> {
    let row = await rowFor(key);
    if (isStale(row)) row = await setStatus(row, 'stopped');
    const shape = jobShape(kind, await activeJobs(row.slug));

    if (shape.max !== row.maxConcurrentAgents) {
      row = await store.update(row.slug, { maxConcurrentAgents: shape.max });
      if (LIVE_STATUSES.includes(row.status)) await prepare(row, shape.kind);
    }
    if (row.status === 'running' || row.status === 'idle') {
      row = await setStatus(row, 'running', { idleSince: null });
      return { done: { status: 'running', daemon: await toDaemon(row) } };
    }

    const live = (await store.list()).filter((other) => LIVE_STATUSES.includes(other.status) && !isStale(other));
    if (live.length >= MAX_LIVE_DAEMONS) return { done: { status: 'waiting_capacity', live: live.length } };

    row = await setStatus(row, 'starting', { startedAt: now().toISOString(), lastError: null, idleSince: null });
    starting.add(row.slug);
    return { row, kind: shape.kind };
  }

  async function ensure(key: DaemonKey, kind: JobKind): Promise<EnsureResult> {
    let claimed: Claim;
    try {
      claimed = await locked(() => claim(key, kind));
    } catch (error) {
      return { status: 'stopped', reasons: [(error as Error).message] };
    }
    if ('done' in claimed) return claimed.done;
    try {
      return await start(claimed.row, claimed.kind);
    } finally {
      starting.delete(claimed.row.slug);
    }
  }

  return {
    // Concurrent calls for one game share a single start.
    ensureDaemon(key: DaemonKey, kind: JobKind): Promise<EnsureResult> {
      const slug = key.slug.trim().toLowerCase();
      const pending = inFlight.get(slug);
      if (pending) return pending;
      const promise = ensure({ ...key, slug }, kind).finally(() => inFlight.delete(slug));
      inFlight.set(slug, promise);
      return promise;
    },

    // Provisioning (OGM-036): renders a game's daemon directory and secrets without starting it, so the first
    // `ensureDaemon` only has to start the unit.
    prepareDaemonDir(key: DaemonKey, kind: JobKind): Promise<void> {
      return locked(async () => {
        const row = await rowFor(key);
        const rendered = await render(row, kind, await store.list());
        await writeDaemonSecrets(rendered.paths, env, rendered.input.codexHome as string);
      });
    },

    async daemonFor(gameSlug: string): Promise<{ daemon: GameDaemon; client: AiurClient } | null> {
      const row = await store.bySlug(gameSlug.trim().toLowerCase());
      if (!row || row.status === 'stopped') return null;
      const daemon = await toDaemon(row);
      if (!daemon.clientToken) return null;
      const client = await supervisedClientFor(row, daemon.clientToken);
      return client ? { daemon, client } : null;
    },

    async listDaemons(status?: DaemonStatus): Promise<GameDaemon[]> {
      const rows = (await store.list()).filter((row) => status === undefined || row.status === status);
      return Promise.all(rows.map(toDaemon));
    },

    // Called on an interval by the API. A daemon with no active job turns idle; idle for IDLE_STOP_MS, it stops.
    // A `starting` row no start in this process owns (the API restarted mid-start) is stopped and freed.
    async stopIdleDaemons(at: Date = now()): Promise<string[]> {
      const stopped: string[] = [];
      for (const { slug } of await store.list()) {
        await locked(async () => {
          const row = await store.bySlug(slug);
          if (!row) return;
          if (isStale(row)) {
            await systemctl.stop(row.slug).catch(() => undefined);
            await setStatus(row, 'stopped', { lastError: 'start interrupted by an API restart' });
            await refreshLiveProfiles(await store.list(), row.slug);
            stopped.push(row.slug);
            return;
          }
          if (row.status !== 'running' && row.status !== 'idle') return;

          if ((await activeJobs(row.slug)).length > 0) {
            if (row.status === 'idle') await setStatus(row, 'running', { idleSince: null });
          } else if (row.status === 'running') {
            await setStatus(row, 'idle', { idleSince: at.toISOString() });
          } else if (row.idleSince && at.getTime() - Date.parse(row.idleSince) >= IDLE_STOP_MS) {
            try {
              await systemctl.stop(row.slug);
            } catch (error) {
              await store.update(row.slug, { lastError: (error as Error).message });
              return;
            }
            await setStatus(row, 'stopped', { idleSince: null });
            await refreshLiveProfiles(await store.list(), row.slug);
            stopped.push(row.slug);
          }
        });
      }
      return stopped;
    },

    // Called every RUNNING_POLL_MS by the API: three misses restart the unit, six stop it and alert.
    async checkHealth(): Promise<void> {
      for (const row of await store.list()) {
        if (row.status !== 'running' && row.status !== 'idle') continue;
        const token = (await readIfPresent(daemonPaths(env.home, row.slug).clientToken))?.trim() ?? '';
        const healthy = await passes(() => clientFor(row, token).healthz());
        const verdict = misses.record(row.slug, healthy);
        if (verdict === 'stop') {
          await locked(async () => {
            const current = await store.bySlug(row.slug);
            if (current?.status !== 'running' && current?.status !== 'idle') return;
            await systemctl.stop(row.slug).catch(() => undefined);
            await setStatus(current, 'stopped', { lastError: 'healthz missed six times', idleSince: null });
            await refreshLiveProfiles(await store.list(), row.slug);
            await alert(`${row.unit} stayed unhealthy after a restart and was stopped`);
          });
          continue;
        }

        switch (verdict) {
          case 'ok':
            await store.update(row.slug, { lastHealthAt: now().toISOString() });
            break;
          case 'restart':
            await systemctl.restart(row.slug).catch(() => undefined);
            await alert(`${row.unit} missed three health checks and was restarted`);
            break;
          case 'miss':
            break;
        }
      }
    },
  };
}

export type Fleet = ReturnType<typeof createFleet>;

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
