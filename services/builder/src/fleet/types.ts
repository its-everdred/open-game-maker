export type DaemonStatus = 'stopped' | 'starting' | 'running' | 'idle';
export type JobKind = 'new_game' | 'feature' | 'repair';

// T02 §4 contract; `unit` is `ogm-aiur@<slug>.service` and `checkoutPath` the daemon directory.
// A daemon is keyed by the game it builds (`slug` = the game's slug), not by its repository: every daemon on one
// instance repository shares `repo` and works only its own `games/<slug>/` folder.
export type GameDaemon = {
  slug: string;
  repo: string;
  checkoutPath: string;
  unit: string;
  envFile: string;
  port: number;
  clientToken: string;
  status: DaemonStatus;
};

// The persisted record: GameDaemon minus the token, plus lifecycle bookkeeping.
export type DaemonRow = {
  slug: string;
  repo: string;
  checkoutPath: string;
  unit: string;
  envFile: string;
  port: number;
  status: DaemonStatus;
  lastHealthAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  idleSince: string | null;
  maxConcurrentAgents: 1 | 2;
  createdAt: string;
};

export interface DaemonStore {
  bySlug(slug: string): Promise<DaemonRow | undefined>;
  list(): Promise<DaemonRow[]>;
  insert(row: DaemonRow): Promise<void>;
  update(slug: string, patch: Partial<Omit<DaemonRow, 'slug'>>): Promise<DaemonRow>;
}

// Jobs admitted and not finished (filed, running or paused) for one game's daemon, from OGM-013's jobs table.
export type ActiveJobs = (gameSlug: string) => Promise<{ kind: JobKind }[]>;

export type FleetEnv = {
  home: string;
  builderBotToken: string | undefined;
  builderBotLogin: string;
  intakeLogin: string;
  assetsLocalDir: string;
  aiurRoot?: string;
  apiPort?: number;
  codexHomeRoot?: string;
  codexAuthPath?: string;
};

export const LIVE_STATUSES: readonly DaemonStatus[] = ['starting', 'running', 'idle'];
export const MAX_LIVE_DAEMONS = 4;

// stopped→starting→running→idle→stopped, plus a new job waking an idle daemon and failures exiting to stopped.
const TRANSITIONS: Record<DaemonStatus, readonly DaemonStatus[]> = {
  stopped: ['starting'],
  starting: ['running', 'stopped'],
  running: ['idle', 'stopped'],
  idle: ['running', 'stopped'],
};

export function assertTransition(from: DaemonStatus, to: DaemonStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`daemon status cannot go ${from} -> ${to}`);
  }
}

const MAX_SLUG = 48;
const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A daemon's key, its unit name and its label prefix are all the game's own slug, so the row joins the game row and
// aiur reads `<slug>:todo` on the instance repository. Slugs come from `gm new`, which enforces the same shape.
export function daemonSlugFor(gameSlug: string): string {
  const slug = gameSlug.trim().toLowerCase();
  if (!GAME_SLUG.test(slug)) {
    throw new Error(`game slug "${gameSlug}" cannot key a daemon: use lower-case letters, numbers and single hyphens`);
  }
  if (slug.length > MAX_SLUG) {
    throw new Error(`game slug "${gameSlug}" is longer than ${MAX_SLUG} characters and cannot key a daemon`);
  }
  return slug;
}

// A daemon's target: the game it builds and the instance repository that game lives in.
export type DaemonKey = { slug: string; repo: string };
