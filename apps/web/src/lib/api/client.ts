export type ApiInit = RequestInit & { json?: unknown };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`api ${status}`);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const responseBody = await readBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, responseBody);
  }

  return responseBody as T;
}

export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  requireApiPath(path);
  const { json, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  let body = requestInit.body;
  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(json);
  }
  const response = await fetch(`/api/v1${path}`, {
    ...requestInit,
    body,
    credentials: 'include',
    headers,
  });
  const userId = response.headers.get('x-ogm-user-id');
  const capability = response.headers.get('x-ogm-capability');
  const platformRole = response.headers.get('x-ogm-platform-role');
  if (
    typeof window !== 'undefined' &&
    path !== '/me' &&
    userId &&
    (capability === 'player' || capability === 'creator') &&
    (platformRole === 'admin' || platformRole === 'maintainer' || platformRole === 'none')
  ) {
    window.dispatchEvent(new CustomEvent('ogm:access-state', { detail: { userId, capability, platformRole } }));
  }
  if (typeof window !== 'undefined' && response.status === 403 && path !== '/me')
    window.dispatchEvent(new Event('ogm:access-denied'));
  return response;
}

export function sse(path: string): EventSource {
  requireApiPath(path);
  return new EventSource(`/api/v1${path}`);
}

function requireApiPath(path: string): void {
  if (!path.startsWith('/')) {
    throw new TypeError('API paths must start with /');
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (text === '') return undefined;

  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? JSON.parse(text) : text;
}
