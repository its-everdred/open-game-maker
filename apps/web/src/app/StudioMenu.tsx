import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, matchPath, useLocation } from 'react-router';

import {
  JOB_STAGE_WORDS,
  type CreatorCommand,
  type Job,
  type QuestionSession as QueuedSession,
} from '@ogm/contracts/browser';

import { Icon } from '../components/Icon';
import { MenuRing } from '../components/MenuCircle';
import { BugButton, BugSheet, useBugDraft } from '../features/bug-report';
import { EnergyButton, EnergyDetail } from '../features/energy/EnergyButton';
import { JobConversationModal } from '../features/build-chat/JobConversationModal';
import { openConversation } from '../features/build-chat/conversation';
import { resetReviewDrafts } from '../features/commands-inbox/drafts';
import { isTerminal, setJobPaused, useMyJobs } from '../features/build-chat/jobs';
import { DecisionDeck } from '../features/commands-inbox/DecisionDeck';
import {
  useCoreReviewCommands,
  useCreatorCommands,
  useCreatorReviewCommands,
} from '../features/commands-inbox/commands';
import { QuestionSession } from '../features/commands-inbox/QuestionSession';
import { ExecutorThread } from '../features/executor-thread/ExecutorThread';
import {
  closeThread,
  openThread,
  useThreadAccess,
  useThreadPolling,
  useUnreadReplies,
} from '../features/executor-thread/thread';
import { signOut } from '../lib/api/auth';
import { readUpdates, scopedUpdates, useNotify } from '../lib/notify/slice';
import { useSession } from '../lib/api/session';
import { getVolume, onChange, setMuted, setVolume, status } from '../lib/sound';
import { useAdminMe } from '../routes/admin/api';
import { requireAdmin } from '../routes/admin/guard';
import { useGameMenu, type GameMenuAction } from './GameMenu';
import { VolumeCircle } from './VolumeCircle';
import {
  BuildPanel,
  BuildTracker,
  combinedPercent,
  missingReviewTargets,
} from '../features/worker-builds/BuildTracker';
import { useWorkers } from '../features/worker-builds/useWorkers';
import { useWorkerReviews } from '../features/worker-builds/useWorkerReviews';
import { useWorkerFinishes, type FinishedWorker } from '../features/worker-builds/useWorkerFinishes';
import { usePastTickets } from '../features/worker-builds/usePastTickets';

const RECENT_BUILD_MS = 5 * 60 * 1000;
const MAX_TRACKED_BUILDS = 100;
const activeBuildsByCreator = new Map<string, Set<string>>();

// The circle whose detail shows in the sheet under the row; one at a time.
type Sheet = 'volume' | 'bug' | 'builds' | 'jobs' | 'decisions' | 'energy';

