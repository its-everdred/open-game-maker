import type { GitHubRequest, GitHubResponse } from './types.js';

type Log = (entry: Record<string, unknown>) => void;

type Delay = (milliseconds: number) => Promise<void>;
export type RateLimitCooldown = { until: number };

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
  if (/secondary rate limit/iu.test(message)) return 'GitHub secondary rate limit';
  if (safe.includes(message)) return message;
  if (/^GH013: Repository rule violations found for /u.test(message)) return 'GH013: Repository rule violations found';
  return 'github request failed';
}

// Validation errors may contain submitted file content. Keep only fixed GitHub error codes.
function validationCodes(error: unknown): string[] {
  if (typeof error !== 'object' || error === null || !('response' in error)) return [];
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) return [];
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('errors' in data) || !Array.isArray(data.errors)) return [];
  const allowed = new Set(['missing', 'missing_field', 'invalid', 'already_exists', 'unprocessable']);
  return data.errors.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('code' in entry) || typeof entry.code !== 'string') return [];
    return allowed.has(entry.code) ? [entry.code] : [];
  });
}

function safeRateHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of [
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-used',
  ]) {
    const value = headers[key];
    if (value !== undefined && /^\d{1,12}$/u.test(value)) result[key] = value;
  }
  if (
    ['core', 'search', 'graphql', 'integration_manifest', 'code_scanning_upload'].includes(
      headers['x-ratelimit-resource'] ?? '',
    )
  ) {
    result['x-ratelimit-resource'] = headers['x-ratelimit-resource']!;
  }
  return result;
}

function retryDelay(headers: Record<string, string | undefined>, now: () => number): number {
  const retryAfter = Number(headers['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1_000;

  const resetAt = Number(headers['x-ratelimit-reset']);
  if (headers['x-ratelimit-remaining'] === '0' && Number.isFinite(resetAt)) return Math.max(0, resetAt * 1_000 - now());
  return 60_000;
}

function isRateLimited(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429) return true;
  if (status !== 403) return false;
  const headers = headersOf(error);
  return (
    headers['retry-after'] !== undefined ||
    headers['x-ratelimit-remaining'] === '0' ||
    diagnosticMessage(error) === 'GitHub secondary rate limit'
  );
}

const defaultDelay: Delay = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export function withSafeGitHubRequests(
  request: GitHubRequest,
  delay: Delay = defaultDelay,
  now: () => number = Date.now,
  log?: Log,
  cooldown: RateLimitCooldown = { until: 0 },
): GitHubRequest {
  return async <T>(route: string, parameters: Record<string, unknown> = {}): Promise<GitHubResponse<T>> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (now() < cooldown.until) throw new GitHubRateLimitError();
      try {
        return await request<T>(route, parameters);
      } catch (error) {
        log?.({
          event: 'github-request-error',
          status: statusOf(error),
          endpoint: route,
          message: diagnosticMessage(error),
          ...(statusOf(error) === 422 ? { validationCodes: validationCodes(error) } : {}),
          ...(statusOf(error) === 403 || statusOf(error) === 429
            ? { rateLimit: safeRateHeaders(headersOf(error)) }
            : {}),
        });
        if (!isRateLimited(error)) {
          throw new GitHubRequestError(messageOf(error), statusOf(error));
        }
        const wait = retryDelay(headersOf(error), now);
        cooldown.until = Math.max(cooldown.until, now() + wait);
        if (attempt === 1) throw new GitHubRateLimitError();
        // The API has a 30-second request budget; report a long backoff instead of timing out.
        if (wait > 5_000) throw new GitHubRateLimitError();
        await delay(wait);
      }
    }
    throw new GitHubRateLimitError();
  };
}
