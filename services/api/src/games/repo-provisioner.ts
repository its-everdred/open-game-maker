import { gameFolder } from '@ogm/contracts';

import type { RepoProvisioner } from '../app/registry.js';

export type { RepoProvisioner } from '../app/registry.js';

type ProvisionInput = Parameters<RepoProvisioner['provision']>[0];
export type ProvisionedRepo = Awaited<ReturnType<RepoProvisioner['provision']>>;

export class NullRepoProvisioner implements RepoProvisioner {
  readonly calls: ProvisionInput[] = [];
  readonly #owner: string;
  readonly #repo: string;

  constructor(instanceRepo: { owner: string; name: string } = { owner: 'instance', name: 'games' }) {
    this.#owner = instanceRepo.owner;
    this.#repo = instanceRepo.name;
  }

  async provision(game: ProvisionInput): Promise<ProvisionedRepo> {
    this.calls.push(game);
    const path = gameFolder(game.slug);
    const owner = game.repository?.owner ?? this.#owner;
    const repo = game.repository?.name ?? this.#repo;
    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
      path,
    };
  }
}

// A game is a folder in the instance repository, so provisioning adds `games/<slug>/` on a branch and merges it as the
// bot — the commit service creates no repository and needs no per-creator GitHub account.
export class GitHubRateLimitError extends Error {}
export class ProvisioningOutcomeUnknownError extends Error {}

export class CommitServiceRepoProvisioner implements RepoProvisioner {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #templateRef: string;
  readonly #instanceRepo: { owner: string; name: string };
  readonly #fetch: typeof fetch;

  constructor(input: {
    baseUrl: string;
    token: string;
    instanceRepo: { owner: string; name: string };
    templateRef?: string;
    fetch?: typeof fetch;
  }) {
    this.#baseUrl = input.baseUrl.replace(/\/$/, '');
    this.#token = input.token;
    this.#instanceRepo = input.instanceRepo;
    this.#templateRef = input.templateRef ?? 'game-2d@1';
    this.#fetch = input.fetch ?? fetch;
  }

  async provision(game: ProvisionInput): Promise<ProvisionedRepo> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/internal/commit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'create_game',
          gameId: game.id,
          slug: game.slug,
          visibility: game.visibility,
          templateRef: this.#templateRef,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ProvisioningOutcomeUnknownError('commit outcome is unknown', { cause: error });
    }
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      verdict?: { reasons?: { detail?: string }[] };
    } | null;
    if (result?.ok === false && result.verdict?.reasons?.some((reason) => reason.detail === 'github rate limited')) {
      throw new GitHubRateLimitError('GitHub is busy. Please try again later.');
    }
    if (response.status >= 500 || (response.ok && result?.ok !== true && result?.ok !== false)) {
      throw new ProvisioningOutcomeUnknownError('commit service outcome is unknown');
    }
    if (!response.ok || result?.ok !== true) throw new Error(`commit service refused create_game (${response.status})`);
    const { owner, name } = game.repository ?? this.#instanceRepo;
    return { owner, repo: name, url: `https://github.com/${owner}/${name}`, path: gameFolder(game.slug) };
  }
}
