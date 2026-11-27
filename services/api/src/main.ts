import { startPreviewRelay } from './previews/relay.js';
import { previewTicketVerifier } from './previews/ticket.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { FsBlobStore } from '@ogm/blob-store';
import { AiurHttpError, createAiurClient } from '@ogm/aiur-client';
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
import { envFileValue, FAL_CAP_USD, providerReadings } from './energy/providers.js';
import { readEnergySnapshot } from './energy/source.js';
import { sendResourceThresholdMail } from './energy/threshold-mail.js';
import { parseEmailList } from './auth/access.js';
import { loadAuthEnv } from './auth/env.js';
import { createChatJobDirectory } from './build-chat/job-directory.js';
import { createDraftScopeAssistant } from './new-game/draft-assistant.js';
import { startDraftCleanup } from './game-drafts/cleanup.js';
import { finishRun, startBuildSweep } from './builds/publish.js';
import { createDaemonDirectory, daemonRowForGame } from './jobs/daemons.js';
import { recordDaemonReadTokenStatus } from './job-commands/health.js';
import { activeJobs, activeJobsForSlug, byTicket } from './jobs/repo.js';
import { applyAiurEvent, applyIssueSnapshot, applyProgress } from './jobs/projection.js';
import { startScheduler } from './jobs/scheduler.js';
import { markPaused, markRunning, markTerminal } from './jobs/spend-cap.js';
import { createDecisionWaitPoller } from './decision-waits/poller.js';
import { createReviewSync } from './review-rounds/runner.js';
import { recordReconcileHeartbeat } from './review-rounds/heartbeat.js';
import { createReadyReviewNotifier, startReadyReviewNotifier } from './review-rounds/ready-notifications.js';
import { reviewClientForGame } from './review-rounds/daemon.js';
import { getNotifyRuntime } from './notify/routes.js';
import { createExecutorNotifier } from './executor-thread/notify.js';
import { createReviewIssues } from './review-rounds/issues.js';
import { createWaitTickets } from './decision-waits/tickets.js';
import { createTicketTitleReader, createWorkpadReader } from './worker-progress/workpad.js';
import { createTrackerReader } from './worker-progress/tracker.js';
import { createTicketLookup } from './worker-progress/lookup.js';
import { createReviewEpisodeReader } from './worker-progress/review-episode.js';
import { createTicketConversationReader } from './worker-progress/conversation.js';
import { startBriefingPush } from './voice/briefing-push.js';
import { questionSession } from './voice/question-session.js';
import { createQaAiurClient, withQaAiur } from './qa/aiur.js';

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
// The QA game (#859) answers to a recording aiur boundary instead of a daemon.
const qaAiur = createQaAiurClient(db, () => deps.blobStore);
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
    qaInstanceRepo: env.OGM_QA_INSTANCE_REPO ? parseRepositoryName(env.OGM_QA_INSTANCE_REPO) : undefined,
    coreRepo: env.OGM_CORE_BUMP_CORE_REPO ? parseRepositoryName(env.OGM_CORE_BUMP_CORE_REPO) : undefined,
    pcCoreRepo: env.OGM_CORE_PC_REPO ? parseRepositoryName(env.OGM_CORE_PC_REPO) : undefined,
    instanceOwnerId: env.OGM_INSTANCE_OWNER_ID,
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
    defaultDailyAllowanceConfigured: env.defaultDailyAllowanceConfigured,
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
  aiurClientForGame: withQaAiur(db, qaAiur, daemonDirectory.clientForGame),
  version: readGitVersion(),
  startedAtMs: Date.now(),
  log,
};
deps.registry.chatJobs = createChatJobDirectory(db);
deps.registry.energyReadings = providerReadings({
  aiur: env.AIUR_API_URL && env.AIUR_API_TOKEN ? { baseUrl: env.AIUR_API_URL, token: env.AIUR_API_TOKEN } : null,
  elevenLabsKey: () => envFileValue(env.OGM_VOICE_ENV_FILE, 'ELEVENLABS_API_KEY'),
  falLedger: env.OGM_FAL_LEDGER,
  falCapUsd: FAL_CAP_USD,
});
deps.registry.energyNetlifyLog = env.OGM_NETLIFY_DEPLOY_LOG;
deps.registry.aiurClientFor = async (slug) =>
  slug === 'core' ? deps.registry.coreAiurClient : daemonDirectory.clientForSlug(slug);
