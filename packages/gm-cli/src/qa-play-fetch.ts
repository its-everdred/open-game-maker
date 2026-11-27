/** Fetch a newly published build's JSON, allowing time for the host to expose it. */
export async function fetchBuildJson(
  url: URL,
  options: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ value?: unknown; error?: string }> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let cause = 'no response';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      if (response.ok) {
        try {
          return { value: await response.json() };
        } catch (error) {
          cause =
            error instanceof SyntaxError
              ? `invalid JSON: ${error.message}`
              : error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error);
        }
      } else cause = `HTTP ${response.status} ${response.statusText}`.trim();
    } catch (error) {
      cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    if (attempt < 4) await sleep(1000 * 2 ** attempt);
  }
  return { error: `${url.pathname}: ${cause} after 5 attempts` };
}

/** Allow extra wall time on a busy host, with a finite maximum. */
export function loadFactor(load: number, cores: number): number {
  return Math.max(1, Math.min(2, load / Math.max(1, cores)));
}
