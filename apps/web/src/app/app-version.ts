/*
 * A home-screen app on iOS resumes the page it had in memory, so a deploy reaches it only after a full relaunch. On
 * every resume, compare this page's entry bundle with the one the site serves now and reload once when they differ,
 * waiting until no game is running so a resume never throws away play.
 */
const ENTRY = /\/assets\/index-([\w-]+)\.js/;
const RELOADED_KEY = 'ogm-reloaded-for';
const CHECK_EVERY_MS = 60_000;

export function currentBuild(doc: Document = document): string | undefined {
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
    const match = ENTRY.exec(script.src);
    if (match) return match[1];
  }
  return undefined;
}

export async function deployedBuild(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  // The service worker passes `ogm-version` requests straight to the network.
  const response = await fetchImpl('/?ogm-version=1', { cache: 'no-store' });
  if (!response.ok) return undefined;
  return ENTRY.exec(await response.text())?.[1];
}

function readReloaded(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_KEY);
  } catch {
    return null;
  }
}

function markReloaded(build: string): void {
  try {
    sessionStorage.setItem(RELOADED_KEY, build);
  } catch {
    /* Private mode: the per-deploy guard is lost, the reload still happens once per resume at most. */
  }
}

export function watchForNewDeploy({
  win = window,
  doc = document,
  fetchImpl = fetch,
  now = () => Date.now(),
}: { win?: Window; doc?: Document; fetchImpl?: typeof fetch; now?: () => number } = {}): () => void {
  const running = currentBuild(doc);
  if (!running) return () => undefined;
  let lastCheck = now();
  let waiting: ReturnType<typeof setInterval> | undefined;
  const gameRunning = () => doc.querySelector('.game-frame iframe') !== null;
  const reload = (build: string) => {
    if (gameRunning()) {
      waiting ??= setInterval(() => {
        if (gameRunning()) return;
        clearInterval(waiting);
        reload(build);
      }, 5_000);
      return;
    }
    markReloaded(build);
    win.location.reload();
  };
  const check = async () => {
    if (doc.visibilityState !== 'visible' || waiting !== undefined || now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = now();
    const deployed = await deployedBuild(fetchImpl).catch(() => undefined);
    if (deployed && deployed !== running && readReloaded() !== deployed) reload(deployed);
  };
  const onVisible = () => void check();
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('pageshow', onVisible);
  return () => {
    doc.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('pageshow', onVisible);
    if (waiting !== undefined) clearInterval(waiting);
  };
}
