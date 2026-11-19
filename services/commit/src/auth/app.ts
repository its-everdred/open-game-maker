import { createAppAuth } from '@octokit/auth-app';
import { request as octokitRequest } from '@octokit/request';
import { Octokit } from 'octokit';

import { fetchWithTimeout } from '../fetch-timeout.js';
import { GitHubRequestError, withSafeGitHubRequests } from '../github-request.js';
import type { AuthenticatedGitHub, GitHubApp, GitHubIdentity, GitHubInstallations, GitHubRequest } from '../types.js';
import { readPrivateKey } from './private-key.js';

type Clock = () => number;
type Installation = { id: number; account?: { login?: string; type?: string } | null };
type CachedInstallation = {
  id: number;
  accountType: 'Organization' | 'User';
  fetchedAt: number;
};
type CachedToken = { token: string; expiresAt: number };

export class AppNotInstalledError extends Error {
  constructor(owner: string) {
    super(`GitHub App is not installed for ${owner}`);
    this.name = 'AppNotInstalledError';
  }
}

/*
 * The App has no OAuth client id/secret, so the code GitHub appends to the setup URL cannot be exchanged and no
 * user token proves which account controls an installation. Callers answer 503 rather than falling back to an
 * unproven lookup.
 */
export class GitHubOAuthNotConfiguredError extends Error {
  constructor() {
    super('GitHub App OAuth client id and secret are not configured');
    this.name = 'GitHubOAuthNotConfiguredError';
  }
}

export type GitHubAppConfig = {
  appId: string;
  privateKeyPath: string;
  // The App's OAuth client credentials. Unset means the App was not given "Request user authorization (OAuth)
  // during installation", so no code arrives at the setup URL and ownership can never be proven.
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof fetch;
  now?: Clock;
  timeoutMs?: number;
  log?: (entry: Record<string, unknown>) => void;
};

