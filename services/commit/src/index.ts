import { serve } from '@hono/node-server';
import { GameRepoTemplateSource } from '@ogm/game-repo-template';

import { JsonlAuditWriter } from './audit.js';
import { createGitHubApp } from './auth/app.js';
import { BoundaryApiClient } from './boundary/api-client.js';
import { createBlocklistLoader } from './boundary/blocklist.js';
import { BoundaryChecker } from './boundary/checker.js';
import { startBoundaryPoller } from './boundary/poller.js';
import { loadCommitConfig } from './config.js';
import { RealBoundaryGate } from './publish-gate/gate.js';
import { RepoResolver } from './repo-resolver.js';
import { createCommitApp } from './server.js';
import { DefaultTemplateSource, withGameTemplates } from './template-source.js';

async function main(): Promise<void> {
  const config = loadCommitConfig();
  const github = await createGitHubApp({
    appId: config.githubAppId,
    privateKeyPath: config.githubPrivateKeyPath,
    clientId: config.githubClientId,
    clientSecret: config.githubClientSecret,
  });
  const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));
  if (config.githubClientId === undefined || config.githubClientSecret === undefined) {
    // Without these the App cannot prove who controls an installation, so GitHub connections are refused.
    log({
      event: 'github-oauth-not-configured',
      message: 'set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET to accept GitHub connections',
    });
  }
  const api = new BoundaryApiClient({ baseUrl: config.apiInternalUrl, token: config.internalToken });
  const blocklist = createBlocklistLoader(config.blocklistFile, (message) =>
    log({ event: 'boundary-warning', message }),
  );
  const checker = new BoundaryChecker({ app: github, api, blocklist });
  const runBoundaryCheck = async (request: Parameters<BoundaryChecker['check']>[0]) => {
    await checker.check(request);
  };
  const app = createCommitApp({
    serviceToken: config.serviceToken,
    repos: new RepoResolver(config.apiInternalUrl, config.internalToken),
    audit: new JsonlAuditWriter(config.dataDirectory),
    installations: github,
    operations: {
      app: github,
      gate: new RealBoundaryGate({ app: github, api, blocklist }),
      templates: withGameTemplates(new GameRepoTemplateSource(), new DefaultTemplateSource()),
      builderBotLogin: config.builderBotLogin,
      platformIssueRepo: config.platformIssueRepo,
    },
    boundaryWebhook: {
      secret: config.githubWebhookSecret,
      async resolveRepository(owner, name) {
        // Every game shares the instance repository, so one repository name resolves to all of its games.
        const repositories = await api.activeRepositories();
        return repositories.filter(
          (repository) =>
            repository.owner.toLocaleLowerCase() === owner.toLocaleLowerCase() &&
            repository.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        );
      },
      run: runBoundaryCheck,
      onError(error) {
        log({ event: 'boundary-webhook-error', error: error instanceof Error ? error.name : 'UnknownError' });
      },
    },
  });
  const poller = startBoundaryPoller({ api, app: github, check: runBoundaryCheck, log });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port });
  process.once('SIGTERM', () => {
    poller.stop();
    server.close();
  });
}

await main();
