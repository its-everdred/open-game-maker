type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launchWebkit']>>;

/** What one app domain showed when it framed a game: where it landed and whether the frame drew. */
export type FrameObservation = {
  app: string;
  /** The origin the app page ended on after redirects; null when it never loaded. */
  landed: string | null;
  /** The game frame's document had content; a frame the browser refused stays empty. */
  drew: boolean;
  /** Console lines in which the browser refused the frame (frame-ancestors, frame-src, X-Frame-Options). */
  refusals: string[];
  error?: string;
};

/* Only refusals of a frame: the game's own CSP lines (img-src, connect-src) are not this check's business. */
const REFUSAL = /frame-ancestors|frame-src|X-Frame-Options|Refused to (?:display|frame)/iu;
const redact = (text: string) => text.replace(/(\/d\/[^/]+\/[^/]+\/)[^/\s]+/gu, '$1<redacted>');

export function isFrameRefusal(text: string): boolean {
  return REFUSAL.test(text);
}

/**
 * What failed on one domain. An alias (`canonical` set) must also land on the canonical origin: one that serves the app
 * itself frames fine while the API and auth do not trust it.
 */
export function frameFailures(observation: FrameObservation, canonical?: string): string[] {
  const failures = [
    ...(observation.error ? [`did not load: ${observation.error}`] : []),
    ...observation.refusals.map((line) => `refused: ${line}`),
  ];
  if (!observation.error && !observation.drew) failures.push('the game frame stayed empty');
  if (canonical && observation.landed && observation.landed !== canonical)
    failures.push(`stayed on ${observation.landed} instead of redirecting to ${canonical}`);
  return failures;
}

/**
 * Open `app` (following any redirect, as a phone does), add an iframe of `frameUrl` to the page and report whether the
 * browser framed it. Only the app document loads; the check never waits for the app itself to boot.
 */
export async function observeFrame(
  browser: Browser,
  app: string,
  frameUrl: string,
  timeoutMs = 30_000,
): Promise<FrameObservation> {
  const observation: FrameObservation = { app, landed: null, drew: false, refusals: [] };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (isFrameRefusal(text)) observation.refusals.push(redact(text.replace(/\s+/gu, ' ').slice(0, 300)));
    });
    await page.goto(app, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    observation.landed = new URL(page.url()).origin;
    await page.evaluate(
      ({ src, ms }) =>
        new Promise<void>((done) => {
          const frame = document.createElement('iframe');
          frame.setAttribute('data-frame-check', '');
          frame.src = src;
          frame.addEventListener('load', () => done());
          setTimeout(done, ms);
          document.body.append(frame);
        }),
      { src: frameUrl, ms: timeoutMs },
    );
    const frame = await (await page.$('iframe[data-frame-check]'))?.contentFrame();
    /* A frame still navigating never answers; give it 5 s rather than hold the whole check. */
    observation.drew = frame
      ? await Promise.race([
          frame
            .evaluate(() => (document.body?.childElementCount ?? 0) + (document.head?.childElementCount ?? 0) > 0)
            .catch(() => false),
          new Promise<boolean>((done) => setTimeout(() => done(false), 5_000)),
        ])
      : false;
  } catch (error) {
    observation.error = redact((error instanceof Error ? error.message.split('\n')[0]! : String(error)).slice(0, 300));
  } finally {
    await context.close();
  }
  return observation;
}
