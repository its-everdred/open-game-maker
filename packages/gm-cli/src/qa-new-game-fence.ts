/** Hold the commit service's durable per-game fence across all remote cleanup and row deletion. */
export class QaCreateFenceClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(method: 'POST' | 'DELETE', id: string, owner: string) {
    if (!/^g_[A-Za-z0-9_-]+$/u.test(id) || !/^[a-z0-9-]{1,40}$/u.test(owner)) throw new Error('invalid QA fence');
    const response = await this.fetcher(`${this.base}/internal/qa/create-fence/${encodeURIComponent(id)}`, {
      method,
      headers: { 'x-ogm-internal': this.token, 'content-type': 'application/json' },
      body: JSON.stringify({ owner }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`QA fence returned ${response.status}`);
    return (await response.json()) as { ready?: unknown; released?: unknown };
  }

  async acquire(id: string, owner: string): Promise<void> {
    const until = Date.now() + 40 * 60_000;
    for (;;) {
      const result = await this.request('POST', id, owner);
      if (result.ready === true) return;
      if (result.ready !== false) throw new Error('invalid commit service QA fence response');
      if (Date.now() >= until) throw new Error('QA create operation did not finish; its fence remains held');
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  async release(id: string, owner: string): Promise<void> {
    if ((await this.request('DELETE', id, owner)).released !== true)
      throw new Error('QA fence release was not verified');
  }

  async terminal(id: string): Promise<boolean> {
    if (!/^g_[A-Za-z0-9_-]+$/u.test(id)) throw new Error('invalid QA game ID');
    const response = await this.fetcher(`${this.base}/internal/qa/create-audit/${encodeURIComponent(id)}`, {
      headers: { 'x-ogm-internal': this.token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`QA create audit returned ${response.status}`);
    const value = (await response.json()) as { terminal?: unknown };
    if (typeof value.terminal !== 'boolean') throw new Error('invalid QA create audit response');
    return value.terminal;
  }
}
