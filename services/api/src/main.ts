import { homedir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { FsBlobStore } from '@ogm/blob-store';
import { createDbDaemonStore, createFleet, createIntake, createIssuesClient, startFeedConsumers } from '@ogm/builder';
import { parseRepositoryName } from '@ogm/config';
import { migrate, openDb } from '@ogm/db';
import { skillPack } from '@ogm/game-repo-template';

import { createApp } from './app/app.js';
import { API_HOST, loadApiEnv } from './app/env.js';
import { createAppEvents } from './app/events.js';
import { createRegistry } from './app/registry.js';
import { scanRoutes } from './app/routes-scan.js';
import type { AppDeps, LogLine } from './app/types.js';
import { readGitVersion } from './app/version.js';
import { startAnalyticsRetention } from './analytics/retention.js';
import { startEstimateRefinement } from './budget/estimate.js';
import { createApplyUsage, startUsageReconciler } from './budget/aiur-usage.js';
import { createChatJobDirectory } from './build-chat/job-directory.js';
import { finishRun, startBuildSweep } from './builds/publish.js';
import { gameSlugFor } from './games/games.js';
import { createDaemonDirectory } from './jobs/daemons.js';
import { recordDaemonReadTokenStatus } from './job-commands/health.js';
import { activeJobs, activeJobsForSlug, byTicket } from './jobs/repo.js';
import { applyAiurEvent, applyIssueSnapshot, applyProgress } from './jobs/projection.js';
import { startScheduler } from './jobs/scheduler.js';
import { markPaused, markRunning, markTerminal } from './jobs/spend-cap.js';
import { createDecisionWaitPoller } from './decision-waits/poller.js';
import { createWaitTickets } from './decision-waits/tickets.js';
import { createWorkpadReader } from './worker-progress/workpad.js';
import { startBriefingPush } from './voice/briefing-push.js';
import { questionSession } from './voice/question-session.js';

const log = (line: LogLine) => console.log(JSON.stringify({ service: 'api', ...line }));

const env = loadApiEnv();
const { sqlite, db } = openDb(join(env.OGM_DATA_DIR, 'ogm.sqlite3'));
log({ event: 'migrated', ...migrate({ sqlite }) });
const home = homedir();
const fleet = createFleet({
  store: createDbDaemonStore(db),
  activeJobs: async (gameSlug) => activeJobsForSlug(db, gameSlug),
  env: {
    home,
    builderBotToken: env.OGM_BUILDER_BOT_TOKEN,
    builderBotLogin: env.OGM_BUILDER_BOT_LOGIN,
    intakeLogin: env.OGM_INTAKE_BOT_LOGIN,
    assetsLocalDir: join(home, 'games', 'open-game-maker-2000', 'assets-local'),
    apiPort: env.OGM_API_PORT,
  },
  alert: (message) => log({ event: 'daemon_alert', message }),
  readTokenStatus: (daemon, missing) => recordDaemonReadTokenStatus(deps, daemon, missing),
});
const daemonDirectory = createDaemonDirectory(db, fleet);
const issues = createIssuesClient({ token: env.OGM_INTAKE_GITHUB_TOKEN });

const deps: AppDeps = {
  db,
  sqlite,
  config: {
    internalToken: env.OGM_INTERNAL_TOKEN,
    jobTokenSecret: env.OGM_JOB_TOKEN_SECRET,
    blobSigningKey: env.OGM_BLOB_SIGNING_KEY,
    appOrigin: env.OGM_APP_ORIGIN,
    publicOrigin: env.OGM_PUBLIC_ORIGIN,
    roomsInternalUrl: env.OGM_ROOMS_INTERNAL_URL,
    roomsInternalSecret: env.OGM_ROOMS_INTERNAL_SECRET,
    roomGrantSecret: env.OGM_WS_TOKEN_SECRET,
    gamesOrigin: env.OGM_GAMES_ORIGIN,
    commitInternalUrl: env.OGM_COMMIT_INTERNAL_URL,
    commitServiceToken: env.OGM_COMMIT_SERVICE_TOKEN,
    gameTemplateRef: env.OGM_GAME_TEMPLATE_REF,
    instanceRepo: parseRepositoryName(env.OGM_INSTANCE_REPO),
    gamesRoot: env.OGM_GAMES_ROOT ?? join(env.OGM_DATA_DIR, '..', 'games'),
    vapidKeyFile: env.OGM_VAPID_KEY_FILE,
    vapidSubject: `mailto:${env.OGM_VAPID_SUBJECT}`,
    builderWorkspacesRoot: env.OGM_BUILDER_WORKSPACES_ROOT,
    chatPollMs: env.OGM_CHAT_POLL_MS,
    commandPollMs: env.OGM_COMMAND_POLL_MS,
    designDefaultMs: env.OGM_DESIGN_DEFAULT_MS,
    voiceQuestionsAt: env.OGM_VOICE_QUESTIONS_AT,
    analyticsRetentionDays: env.OGM_ANALYTICS_RETENTION_DAYS,
    voiceTokenSecret: env.OGM_VOICE_TOKEN_SECRET,
    voiceWsUrl: env.OGM_VOICE_WS_URL,
    voiceHostInternalUrl: env.OGM_VOICE_HOST_INTERNAL_URL,
    voiceInternalSecret: env.OGM_VOICE_INTERNAL_SECRET,
    narrationConcurrency: env.OGM_NARRATION_CONCURRENCY,
    defaultDailyAllowanceMicroUsd: env.OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD,
    resetZoneDefault: env.OGM_RESET_ZONE_DEFAULT,
    intakeDir: env.OGM_INTAKE_DIR,
    reportBundleMaxBytes: env.OGM_REPORT_BUNDLE_MAX_BYTES,
    blobPutMaxBytes: env.OGM_BLOB_PUT_MAX_BYTES,
  },
  blobStore: new FsBlobStore({
    root: env.OGM_BLOB_ROOT,
    signingKey: env.OGM_BLOB_SIGNING_KEY,
    publicOrigin: env.OGM_PUBLIC_ORIGIN,
  }),
  events: createAppEvents(log),
  registry: createRegistry(),
  aiurClientForGame: daemonDirectory.clientForGame,
  version: readGitVersion(),
  startedAtMs: Date.now(),
  log,
};
deps.registry.chatJobs = createChatJobDirectory(db);
deps.registry.aiurClientFor = daemonDirectory.clientForSlug;
deps.registry.workerWorkpad = createWorkpadReader(deps.config.instanceRepo, env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.issueStateWriter = issues;

const budgetDefaults = {
  dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
  resetZone: deps.config.resetZoneDefault,
};
const lifecycleDeps = { db, sqlite, events: deps.events, defaults: budgetDefaults };
const projectionDeps = {
  db,
  events: deps.events,
  jobs: { byTicket: (daemonSlug: string, ticket: string) => byTicket(db, daemonSlug, ticket) },
  lifecycle: {
    markRunning: (jobId: string) => void markRunning(lifecycleDeps, jobId),
    markPaused: (jobId: string, reason: 'over_reservation' | 'budget_exhausted' | 'admin') =>
      void markPaused(lifecycleDeps, jobId, reason),
    markTerminal: (jobId: string, state: 'done' | 'failed' | 'cancelled') => finishRun(deps, jobId, state),
  },
};

const intake = createIntake({
  db,
  fleet,
  issues,
  async aiurForGame(gameSlug) {
    const running = await fleet.daemonFor(gameSlug);
    if (!running) throw new Error(`Aiur daemon is unavailable for ${gameSlug}`);
    return running.client;
  },
  shippedSkills: skillPack().discovery.map(({ name }) => name),
  failJob: (jobId) => void markTerminal(lifecycleDeps, jobId, 'failed'),
  // A New Game request's parent issue hands the Build Order to the Executor, so the request job ends at filing.
  completeJob: (jobId) => void markTerminal(lifecycleDeps, jobId, 'done'),
  subscribeAdmitted(listener) {
    return deps.events.on('job.changed', ({ jobId, state }) => {
      if (state === 'admitted') listener(jobId);
    });
  },
  onJobChanged: (event) => deps.events.emit('job.changed', event),
  alert: (event) => log({ event: 'job_intake_alert', ...event }),
  sweepMs: env.OGM_INTAKE_SWEEP_SECONDS * 1000,
});

const stopAnalyticsRetention = startAnalyticsRetention({
  sqlite,
  retentionDays: deps.config.analyticsRetentionDays,
  log,
});
intake.start();
const stopScheduler = startScheduler({ ...lifecycleDeps, log });
const stopEstimateRefinement = startEstimateRefinement({ db, events: deps.events, log });
const stopBuildSweep = startBuildSweep(deps, { graceMs: 30 * 60_000, intervalMs: 60_000 });
// Tickets parked on a decision start as soon as it is answered, with no Executor step (#680).
const decisionWaits = createDecisionWaitPoller({
  daemons: async () =>
    (await fleet.listDaemons())
      .filter(({ status }) => status === 'running' || status === 'idle')
      .map(({ slug, repo }) => ({ slug, repo })),
  clientFor: daemonDirectory.clientForSlug,
  tickets: createWaitTickets(env.OGM_INTAKE_GITHUB_TOKEN),
  log,
});
decisionWaits.start(env.OGM_COMMAND_POLL_MS);
const stopBriefingPush =
  env.OGM_VOICE_HOST_INTERNAL_URL && env.OGM_VOICE_INTERNAL_SECRET
    ? startBriefingPush({
        db,
        sqlite,
        events: deps.events,
        defaults: budgetDefaults,
        questionSession: (gameId) => questionSession(deps, gameId),
        url: env.OGM_VOICE_HOST_INTERNAL_URL,
        secret: env.OGM_VOICE_INTERNAL_SECRET,
        log,
      })
    : () => {};
const usageReconciler = startUsageReconciler({
  ...lifecycleDeps,
  daemonFor: async (gameId) => {
    const slug = gameSlugFor(db, gameId);
    return slug === null ? null : ((await fleet.daemonFor(slug))?.client ?? null);
  },
  applyUsage: createApplyUsage(lifecycleDeps),
  log,
});
const feed = startFeedConsumers({
  fleet,
  db,
  activeJobs: (daemonSlug) => activeJobs(db, daemonSlug),
  apply: {
    record: (daemonSlug, record) => void applyAiurEvent(projectionDeps, daemonSlug, record),
    issue: (daemonSlug, ticket, issue) => void applyIssueSnapshot(projectionDeps, daemonSlug, ticket, issue),
    progress: (daemonSlug, ticket, progress) => void applyProgress(projectionDeps, daemonSlug, ticket, progress),
  },
  log,
});

const app = createApp(deps);
for (const { prefix, file } of (await scanRoutes(app, { deps })).mounted) log({ event: 'mounted', prefix, file });

const server = serve({ fetch: app.fetch, hostname: API_HOST, port: env.OGM_API_PORT });
server.once('listening', () => log({ event: 'listening', host: API_HOST, port: env.OGM_API_PORT }));
process.once('SIGTERM', () => {
  intake.stop();
  stopAnalyticsRetention();
  stopScheduler();
  stopEstimateRefinement();
  stopBuildSweep();
  decisionWaits.stop();
  stopBriefingPush();
  usageReconciler.stop();
  void Promise.all([feed.stop(), usageReconciler.idle()]).finally(() => server.close(() => sqlite.close()));
});
