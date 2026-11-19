import type { Visibility } from '../types.js';
import { fetchWithTimeout } from '../fetch-timeout.js';
import { apiHeaders } from '../api-headers.js';

export type ActiveRepository = {
  gameId: string;
  owner: string;
  name: string;
  visibility: Visibility;
  // The game's folder in the instance repository, and its current URL slug for release tags.
  path: string;
  slug: string;
};

export interface BoundaryApi {
  activeRepositories(): Promise<ActiveRepository[]>;
  piiTerms(gameId: string): Promise<string[]>;
}

export class BoundaryApiError extends Error {
  constructor() {
    super('boundary API request failed');
    this.name = 'BoundaryApiError';
  }
}

export class BoundaryApiClient implements BoundaryApi {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: { baseUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.#token = options.token;
    this.#fetch = fetchWithTimeout(options.fetch ?? fetch, options.timeoutMs);
  }

  async #json(path: string): Promise<unknown> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        headers: apiHeaders(this.#token),
      });
      if (!response.ok) throw new BoundaryApiError();
      return await response.json();
    } catch {
      throw new BoundaryApiError();
    }
  }

  async activeRepositories(): Promise<ActiveRepository[]> {
    const body = await this.#json('/internal/games/active-repos');
    if (typeof body !== 'object' || body === null || !('repositories' in body) || !Array.isArray(body.repositories)) {
      throw new BoundaryApiError();
    }
    if (!body.repositories.every(isActiveRepository)) throw new BoundaryApiError();
    return body.repositories;
  }

  async piiTerms(gameId: string): Promise<string[]> {
    const body = await this.#json(`/internal/games/${encodeURIComponent(gameId)}/pii-terms`);
    if (typeof body !== 'object' || body === null || !('terms' in body) || !Array.isArray(body.terms)) {
      throw new BoundaryApiError();
    }
    return body.terms.filter((term): term is string => typeof term === 'string');
  }
}

function isActiveRepository(value: unknown): value is ActiveRepository {
  if (typeof value !== 'object' || value === null) return false;
  const repository = value as Record<string, unknown>;
  return (
    typeof repository.gameId === 'string' &&
    typeof repository.owner === 'string' &&
    typeof repository.name === 'string' &&
    typeof repository.path === 'string' &&
    typeof repository.slug === 'string' &&
    (repository.visibility === 'private' || repository.visibility === 'public')
  );
}