export function StudioMenu() {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const traySlot = useRef<HTMLDivElement>(null);
  // The tray keeps one container for the menu's whole life and only that container moves between the studio control
  // and the pause panel's More page, so stateful extras (a pending room invite) never remount on the way.
  const [trayHost] = useState(() => {
    const host = document.createElement('div');
    host.style.display = 'contents';
    return host;
  });
  const location = useLocation();
  const { controls, open, setOpen, moreHost, pausePanelVisible } = useGameMenu();
  // Before paint, so the tray never shows a frame in the place it just left.
  useLayoutEffect(() => {
    (moreHost ?? traySlot.current)?.appendChild(trayHost);
  }, [moreHost, trayHost]);
  const { data: session } = useSession();
  const creatorId = session?.user.id;
  const admin = useAdminMe(Boolean(session));
  const builds = useMyJobs();
  const decisions = useCreatorCommands(creatorId);
  const sound = useSyncExternalStore(onChange, status);
  const [volume, setLocalVolume] = useState(getVolume);
  const [announcement, setAnnouncement] = useState('');
  const [buildClock, setBuildClock] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [sheet, setSheet] = useState<Sheet>();
  const [acknowledged, setAcknowledged] = useState<{
    creatorId: string | undefined;
    finished: readonly FinishedWorker[];
  }>();
  const bugDraft = useBugDraft();
  // The deck belongs to the creator who opened it: another account signed in on this device never sees it.
  const [deck, setDeck] = useState<{ creatorId: string; command: CreatorCommand }>();
  const [questions, setQuestions] = useState<{ creatorId: string; session: QueuedSession }>();
  const isShowcase = Boolean(matchPath('/g/showcase/:id', location.pathname));
  const game = isShowcase ? null : matchPath('/g/:gameId/*', location.pathname);
  const isGameView = Boolean(game || isShowcase);
  const hasStudioHeader = Boolean(matchPath('/all', location.pathname) || matchPath('/new', location.pathname));
  const gameId = game?.params.gameId;
  const unreadUpdates = useNotify((state) => scopedUpdates(state, creatorId, gameId).unread);
  const hasUpdates = useNotify((state) => scopedUpdates(state, creatorId, gameId).updates.length > 0);
  const ownedGames = isShowcase ? [] : builds.games.filter((item) => item.ownerId === creatorId);
  // In a game, builds, reviews and Commands are that game's only; the core's and other games' stay on the library.
  const trackedGames = gameId === undefined ? ownedGames : ownedGames.filter((item) => item.id === gameId);
  const {
    workers,
    feeds,
    error: workerError,
    loading: workersLoading,
  } = useWorkers(trackedGames, undefined, creatorId);
  const reviewData = useWorkerReviews(trackedGames, creatorId);
  const reviews = reviewData.reviews;
  const past = usePastTickets(trackedGames, creatorId);
  const gameReview = useCreatorReviewCommands(creatorId);
  const allCore = useCoreReviewCommands(creatorId);
  const coreReview = gameId === undefined ? allCore : { commands: [], targets: [], error: false, loading: false };
  const reviewCommands = [
    ...gameReview.commands.filter((command) => gameId === undefined || command.game_id === gameId),
    ...coreReview.commands,
  ];
  const { finished, dismiss: dismissFinished } = useWorkerFinishes(workers, feeds, creatorId);
  const visibleFinished = isShowcase
    ? []
    : gameId
      ? finished.filter(({ ticket }) => ticket.startsWith(gameId + ':'))
      : finished;
  const gameTitles = useMemo(() => new Map(builds.games.map(({ id, title }) => [id, title])), [builds.games]);
  const visibleBuilds = useMemo(() => recentBuilds(builds.jobs), [builds.jobs, buildClock]);
  // Status: every game the creator owns, live or not, with its running builds and what waits on them.
  const buildGroups = useMemo(
    () => statusGroups(groupBuilds(visibleBuilds, gameTitles), ownedGames),
    [gameTitles, ownedGames, visibleBuilds],
  );
  const buildingJobs = useMemo(() => builds.jobs.filter(isBuilding), [builds.jobs]);
  // The badge counts every open player-facing decision across the creator's games, and each game's quick voice chat
  // as one entry; red when a decision blocks its build.
  const openDecisions = decisions.commands.length + decisions.sessions.length;
  const blocked = decisions.commands.some((command) => command.blocking);
  // The instance owner's thread with the Executor. A reply only raises a count, never text over the screen; its text
  // shows when the owner opens the thread.
  const threadAccess = useThreadAccess(isShowcase ? undefined : creatorId);
  useThreadPolling(creatorId, threadAccess);
  const unreadReplies = useUnreadReplies(threadAccess ? creatorId : undefined);
  const pendingReviews =
    reviews.length +
    reviewCommands.length +
    coreReview.targets.length +
    missingReviewTargets(workers, reviews, reviewCommands).length;
  const menuBadge =
    openDecisions + unreadReplies + pendingReviews - reviewCommands.length + visibleFinished.length + unreadUpdates;
  const threadCommands = useMemo(
    // In a game, that game's Commands and the core's; on the library, all of them.
    () =>
      gameId === undefined
        ? decisions.commands
        : decisions.commands.filter((command) => 'source' in command || command.game_id === gameId),
    [decisions.commands, gameId],
  );

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        root.current?.contains(target) ||
        (target instanceof Element && target.closest('[data-studio-menu-boundary], .job-conversation-backdrop'))
      ) {
        return;
      }
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (wasOpen.current && !open) {
      setSheet(undefined);
      if (!pausePanelVisible) {
        const soundTrigger = hasStudioHeader
          ? root.current?.querySelector<HTMLButtonElement>('.studio-library-volume button')
          : null;
        (soundTrigger ?? trigger.current)?.focus();
        wasOpen.current = false;
      }
    }
    if (open) wasOpen.current = true;
  }, [hasStudioHeader, open, sheet, pausePanelVisible]);

  useEffect(() => {
    if (deck && deck.creatorId !== creatorId) setDeck(undefined);
  }, [creatorId, deck]);

  useEffect(() => {
    if (questions && questions.creatorId !== creatorId) setQuestions(undefined);
  }, [creatorId, questions]);

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
      resetReviewDrafts();
    } catch {
      setAnnouncement('Sign out failed. Try again.');
      setSigningOut(false);
    }
  };
  const close = () => setOpen(false);
  const gamePath = gameId === undefined ? undefined : `/g/${encodeURIComponent(gameId)}`;
  const toggleSheet = (next: Sheet) => setSheet((current) => (current === next ? undefined : next));
  const buildsDone = visibleBuilds.length > 0 && visibleBuilds.every((job) => job.state === 'done');
  const buildsPercent =
    visibleBuilds.length === 0
      ? 0
      : Math.round(visibleBuilds.reduce((total, job) => total + buildPercent(job), 0) / visibleBuilds.length);

  // Nearest the menu button first; the row runs right to left.
  const circles: ReactElement[] = [];
  // Inside the pause panel's More page, actions the panel itself offers (Leave, Edit) and Sound are not repeated.
  const inPause = moreHost !== null;
  const trayOpen = open || inPause;
  if (controls) {
    circles.push(
      ...controls.actions
        .filter((action) => !inPause || !action.onPausePanel)
        .map((action) => <MenuAction key={action.id} action={action} close={close} />),
      ...controls.extras,
    );
  }
  if (openDecisions > 0) {
    circles.push(
      <button
        key="decisions"
        type="button"
        className="menu-circle"
        data-action-needed="true"
        data-blocking={blocked}
        aria-label={`Decisions: ${openDecisions}`}
        aria-expanded={sheet === 'decisions'}
        aria-controls="studio-menu-decisions"
        onClick={() => toggleSheet('decisions')}
      >
        <MenuRing percent={100} />
        <Icon name="decisions" />
        <span className="studio-menu-badge" aria-hidden="true">
          {openDecisions}
        </span>
      </button>,
    );
  }
  if (buildGroups.length > 0) {
    circles.push(
      <button
        key="jobs"
        type="button"
        className="menu-circle"
        data-done={buildsDone}
        aria-label={visibleBuilds.length > 0 ? `Jobs: ${buildsPercent}%` : 'Status'}
        aria-expanded={sheet === 'jobs'}
        aria-controls="studio-menu-jobs"
        onClick={() => toggleSheet('jobs')}
      >
        <MenuRing percent={buildsPercent} />
        <Icon name="hammer" />
      </button>,
    );
  }
  if (
    isGameView &&
    (hasUpdates ||
      (acknowledged && acknowledged.creatorId === creatorId && acknowledged.finished.length > 0) ||
      visibleFinished.length > 0 ||
      sheet === 'builds' ||
      workers.length > 0 ||
      reviews.length > 0 ||
      reviewCommands.length > 0 ||
      coreReview.targets.length > 0 ||
      past.tickets.length > 0 ||
      workerError ||
      reviewData.error ||
      gameReview.error ||
      coreReview.error ||
      past.error)
  ) {
    circles.push(
      <button
        key="builds"
        type="button"
        className="menu-circle"
        data-worker-builds="true"
        aria-label={`${workers.length} ${workers.length === 1 ? 'build' : 'builds'} running${unreadUpdates ? `, ${unreadUpdates} new ${unreadUpdates === 1 ? 'update' : 'updates'}` : ''}`}
        aria-expanded={sheet === 'builds'}
        aria-controls="studio-menu-builds"
        onClick={() => {
          readUpdates();
          if (visibleFinished.length)
            setAcknowledged((prior) => ({
              creatorId,
              finished: [...(prior && prior.creatorId === creatorId ? prior.finished : []), ...visibleFinished],
            }));
          dismissFinished(visibleFinished.map((item) => item.ticket));
          toggleSheet('builds');
        }}
      >
        <MenuRing percent={combinedPercent(workers) ?? undefined} />
        <Icon name="hammer" />
        <span className="studio-menu-badge" aria-hidden="true">
          {pendingReviews +
            visibleFinished.length +
            workers.filter((worker) => worker.state !== 'human-review').length +
            unreadUpdates}
        </span>
      </button>,
    );
  }
  if (threadAccess) {
    circles.push(
      <button
        key="ask"
        type="button"
        className="menu-circle"
        aria-label={unreadReplies > 0 ? `Ask: ${unreadReplies} new` : 'Ask'}
        onClick={() => {
          trigger.current?.focus();
          close();
          openThread();
        }}
      >
        <MenuRing />
        <Icon name="speak" />
        {unreadReplies > 0 ? (
          <span className="studio-menu-badge" aria-hidden="true">
            {unreadReplies}
          </span>
        ) : null}
      </button>,
    );
  }
  if (session) {
    circles.push(<EnergyButton key="energy" open={sheet === 'energy'} onToggle={() => toggleSheet('energy')} />);
  }
  const volumeCircle = (
    <VolumeCircle
      key="volume"
      sound={sound}
      volume={volume}
      onVolume={changeVolume}
      onMute={setMuted}
      sliderOpen={sheet === 'volume'}
      menuOpen={hasStudioHeader && open}
      blocked={hasStudioHeader && blocked}
      building={hasStudioHeader && buildingJobs.length > 0}
      onMenu={
        hasStudioHeader
          ? () => {
              setOpen(true);
              setSheet(undefined);
            }
          : undefined
      }
      onSlider={() => {
        setOpen(true);
        setSheet('volume');
      }}
    />
  );
  if (!hasStudioHeader && !inPause) circles.push(volumeCircle);
  circles.push(<BugButton key="bug" open={sheet === 'bug'} onToggle={() => toggleSheet('bug')} />);
  if (gamePath) {
    circles.push(
      <MenuLink key="versions" label="Versions" icon="versions" to={`${gamePath}/versions`} close={close} />,
      <MenuLink
        key="publish"
        label="Publish"
        icon="publish"
        to={`${gamePath}/releases?action=publish`}
        close={close}
      />,
      <MenuLink
        key="rollback"
        label="Rollback"
        icon="rollback"
        to={`${gamePath}/releases?action=rollback`}
        close={close}
      />,
    );
  }
  // Game extras can own in-flight operations (for example room creation), so only those controls stay mounted while
  // the tray is folded. The rest of the menu keeps its original open-only DOM lifetime.
  const renderedCircles = trayOpen ? circles : (controls?.extras ?? []);
  if (session) {
    circles.push(<MenuLink key="credits" label="Credits" icon="credits" to="/settings/credits" close={close} />);
    if (requireAdmin(admin.data ?? null) === 'ok') {
      circles.push(<MenuLink key="admin" label="Admin" icon="admin" to="/admin" close={close} />);
    }
    circles.push(
      <button
        key="sign-out"
        type="button"
        className="menu-circle"
        aria-label="Sign out"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
      >
        <MenuRing />
        <Icon name="signOut" />
      </button>,
    );
  }

  let sheetContent: ReactElement | null = null;
  if (sheet === 'volume') {
    sheetContent = (
      <div id="studio-menu-volume" className="studio-menu-volume">
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
    );
  } else if (sheet === 'bug') {
    // A report that finishes after another circle was tapped must not close that circle's sheet.
    sheetContent = (
      <BugSheet draft={bugDraft} close={() => setSheet((current) => (current === 'bug' ? undefined : current))} />
    );
  } else if (sheet === 'energy' && session) {
    sheetContent = <EnergyDetail close={close} />;
  } else if (sheet === 'decisions' && openDecisions > 0) {
    sheetContent = (
      <ul id="studio-menu-decisions" className="studio-menu-decisions" aria-label="Decisions">
        {decisions.commands.map((command) => (
          <li key={`${'source' in command ? 'core' : command.game_id}:${command.decision_id}`}>
            <button
              className="studio-menu-job"
              data-action-needed="true"
              data-blocking={command.blocking}
              type="button"
              aria-label={`${command.summary ?? command.title}, ${command.game_title}`}
              onClick={() => {
                /* The deck returns focus to the menu button, not to this row, which closing the menu removes. */
                trigger.current?.focus();
                close();
                if (creatorId) setDeck({ creatorId, command });
              }}
            >
              <strong>{command.summary ?? command.title}</strong>
            </button>
          </li>
        ))}
        {decisions.sessions.map((session) => (
          <li key={`questions:${session.game_id}`}>
            <button
              className="studio-menu-job studio-menu-questions"
              type="button"
              aria-label={`${session.game_title} wants a quick voice chat, ${session.count} questions`}
              onClick={() => {
                trigger.current?.focus();
                close();
                if (creatorId) setQuestions({ creatorId, session });
              }}
            >
              <Icon name="mic" />
              <strong>{session.game_title} wants a quick voice chat</strong>
              <span className="studio-menu-questions-count" aria-hidden="true">
                {session.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  } else if (sheet === 'builds') {
    sheetContent = (
      <BuildPanel
        key={creatorId ?? 'signed-out'}
        creatorId={creatorId}
        gameId={gameId}
        workers={workers}
        reviews={reviews}
        commands={reviewCommands}
        coreTargets={coreReview.targets}
        past={past.tickets}
        historyError={past.error}
        workerError={workerError}
        reviewError={reviewData.error || gameReview.error || coreReview.error}
        reviewLoading={
          builds.isLoading || workersLoading || reviewData.loading || gameReview.loading || coreReview.loading
        }
        historyLoading={past.loading}
        jobs={builds.jobs}
        finished={[
          ...(acknowledged && acknowledged.creatorId === creatorId ? acknowledged.finished : []),
          ...visibleFinished,
        ]}
        id="studio-menu-builds"
      />
    );
  } else if (sheet === 'jobs' && buildGroups.length > 0) {
    sheetContent = (
      <ul id="studio-menu-jobs" className="studio-menu-builds" aria-label="Build progress">
        {buildGroups.map((group) => (
          <li key={group.gameId}>
            <div className="studio-menu-build-group" role="group" aria-label={`${group.title} builds`}>
              <div className="studio-menu-build-heading">
                <strong>{group.title}</strong>
                {group.live ? (
                  <Link to={`/g/${encodeURIComponent(group.gameId)}`} onClick={close}>
                    Live
                  </Link>
                ) : null}
                {group.playable ? (
                  <Link to={buildPath(group.playable)} onClick={close}>
                    Ready to try
                  </Link>
                ) : null}
              </div>
              <ul>
                {decisions.commands
                  .filter((command) => command.game_id === group.gameId)
                  .map((command) => (
                    <li key={command.decision_id} className="studio-menu-job-row">
                      <button
                        className="studio-menu-job"
                        data-action-needed="true"
                        data-blocking={command.blocking}
                        type="button"
                        onClick={() => {
                          trigger.current?.focus();
                          close();
                          if (creatorId) setDeck({ creatorId, command });
                        }}
                      >
                        <strong>{command.summary ?? command.title}</strong>
                        <span className="studio-menu-job-state">Waiting on you</span>
                      </button>
                    </li>
                  ))}
                {group.jobs.map((job) => {
                  const state = menuJobState(job);
                  const percent = buildPercent(job);
                  return (
                    <li key={job.id} className="studio-menu-job-row">
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
                      <PauseControl job={job} />
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const tray = (
    <div className="studio-menu-tray" data-gm-overlay-allowed hidden={!trayOpen}>
      <div id="studio-menu-panel" className="studio-menu-row" role="group" aria-label="Menu">
        {renderedCircles.map((circle, index) => (
          <span key={circle.key} className="studio-menu-slot" style={{ '--i': index } as CSSProperties}>
            {circle}
          </span>
        ))}
      </div>
      {gameId && new URLSearchParams(location.search).get('mode') === 'edit' && (
        <div id="studio-editor-tools" className="studio-editor-tools" />
      )}
      {trayOpen && sheetContent ? <div className="studio-menu-sheet">{sheetContent}</div> : null}
    </div>
  );

  return (
    <div ref={root} className="studio-menu-control">
      {hasStudioHeader && <div className="studio-library-volume">{volumeCircle}</div>}
      {hasStudioHeader && (
        <span id="studio-header-menu-hint" className="sr">
          Long press or Shift+F10 opens the menu
        </span>
      )}
      {!isGameView && (
        <BuildTracker
          key={creatorId ?? 'signed-out'}
          creatorId={creatorId}
          workers={workers}
          reviews={reviews}
          commands={reviewCommands}
          coreTargets={coreReview.targets}
          past={past.tickets}
          historyError={past.error}
          workerError={workerError}
          reviewError={reviewData.error || gameReview.error || coreReview.error}
          reviewLoading={
            builds.isLoading || workersLoading || reviewData.loading || gameReview.loading || coreReview.loading
          }
          historyLoading={past.loading}
          jobs={builds.jobs}
          finished={visibleFinished}
          onDismiss={() => dismissFinished(visibleFinished.map((item) => item.ticket))}
        />
      )}
      <button
        ref={trigger}
        type="button"
        className="studio-menu-button"
        hidden={hasStudioHeader || pausePanelVisible || (controls?.hideButton === true && !open && !blocked)}
        data-game-play={Boolean(isGameView && controls)}
        data-building={buildingJobs.length > 0}
        data-blocking={blocked}
        aria-label="Menu"
        aria-describedby={menuBadge > 0 ? 'studio-menu-requests' : undefined}
        aria-expanded={open}
        aria-controls="studio-menu-panel"
        onClick={() => {
          setOpen((current) => !current);
          setSheet(undefined);
        }}
      >
        <span className="studio-menu-ring" aria-hidden="true" />
        <Icon name="menu" />
        {menuBadge > 0 && !open && !hasStudioHeader ? (
          <span className="studio-menu-badge" aria-hidden="true">
            {menuBadge}
          </span>
        ) : null}
      </button>
      {menuBadge > 0 ? (
        <span id="studio-menu-requests" className="sr">
          {[
            openDecisions > 0
              ? `${openDecisions} ${openDecisions === 1 ? 'decision needs' : 'decisions need'} your answer`
              : '',
            unreadReplies > 0 ? `${unreadReplies} new ${unreadReplies === 1 ? 'reply' : 'replies'}` : '',
            unreadUpdates > 0 ? `${unreadUpdates} new ${unreadUpdates === 1 ? 'update' : 'updates'}` : '',
            pendingReviews > reviewCommands.length ? `${pendingReviews - reviewCommands.length} reviews` : '',
            visibleFinished.length > 0 ? `${visibleFinished.length} completed builds` : '',
          ]
            .filter(Boolean)
            .join(', ')}
        </span>
      ) : null}
      <span className="sr" role="status" aria-live="polite">
        {announcement}
      </span>
      <div ref={traySlot} style={{ display: 'contents' }} />
      {createPortal(tray, trayHost)}
      <JobConversationModal />
      {threadAccess && creatorId ? (
        <ExecutorThread
          creatorId={creatorId}
          title={(gameId && gameTitles.get(gameId)) || 'Executor'}
          context={{
            ...(gameId ? { game_id: gameId } : {}),
            screen: location.pathname.slice(0, 300),
          }}
          commands={threadCommands}
          onOpenCommand={(command) => {
            closeThread();
            setDeck({ creatorId, command });
          }}
        />
      ) : null}
      {deck && deck.creatorId === creatorId ? (
        <DecisionDeck commands={decisions.commands} first={deck.command} onClose={() => setDeck(undefined)} />
      ) : null}
      {questions && questions.creatorId === creatorId ? (
        <QuestionSession
          session={questions.session}
          creatorId={questions.creatorId}
          onClose={() => setQuestions(undefined)}
        />
      ) : null}
    </div>
  );
}

function MenuLink({ label, icon, to, close }: { label: string; icon: string; to: string; close(): void }) {
  return (
    <Link className="menu-circle" aria-label={label} to={to} onClick={close}>
      <MenuRing />
      <Icon name={icon} />
    </Link>
  );
}

function MenuAction({ action, close }: { action: GameMenuAction; close(): void }) {
  return (
    <button
      className="menu-circle"
      type="button"
      aria-label={action.label}
      disabled={action.disabled}
      onClick={() => {
        close();
        action.onSelect();
      }}
    >
      <MenuRing />
      <Icon name={action.icon} />
    </button>
  );
}

function recentBuilds(jobs: readonly Job[], now = Date.now()): Job[] {
  return jobs.filter((job) => {
    if (!isTerminal(job.state)) return true;
    const finishedAt = Date.parse(job.terminalAt ?? job.updatedAt);
    return Number.isFinite(finishedAt) && now - finishedAt <= RECENT_BUILD_MS;
  });
}

type BuildGroup = { gameId: string; title: string; jobs: Job[]; playable?: Job; live?: boolean };
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

// The build groups, then each owned game with nothing building, so the sheet answers "is everything live?" per game.
function statusGroups(
  groups: BuildGroup[],
  owned: readonly { id: string; title?: string; live?: boolean }[],
): BuildGroup[] {
  const live = new Map(owned.map((game) => [game.id, game.live === true]));
  const shown = new Set(groups.map((group) => group.gameId));
  return [
    ...groups.map((group) => ({ ...group, live: live.get(group.gameId) ?? false })),
    ...owned
      .filter((game) => !shown.has(game.id))
      .map((game) => ({ gameId: game.id, title: game.title ?? game.id, jobs: [], live: game.live === true })),
  ];
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

// A build aiur can pause: its ticket is filed and its agent is not held by the budget. Resume undoes only a pause made here.
function pauseAction(job: Job): 'pause' | 'resume' | null {
  if (!job.aiurRepo || typeof job.aiurIssueNumber !== 'number') return null;
  if (!['filed', 'running'].includes(job.state)) return null;
  if (job.pausedReason === 'admin') return 'resume';
  if (job.pausedReason !== null || job.stage === 'parked') return null;
  return 'pause';
}

function PauseControl({ job }: { job: Job }): ReactElement | null {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const action = pauseAction(job);
  if (action === null) return null;
  return (
    <>
      <button
        className="studio-menu-job-control"
        type="button"
        aria-label={`${action === 'pause' ? 'Pause' : 'Resume'} ${job.plan.title}`}
        disabled={pending}
        onClick={() => {
          setPending(true);
          setFailed(false);
          setJobPaused(job.id, action === 'pause')
            .catch(() => setFailed(true))
            .finally(() => setPending(false));
        }}
      >
        <Icon name={action === 'pause' ? 'pause' : 'play'} />
      </button>
      {failed ? (
        <span className="studio-menu-job-error" role="alert">
          {action === 'pause' ? "Couldn't pause" : "Couldn't resume"}
        </span>
      ) : null}
    </>
  );
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
