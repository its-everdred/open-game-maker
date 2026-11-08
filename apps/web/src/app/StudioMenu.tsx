import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, matchPath, useLocation } from 'react-router';

import { JOB_STAGE_WORDS, type Job } from '@ogm/contracts/browser';

import { Icon } from '../components/Icon';
import { BugButton } from '../features/bug-report';
import { EnergyButton, EnergyDetail } from '../features/energy/EnergyButton';
import { JobConversationModal } from '../features/build-chat/JobConversationModal';
import { openConversation } from '../features/build-chat/conversation';
import { isTerminal, useMyJobs } from '../features/build-chat/jobs';
import { signOut } from '../lib/api/auth';
import { useSession } from '../lib/api/session';
import { getVolume, onChange, setMuted, setVolume, status } from '../lib/sound';
import { useAdminMe } from '../routes/admin/api';
import { requireAdmin } from '../routes/admin/guard';

const RECENT_BUILD_MS = 5 * 60 * 1000;
const MAX_TRACKED_BUILDS = 100;
const activeBuildsByCreator = new Map<string, Set<string>>();

export function StudioMenu() {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const { data: session } = useSession();
  const creatorId = session?.user.id;
  const admin = useAdminMe(Boolean(session));
  const builds = useMyJobs();
  const sound = useSyncExternalStore(onChange, status);
  const [open, setOpen] = useState(false);
  const [volume, setLocalVolume] = useState(getVolume);
  const [announcement, setAnnouncement] = useState('');
  const [buildClock, setBuildClock] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [energyOpen, setEnergyOpen] = useState(false);
  const game = matchPath('/g/:gameId/*', location.pathname);
  const gameId = game?.params.gameId;
  const gameTitles = useMemo(() => new Map(builds.games.map(({ id, title }) => [id, title])), [builds.games]);
  const visibleBuilds = useMemo(() => recentBuilds(builds.jobs), [builds.jobs, buildClock]);
  const buildGroups = useMemo(() => groupBuilds(visibleBuilds, gameTitles), [gameTitles, visibleBuilds]);
  const buildingJobs = useMemo(() => builds.jobs.filter(isBuilding), [builds.jobs]);
  const outstandingRequests = visibleBuilds.reduce((total, job) => total + (job.openRequestCount ?? 0), 0);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useEffect(() => {
    if (!creatorId) return;
    const messages = buildAnnouncements(creatorId, builds.jobs, buildingJobs, gameTitles);
    if (messages.length > 0) setAnnouncement(messages.join('. '));
  }, [buildingJobs, builds.jobs, creatorId, gameTitles]);

  useEffect(() => {
    const nextExpiry = nextRecentBuildExpiry(builds.jobs);
    if (nextExpiry === undefined) return;
    const timer = window.setTimeout(
      () => setBuildClock((current) => current + 1),
      Math.max(0, nextExpiry - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [buildClock, builds.jobs]);

  const changeVolume = (next: number) => {
    setLocalVolume(next);
    setVolume(next);
  };
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setAnnouncement('Sign out failed. Try again.');
      setSigningOut(false);
    }
  };
  const close = () => setOpen(false);
  const gamePath = gameId === undefined ? undefined : `/g/${encodeURIComponent(gameId)}`;

  return (
    <div ref={root} className="studio-menu-control">
      <button
        ref={trigger}
        type="button"
        className="studio-menu-button"
        data-building={buildingJobs.length > 0}
        aria-label="Menu"
        aria-describedby={outstandingRequests > 0 ? 'studio-menu-requests' : undefined}
        aria-expanded={open}
        aria-controls="studio-menu-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="studio-menu-ring" aria-hidden="true" />
        <Icon name="menu" />
        {outstandingRequests > 0 ? (
          <span className="studio-menu-badge" aria-hidden="true">
            {outstandingRequests}
          </span>
        ) : null}
      </button>
      {outstandingRequests > 0 ? (
        <span id="studio-menu-requests" className="sr">
          {outstandingRequests} {outstandingRequests === 1 ? 'request needs' : 'requests need'} your attention
        </span>
      ) : null}
      <span className="sr" role="status" aria-live="polite">
        {announcement}
      </span>
      {open ? (
        <div id="studio-menu-panel" className="studio-menu-panel" role="dialog" aria-label="Menu">
          <div className="studio-menu-volume">
            <button
              type="button"
              className="studio-menu-action"
              aria-label={sound === 'on' ? 'Mute' : 'Unmute'}
              onClick={() => setMuted(sound === 'on')}
            >
              <Icon name={sound === 'on' ? 'soundOn' : 'soundOff'} />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              aria-label="Volume"
              value={volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
            />
          </div>

          <BugButton />

          {buildGroups.length > 0 ? (
            <ul className="studio-menu-builds" aria-label="Build progress">
              {buildGroups.map((group) => (
                <li key={group.gameId}>
                  <div className="studio-menu-build-group" role="group" aria-label={`${group.title} builds`}>
                    <div className="studio-menu-build-heading">
                      <strong>{group.title}</strong>
                      {group.playable ? (
                        <Link to={buildPath(group.playable)} onClick={close}>
                          Ready to try
                        </Link>
                      ) : null}
                    </div>
                    <ul>
                      {group.jobs.map((job) => {
                        const state = menuJobState(job);
                        const percent = buildPercent(job);
                        return (
                          <li key={job.id}>
                            <button
                              className="studio-menu-job"
                              data-status={state}
                              data-success={job.state === 'done'}
                              data-action-needed={(job.openRequestCount ?? 0) > 0}
                              type="button"
                              onClick={() => {
                                close();
                                openConversation(job.id);
                              }}
                            >
                              <strong>{job.plan.title}</strong>
                              <span className="studio-menu-job-state">{menuJobStateLabel(state)}</span>
                              <span className="studio-menu-job-stage">{buildStage(job)}</span>
                              <span className="studio-menu-job-percent">{percent}%</span>
                              <span className="studio-menu-job-progress" aria-hidden="true">
                                <span style={{ width: `${percent}%` }} />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {gamePath ? (
            <div className="studio-menu-actions">
              <MenuLink label="Versions" icon="versions" to={`${gamePath}/versions`} close={close} />
              <MenuLink label="Publish" icon="publish" to={`${gamePath}/releases?action=publish`} close={close} />
              <MenuLink label="Rollback" icon="rollback" to={`${gamePath}/releases?action=rollback`} close={close} />
            </div>
          ) : null}

          {session ? (
            <div className="studio-menu-actions">
              <EnergyButton open={energyOpen} onToggle={() => setEnergyOpen((current) => !current)} />
              <MenuLink label="Credits" icon="credits" to="/settings/credits" close={close} />
              <button
                type="button"
                className="studio-menu-action"
                aria-label="Sign out"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
              >
                <Icon name="signOut" />
              </button>
              {requireAdmin(admin.data ?? null) === 'ok' ? (
                <MenuLink label="Admin" icon="admin" to="/admin" close={close} />
              ) : null}
            </div>
          ) : null}
          {session && energyOpen ? <EnergyDetail close={close} /> : null}
        </div>
      ) : null}
      <JobConversationModal />
    </div>
  );
}

function MenuLink({ label, icon, to, close }: { label: string; icon: string; to: string; close(): void }) {
  return (
    <Link className="studio-menu-action" aria-label={label} to={to} onClick={close}>
      <Icon name={icon} />
    </Link>
  );
}

function recentBuilds(jobs: readonly Job[], now = Date.now()): Job[] {
  return jobs.filter((job) => {
    if (!isTerminal(job.state)) return true;
    const finishedAt = Date.parse(job.terminalAt ?? job.updatedAt);
    return Number.isFinite(finishedAt) && now - finishedAt <= RECENT_BUILD_MS;
  });
}

type BuildGroup = { gameId: string; title: string; jobs: Job[]; playable?: Job };
type MenuJobState = 'not-started' | 'active' | 'paused' | 'parked' | 'finished';

function groupBuilds(jobs: readonly Job[], names: ReadonlyMap<string, string | undefined>): BuildGroup[] {
  const groups = new Map<string, BuildGroup>();
  for (const job of jobs) {
    const group = groups.get(job.gameId) ?? {
      gameId: job.gameId,
      title: buildName(job, names),
      jobs: [],
    };
    group.jobs.push(job);
    if (job.state === 'done' && job.kind !== 'scope' && group.playable === undefined) group.playable = job;
    groups.set(job.gameId, group);
  }
  return [...groups.values()];
}

function buildPath(job: Job): string {
  return `/g/${encodeURIComponent(job.gameId)}?v=${encodeURIComponent(job.branchId)}`;
}

function menuJobState(job: Job): MenuJobState {
  if (isTerminal(job.state)) return 'finished';
  if (job.stage === 'parked') return 'parked';
  if (job.stage === 'paused' || job.stage === 'out_of_budget') return 'paused';
  if (
    job.state === 'queued' ||
    job.state === 'admitted' ||
    job.state === 'filed' ||
    job.stage === 'queued_ogm' ||
    job.stage === 'waiting_capacity' ||
    job.stage === 'waiting_provider'
  ) {
    return 'not-started';
  }
  return 'active';
}

function isBuilding(job: Job): boolean {
  if (isTerminal(job.state)) return false;
  if (job.stage) return job.stage === 'building' || job.stage === 'final_tests' || job.stage === 'fixing';
  return job.state === 'running';
}

function menuJobStateLabel(state: MenuJobState): string {
  return {
    'not-started': 'Not started',
    active: 'Active',
    paused: 'Paused',
    parked: 'Parked',
    finished: 'Finished',
  }[state];
}

function nextRecentBuildExpiry(jobs: readonly Job[], now = Date.now()): number | undefined {
  const expiries = jobs.flatMap((job) => {
    if (!isTerminal(job.state)) return [];
    const finishedAt = Date.parse(job.terminalAt ?? job.updatedAt);
    const expiry = finishedAt + RECENT_BUILD_MS;
    return Number.isFinite(expiry) && expiry > now ? [expiry] : [];
  });
  return expiries.length > 0 ? Math.min(...expiries) : undefined;
}

function buildAnnouncements(
  creatorId: string,
  jobs: readonly Job[],
  active: readonly Job[],
  names: ReadonlyMap<string, string | undefined>,
): string[] {
  const known = activeBuildsByCreator.get(creatorId) ?? new Set<string>();
  const messages: string[] = [];
  for (const job of active) {
    if (known.has(job.id)) continue;
    known.add(job.id);
    messages.push(`Building ${buildName(job, names)}`);
  }
  for (const job of jobs) {
    if (isTerminal(job.state) && known.delete(job.id)) {
      messages.push(`Finished building ${buildName(job, names)}`);
    }
  }
  while (known.size > MAX_TRACKED_BUILDS) known.delete(known.values().next().value!);
  if (known.size > 0) activeBuildsByCreator.set(creatorId, known);
  else activeBuildsByCreator.delete(creatorId);
  return messages;
}

function buildName(job: Job, names: ReadonlyMap<string, string | undefined>): string {
  return names.get(job.gameId) ?? job.plan.title;
}

function buildStage(job: Job): string {
  if (job.stageText) return job.stageText;
  if (job.stage) return JOB_STAGE_WORDS[job.stage];
  return job.state === 'done' ? 'Ready to try' : 'Building';
}

function buildPercent(job: Job): number {
  return job.state === 'done' ? 100 : (job.progressPercent ?? 0);
}