export async function createGitHubApp(config: GitHubAppConfig): Promise<GitHubApp & GitHubInstallations> {
  const privateKey = await readPrivateKey(config.privateKeyPath);
  const cooldown = { until: 0 };
  const installationCooldowns = new Map<number, { until: number }>();
  const now = config.now ?? Date.now;
  const boundedFetch = fetchWithTimeout(config.fetch ?? fetch, config.timeoutMs);
  const oauth =
    config.clientId !== undefined && config.clientSecret !== undefined
      ? { clientId: config.clientId, clientSecret: config.clientSecret }
      : null;
  const rawRequest = octokitRequest.defaults({ request: { fetch: boundedFetch } });
  const request = Object.assign(
    withSafeGitHubRequests(rawRequest as unknown as GitHubRequest, undefined, undefined, config.log, cooldown),
    {
      endpoint: rawRequest.endpoint,
      defaults: rawRequest.defaults,
    },
  ) as typeof rawRequest;
  const auth = createAppAuth({ appId: config.appId, privateKey, request });
  const appClient = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: config.appId, privateKey },
    request: { fetch: boundedFetch },
    retry: { enabled: false },
    throttle: { enabled: false },
  });
  const appRequest = withSafeGitHubRequests(
    appClient.request.bind(appClient) as unknown as GitHubRequest,
    undefined,
    undefined,
    config.log,
    cooldown,
  );
  const installations = new Map<string, CachedInstallation>();
  const tokens = new Map<number, CachedToken>();
  let identityValue: GitHubIdentity | undefined;

  async function installationFor(owner: string): Promise<CachedInstallation> {
    const key = owner.toLowerCase();
    const cached = installations.get(key);
    if (cached !== undefined && now() - cached.fetchedAt < 10 * 60_000) return cached;

    let match: Installation | undefined;
    for (let page = 1; match === undefined; page += 1) {
      const response = await appRequest<Installation[]>('GET /app/installations', { per_page: 100, page });
      match = response.data.find((installation) => installation.account?.login?.toLowerCase() === key);
      if (response.data.length < 100) break;
    }
    if (match?.account?.type !== 'Organization' && match?.account?.type !== 'User') {
      throw new AppNotInstalledError(owner);
    }
    const resolved: CachedInstallation = {
      id: match.id,
      accountType: match.account.type,
      fetchedAt: now(),
    };
    installations.set(key, resolved);
    return resolved;
  }

  async function tokenFor(installationId: number): Promise<string> {
    const cached = tokens.get(installationId);
    if (cached !== undefined && cached.expiresAt - now() > 5 * 60_000) return cached.token;
    const authentication = await auth({
      type: 'installation',
      installationId,
      refresh: cached !== undefined,
    });
    tokens.set(installationId, {
      token: authentication.token,
      expiresAt: Date.parse(authentication.expiresAt),
    });
    return authentication.token;
  }

  /*
   * A user access token minted from the code GitHub appended to the App's setup URL. The code is single use and
   * short lived, so a second exchange for the same code answers an `error` field rather than a token.
   */
  async function userTokenFor(code: string): Promise<string | null> {
    if (oauth === null) throw new GitHubOAuthNotConfiguredError();
    const response = await boundedFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: oauth.clientId, client_secret: oauth.clientSecret, code }),
    });
    if (!response.ok) throw new Error(`GitHub OAuth code exchange failed (${response.status})`);
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
    if (typeof body?.access_token === 'string' && body.access_token.length > 0) return body.access_token;
    // A spent or forged code is a refusal, not an outage: GitHub answers with an `error` field, never a 5xx.
    if (typeof body?.error === 'string') return null;
    throw new Error('GitHub OAuth code exchange returned no token');
  }

  /* The installation as GitHub reports it for a user token; null when that user cannot see the installation. */
  async function installationForUser(token: string, installationId: number): Promise<Installation | null> {
    for (let page = 1; ; page += 1) {
      const response = await boundedFetch(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`GitHub user installations failed (${response.status})`);
      const body = (await response.json().catch(() => null)) as { installations?: Installation[] } | null;
      const list = Array.isArray(body?.installations) ? body.installations : [];
      const match = list.find((installation) => installation.id === installationId);
      if (match !== undefined) return match;
      if (list.length < 100) return null;
    }
  }

  return {
    async forOwner(owner: string): Promise<AuthenticatedGitHub> {
      const installation = await installationFor(owner);
      const client = new Octokit({
        auth: await tokenFor(installation.id),
        request: { fetch: boundedFetch },
        retry: { enabled: false },
        throttle: { enabled: false },
      });
      const request = client.request.bind(client) as unknown as GitHubRequest;
      let installationCooldown = installationCooldowns.get(installation.id);
      if (installationCooldown === undefined) {
        installationCooldown = { until: 0 };
        installationCooldowns.set(installation.id, installationCooldown);
      }
      return {
        accountType: installation.accountType,
        request: withSafeGitHubRequests(request, undefined, undefined, config.log, installationCooldown),
      };
    },
    async identity(): Promise<GitHubIdentity> {
      if (identityValue !== undefined) return identityValue;
      const response = await appRequest<{ slug: string }>('GET /app');
      if (response.data === null) throw new Error('GitHub App identity response was empty');
      const slug = response.data.slug;
      identityValue = {
        name: `${slug}[bot]`,
        email: `${slug}[bot]@users.noreply.github.com`,
      };
      return identityValue;
    },
    async installationLogin(installationId: number): Promise<string | null> {
      try {
        const response = await appRequest<Installation>('GET /app/installations/{installation_id}', {
          installation_id: installationId,
        });
        return response.data?.account?.login ?? null;
      } catch (error) {
        if (error instanceof GitHubRequestError && error.status === 404) return null;
        throw error;
      }
    },
    /*
     * Proof of ownership: the login only comes back when the user who authorized `code` can see the installation.
     * Knowing an installation id proves nothing on its own, so a creator cannot claim someone else's account.
     */
    async installationLoginForUser(installationId: number, code: string): Promise<string | null> {
      const token = await userTokenFor(code);
      if (token === null) return null;
      const installation = await installationForUser(token, installationId);
      const login = installation?.account?.login;
      return typeof login === 'string' ? login : null;
    },
  };
}
