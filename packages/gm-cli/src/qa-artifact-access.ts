/** Obtain an operator-scoped URL without placing the internal credential in it. */
export async function operatorArtifactUrl(input: {
  apiPort: string | undefined;
  token: string | undefined;
  game: string;
  build: string;
  gamesOrigin: string;
}): Promise<string> {
  if (!input.apiPort || !/^\d+$/u.test(input.apiPort) || !input.token)
    throw new Error('operator artifact access is not configured');
  const response = await fetch(
    `http://127.0.0.1:${input.apiPort}/internal/operator/games/${encodeURIComponent(input.game)}/builds/${encodeURIComponent(input.build)}/access`,
    {
      method: 'POST',
      headers: { 'x-ogm-internal': input.token },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => {
    throw new Error('operator artifact access is unavailable');
  });
  if (!response.ok) throw new Error(`operator artifact access returned HTTP ${response.status}`);
  const result = (await response.json()) as { url?: unknown };
  if (typeof result.url !== 'string' || new URL(result.url).origin !== new URL(input.gamesOrigin).origin)
    throw new Error('operator artifact access returned an unexpected origin');
  return result.url;
}
