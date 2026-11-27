import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentBuild, watchForNewDeploy } from './app-version';

const page = (build: string) => `<script type="module" crossorigin src="/assets/index-${build}.js"></script>`;

function setup(served: string) {
  document.head.innerHTML = page('old111');
  document.body.innerHTML = '';
  sessionStorage.clear();
  let clock = 0;
  const reload = vi.fn();
  const win = {
    location: { reload },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  } as unknown as Window;
  const fetchImpl = vi.fn(async () => new Response(page(served))) as unknown as typeof fetch;
  const stop = watchForNewDeploy({ win, fetchImpl, now: () => clock });
  const resume = async (afterMs = 61_000) => {
    clock += afterMs;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
  };
  return { reload, fetchImpl, stop, resume };
}

describe('watchForNewDeploy', () => {
  afterEach(() => vi.useRealTimers());

  it('reads the running build from the entry script', () => {
    document.head.innerHTML = page('uo0lVn_T');
    expect(currentBuild()).toBe('uo0lVn_T');
  });

  it('reloads a resumed home-screen app that still runs an older deploy', async () => {
    const { reload, resume, stop } = setup('new222');
    await resume();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(sessionStorage.getItem('ogm-reloaded-for')).toBe('new222');
    stop();
  });

  it('leaves a current page alone', async () => {
    const { reload, resume, stop } = setup('old111');
    await resume();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('reloads only once per deploy, so a CDN serving mixed copies cannot loop', async () => {
    const { reload, resume, stop } = setup('new222');
    sessionStorage.setItem('ogm-reloaded-for', 'new222');
    await resume();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('waits for the running game to close before reloading', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { reload, resume, stop } = setup('new222');
    document.body.innerHTML = '<div class="game-frame"><iframe></iframe></div>';
    await resume();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    vi.advanceTimersByTime(5_000);
    expect(reload).toHaveBeenCalledOnce();
    stop();
  });
});
