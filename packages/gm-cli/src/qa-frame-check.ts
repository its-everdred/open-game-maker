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

const REFUSAL = /frame-ancestors|frame-src|Content Security Policy|X-Frame-Options|Refused to (?:load|display|frame)/iu;

export function isFrameRefusal(text: string): boolean {
  return REFUSAL.test(text);
}

export function frameFailures(observation: FrameObservation): string[] {
  const failures = [
    ...(observation.error ? [`did not load: ${observation.error}`] : []),
    ...observation.refusals.map((line) => `refused: ${line}`),
  ];
  if (!observation.error && !observation.drew) failures.push('the game frame stayed empty');
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
      if (isFrameRefusal(text)) observation.refusals.push(text.replace(/\s+/gu, ' ').slice(0, 300));
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
    observation.drew = frame
      ? await frame
          .evaluate(() => (document.body?.childElementCount ?? 0) + (document.head?.childElementCount ?? 0) > 0)
          .catch(() => false)
      : false;
  } catch (error) {
    observation.error = (error instanceof Error ? error.message.split('\n')[0]! : String(error)).slice(0, 300);
  } finally {
    await context.close();
  }
  return observation;
}
