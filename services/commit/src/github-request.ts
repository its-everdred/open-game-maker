import type { GitHubRequest, GitHubResponse } from './types.js';

type Log = (entry: Record<string, unknown>) => void;

type Delay = (milliseconds: number) => Promise<void>;

export class GitHubRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GitHubRequestError';
    this.status = status;
  }
}

export class GitHubRateLimitError extends GitHubRequestError {
  constructor() {
    super('github rate limited', 429);
    this.name = 'GitHubRateLimitError';
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function headersOf(error: unknown): Record<string, string | undefined> {
  if (typeof error !== 'object' || error === null || !('response' in error)) return {};
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('headers' in response)) return {};
  const headers = response.headers;
  return typeof headers === 'object' && headers !== null ? (headers as Record<string, string | undefined>) : {};
}

function messageOf(error: unknown): string {
  if (
    statusOf(error) === 422 &&
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    /fast.?forward|reference update failed/iu.test(String(error.message))
  )
    return 'reference update failed';
  return 'github request failed';
}

// GitHub can echo request data, so emit only fixed, recognized response summaries.
function diagnosticMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) return 'github request failed';
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) return 'github request failed';
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('message' in data)) return 'github request failed';
  const message = data.message;
  if (typeof message !== 'string') return 'github request failed';
  const safe = [
    'Not Found',
    'Bad credentials',
    'Resource not accessible by integration',
    'Validation Failed',
    'API rate limit exceeded',
    'Requires authentication',
  ];
  if (safe.includes(message)) return message;
  if (/^GH013: Repository rule violations found for /u.test(message)) return 'GH013: Repository rule violations found';
  return 'github request failed';
}

function retryDelay(headers: Record<string, string | undefined>, now: () => number): number {
  const retryAfter = Number(headers['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1_000;

  const resetAt = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(resetAt)) return Math.max(0, resetAt * 1_000 - now());
  return 1_000;
}

function isRateLimited(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429) return true;
  if (status !== 403) return false;
  const headers = headersOf(error);
  return headers['retry-after'] !== undefined || headers['x-ratelimit-remaining'] === '0';
}

const defaultDelay: Delay = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export function withSafeGitHubRequests(
  request: GitHubRequest,
  delay: Delay = defaultDelay,
  now: () => number = Date.now,
  log?: Log,
): GitHubRequest {
  return async <T>(route: string, parameters: Record<string, unknown> = {}): Promise<GitHubResponse<T>> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await request<T>(route, parameters);
      } catch (error) {
        log?.({
          event: 'github-request-error',
          status: statusOf(error),
          endpoint: route,
          message: diagnosticMessage(error),
        });
        if (!isRateLimited(error)) {
          throw new GitHubRequestError(messageOf(error), statusOf(error));
        }
        if (attempt === 1) throw new GitHubRateLimitError();
        await delay(retryDelay(headersOf(error), now));
      }
    }
    throw new GitHubRateLimitError();
  };
}