if (env.AIUR_API_URL && env.AIUR_API_TOKEN) {
  deps.registry.coreAiurClient = createAiurClient({
    baseUrl: env.AIUR_API_URL,
    token: env.AIUR_API_TOKEN,
    supervisorToken: env.AIUR_API_TOKEN,
  });
  deps.registry.coreAiurClients.push({ id: 'core', client: deps.registry.coreAiurClient, repo: deps.config.coreRepo });
}
if (env.OGM_CORE_PC_AIUR_URL && env.OGM_CORE_PC_AIUR_TOKEN) {
  deps.registry.coreAiurClients.push({
    id: 'pc',
    client: createAiurClient({
      baseUrl: env.OGM_CORE_PC_AIUR_URL,
      token: env.OGM_CORE_PC_AIUR_TOKEN,
      supervisorToken: env.OGM_CORE_PC_AIUR_TOKEN,
    }),
    repo: deps.config.pcCoreRepo,
  });
}
deps.registry.draftScopeAssistant = createDraftScopeAssistant({
  db,
  repo: `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`,
  issues,
  clientForSlug: daemonDirectory.clientForSlug,
});
deps.registry.workerWorkpad = createWorkpadReader(deps.config.instanceRepo, env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.workerTitle = createTicketTitleReader(deps.config.instanceRepo, env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.trackerTickets = createTrackerReader(env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.trackerTicket = createTicketLookup(env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.reviewEpisode = createReviewEpisodeReader(env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.ticketConversation = createTicketConversationReader(env.OGM_INTAKE_GITHUB_TOKEN);
deps.registry.issueStateWriter = issues;
deps.registry.fidelityWriter = createReviewIssues(env.OGM_INTAKE_GITHUB_TOKEN);
startPreviewRelay(deps, previewTicketVerifier(env.OGM_INTAKE_GITHUB_TOKEN));

const budgetDefaults = {
  dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
  defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
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
  async aiurForGame(daemonSlug) {
    const running = await fleet.daemonFor(daemonSlug);
    if (!running) throw new Error(`Aiur daemon ${daemonSlug} is unavailable`);
    return running.client;
  },
  shippedSkills: skillPack().discovery.map(({ name }) => name),
  coreRepo: env.OGM_CORE_BUMP_CORE_REPO || undefined,
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
const stopDraftCleanup = startDraftCleanup(deps);
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
  syncReviewRounds: createReviewSync({
    db,
    sqlite,
    publishReminder: (notification) => getNotifyRuntime(deps).deliverStored(notification),
    clientForGame: withQaAiur(db, qaAiur, reviewClientForGame(db, fleet)),
    issues: createReviewIssues(env.OGM_INTAKE_GITHUB_TOKEN),
    log,
  }),
  log,
});
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
    const row = daemonRowForGame(db, gameId);
    return row ? ((await fleet.daemonFor(row.slug))?.client ?? null) : null;
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
const resourceMaintainers = parseEmailList(loadAuthEnv().OGM_MAINTAINER_EMAILS);
let resourceMailPending: Promise<void> | null = null;
const resourceMailTick = () => {
  if (resourceMailPending || !deps.registry.mailSender) return;
  const mail = deps.registry.mailSender;
  resourceMailPending = readEnergySnapshot(
    {
      db,
      zone: deps.config.resetZoneDefault,
      readings: deps.registry.energyReadings,
      netlifyLog: deps.registry.energyNetlifyLog,
    },
    new Date(),
  )
    .then((snapshot) => sendResourceThresholdMail(db, mail, snapshot.resources, resourceMaintainers))
    .catch((error: unknown) => log({ event: 'resource_threshold_mail_error', error: (error as Error).name }))
    .finally(() => {
      resourceMailPending = null;
    });
};
resourceMailTick();
const resourceMailTimer = setInterval(resourceMailTick, 60_000);
resourceMailTimer.unref();
const reviewNotifications = startReadyReviewNotifier(
  createReadyReviewNotifier(deps, {
    deliver: (notification) => getNotifyRuntime(deps).deliverStored(notification, { retryFailures: true }),
  }),
  Math.max(30_000, env.OGM_COMMAND_POLL_MS),
  log,
);
const executorNotify = createExecutorNotifier(deps, {
  deliver: (notification) => getNotifyRuntime(deps).deliverStored(notification),
});
setInterval(() => {
  void executorNotify().catch((error: unknown) =>
    log({
      event: 'executor_notify_error',
      error: (error as Error).name,
      ...(error instanceof AiurHttpError ? { status: error.status, code: error.code } : {}),
    }),
  );
}, 30_000).unref();
// Give the first scheduled pass one interval to start before the independent monitor checks it.
recordReconcileHeartbeat(db, Date.now());
decisionWaits.start(env.OGM_COMMAND_POLL_MS);

const server = serve({ fetch: app.fetch, hostname: API_HOST, port: env.OGM_API_PORT });
server.once('listening', () => log({ event: 'listening', host: API_HOST, port: env.OGM_API_PORT }));
process.once('SIGTERM', () => {
  clearInterval(resourceMailTimer);
  intake.stop();
  stopDraftCleanup();
  stopAnalyticsRetention();
  stopScheduler();
  stopEstimateRefinement();
  stopBuildSweep();
  decisionWaits.stop();
  reviewNotifications.stop();
  stopBriefingPush();
  usageReconciler.stop();
  void Promise.all([feed.stop(), usageReconciler.idle(), reviewNotifications.idle(), resourceMailPending]).finally(() =>
    server.close(() => sqlite.close()),
  );
});
