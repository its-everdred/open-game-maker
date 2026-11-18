type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;
type Locator = ReturnType<Page['locator']>;

// What Kevin sees, checked the way he would see it (#863): every picture drew, every clip can play, every sound has a
// length. A check that passed on a screen of broken images (#859 on prod d5d08305e) is worse than none.

/** How long a clip may take to reach a playable frame, and a sound to learn its length. */
export const MEDIA_TIMEOUT_MS = 10_000;

type MediaState = { tag: string; name: string; ok: boolean; detail: string };

// Runs in the page: each <img>, <video> and <audio> under the root, named by its label or file, and whether it loaded.
function mediaStates(root: Element): MediaState[] {
  return [...root.querySelectorAll<HTMLImageElement | HTMLMediaElement>('img, video, audio')].map((element) => {
    const tag = element.tagName.toLowerCase();
    const src = element.getAttribute('src') ?? '';
    const label = element.getAttribute('alt') || element.getAttribute('aria-label');
    const name = `<${tag}${label ? ` "${label}"` : ''}${src ? ` ${src.split(/[?#]/u)[0]!.split('/').pop()}` : ' no src'}>`;
    if (element instanceof HTMLImageElement) {
      const ok = element.complete && element.naturalWidth > 0;
      return { tag, name, ok, detail: ok ? '' : `naturalWidth ${element.naturalWidth}` };
    }
    if (element instanceof HTMLVideoElement) {
      // A looping clip drops to readyState 1 for a few ms each time it seeks back to its start (#875), so a clip that
      // has played a frame and has no error counts as loaded.
      const ok = element.error === null && (element.readyState >= 2 || element.played.length > 0);
      return { tag, name, ok, detail: ok ? '' : `readyState ${element.readyState}` };
    }
    const ok = element.duration > 0;
    return { tag, name, ok, detail: ok ? '' : `duration ${element.duration}` };
  });
}

/**
 * Open the Builds popover, filter to reviews, and select an item. The app's PR-CI spec
 * (apps/web/e2e/studio-menu.spec.ts) opens the deck through this same step, so a change to the path fails CI before it
 * reaches the prod E2E (#891).
 */
export async function openReviewDeck(
  page: Page,
  timeout = 20_000,
  title?: string,
  expected?: string[],
  activeTitle?: string,
): Promise<Locator> {
  await page.locator('.worker-tracker-button').click({ timeout });
  const panel = page.getByRole('region', { name: 'Builds' });
  if (activeTitle) await panel.getByRole('button', { name: new RegExp(`^${activeTitle}`, 'u') }).waitFor({ timeout });
  await panel.getByRole('button', { name: /\d+ need review/i }).click({ timeout });
  const items = panel.locator('.worker-tracker-list button');
  if (expected) {
    for (const name of expected) await panel.getByRole('button', { name, exact: true }).waitFor({ timeout });
    if ((await items.count()) !== expected.length) throw new Error('filtered review list has an unexpected item count');
  }
  await (title ? panel.getByRole('button', { name: title, exact: true }) : items.first()).click({ timeout });
  const dialog = page.getByRole('dialog', { name: 'Needs Review' });
  await dialog.waitFor({ timeout });
  return dialog;
}

/** Waits up to `timeoutMs` for the media under `root` to load; returns once it has or the time is up. */
export async function settleMedia(root: Locator, timeoutMs = MEDIA_TIMEOUT_MS): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const states = await root.evaluate(mediaStates).catch(() => []);
    if (states.length > 0 && states.every((state) => state.ok)) return;
    if (Date.now() > until) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The media under `root` that did not load, one line each, naming the element (call `settleMedia` first). */
export async function mediaFailures(root: Locator, where: string): Promise<string[]> {
  const states = await root.evaluate(mediaStates);
  if (states.length === 0) return [`${where} shows no media`];
  return states.filter((state) => !state.ok).map((state) => `${where} ${state.name} did not load (${state.detail})`);
}

/**
 * The round's swipe deck: a card that follows a drag, with approve and changes controls beside it. The drag is
 * released short of a vote, so the card springs back unjudged.
 */
export async function swipeDeckFailures(page: Page, dialog: Locator): Promise<string[]> {
  const failures: string[] = [];
  const card = dialog.locator('.worker-review-swipe').first();
  if (!(await card.isVisible())) failures.push('the round has no swipe card');
  else {
    // The card ignores a press on a clip or sound control, so the drag starts on its picture.
    const grip = card.locator('img').first();
    if (await grip.count()) await grip.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    const box = (await grip.count()) ? await grip.boundingBox() : null;
    if (!box) failures.push('the swipe card has no picture to drag');
    else {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y, { steps: 4 });
      const moved = await card.evaluate((element) => (element as HTMLElement).style.transform);
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.up();
      if (!moved || moved === 'none') failures.push('the swipe card does not follow a drag');
    }
  }
  for (const name of ['Looks good', 'Needs changes'])
    if (!(await dialog.getByRole('button', { name, exact: true }).isVisible()))
      failures.push(`the round has no "${name}" control`);
  return failures;
}

/**
 * The Command's options: as many on screen as the Command carries, each one showing its media (scrolled to, drawn,
 * not transparent, hidden or covered) and its pick button.
 */
export async function optionFailures(dialog: Locator, expected: number): Promise<string[]> {
  const options = dialog.locator('.worker-review-option');
  const navigation = dialog.getByRole('button', { name: /^View option [A-E]$/u });
  const paged = (await navigation.count()) > 0;
  const count = paged ? await navigation.count() : await options.count();
  const failures = count === expected ? [] : [`the Command shows ${count} of ${expected} options`];
  for (let index = 0; index < count; index += 1) {
    const letter = String.fromCharCode(65 + index);
    if (paged) await navigation.nth(index).click();
    const option = options.nth(paged ? 0 : index);
    if (paged) {
      await settleMedia(option);
      failures.push(...(await mediaFailures(option, `option ${letter}`)));
    }
    await option.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    const media = await option.evaluate((root) => {
      const all = [...root.querySelectorAll('img, video, audio')];
      const seen = (element: Element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        for (let node: Element | null = element; node && node !== root.parentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        }
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit !== null && (element === hit || element.contains(hit));
      };
      return { count: all.length, shown: all.filter(seen).length };
    });
    if (media.count === 0) failures.push(`option ${letter} shows no media`);
    else if (media.shown < media.count) failures.push(`option ${letter} media is not on screen`);
    if (!(await option.getByRole('button', { name: new RegExp(`^Pick ${letter}`, 'u') }).isVisible()))
      failures.push(`option ${letter} has no pick button`);
  }
  if (paged && count > 0) await navigation.first().click();
  return failures;
}
