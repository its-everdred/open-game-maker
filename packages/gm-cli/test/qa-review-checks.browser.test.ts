import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mediaFailures, optionFailures, settleMedia, swipeDeckFailures } from '../src/qa-review-checks.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;

// The review dialog's markup as the app renders it (SwipeVerdict, RoundMedia, CommandReviewCard), with the E2E's own
// fixture media, so the checks see a real picture, clip and sound load or fail in Chromium.
const MEDIA = new URL('../qa/review-e2e/', import.meta.url);
const TYPES: Record<string, string> = { 'still.png': 'image/png', 'clip.mp4': 'video/mp4', 'sound.mp3': 'audio/mpeg' };
const ORIGIN = 'http://review.test';

type Page = {
  still?: string;
  clip?: string;
  sound?: string;
  options?: number;
  hideOption?: number;
  /** An option whose media is drawn but transparent. */
  clearMedia?: number;
  noMedia?: number;
  swipe?: boolean;
  controls?: boolean;
  paged?: boolean;
};

function html({
  still = 'still.png',
  clip = 'clip.mp4',
  sound = 'sound.mp3',
  options = 3,
  hideOption,
  clearMedia,
  noMedia,
  swipe = true,
  controls = true,
  paged = false,
}: Page) {
  const media = [
    `<img src="${still}" alt="Picture">`,
    `<video src="${clip}" controls playsinline autoplay muted loop></video>`,
    `<audio controls src="${sound}" aria-label="Sound"></audio>`,
  ];
  const option = (index: number) =>
    `<div class="worker-review-option"${index === hideOption ? ' style="visibility:hidden"' : ''}>` +
    (index === noMedia ? '' : index === clearMedia ? `<div style="opacity:0">${media[index]}</div>` : media[index]) +
    `<button type="button">Pick ${String.fromCharCode(65 + index)}: Option</button></div>`;
  return `<!doctype html><body>
<div role="dialog" aria-label="Needs Review">
  <div class="worker-review-swipe" tabindex="0">
    <div class="review-deck-playable"><img src="${still}" alt="Review" width="200" height="120"></div>
  </div>
  ${controls ? '<div><button type="button">Looks good</button><button type="button">Needs changes</button></div>' : ''}
  ${paged ? Array.from({ length: options }, (_, index) => `<button aria-label="View option ${String.fromCharCode(65 + index)}" data-option="${index}">View</button>`).join('') : ''}
  <div class="worker-review-options">${Array.from({ length: paged ? Math.min(options, 1) : options }, (_, index) => option(index)).join('')}</div>
</div>
<script>
  const options = ${JSON.stringify(Array.from({ length: options }, (_, index) => option(index)))};
  document.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('.worker-review-options').innerHTML = options[Number(button.dataset.option)];
  }));
  const card = document.querySelector('.worker-review-swipe');
  let start;
  if (${swipe}) {
    card.addEventListener('pointerdown', (event) => { start = event.clientX; });
    card.addEventListener('pointermove', (event) => {
      if (start !== undefined) card.style.transform = 'translateX(' + (event.clientX - start) + 'px)';
    });
    card.addEventListener('pointerup', () => { start = undefined; card.style.transform = ''; });
  }
</script></body>`;
}

let browser: Browser;

beforeAll(async () => {
  const { launch } = await import('@ogm/gm-verify');
  browser = await launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function open(page: Page) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === 'index.html') return route.fulfill({ contentType: 'text/html', body: html(page) });
    if (TYPES[file]) return route.fulfill({ contentType: TYPES[file], body: readFileSync(new URL(file, MEDIA)) });
    return route.fulfill({ status: 404, body: '' });
  });
  const tab = await context.newPage();
  await tab.goto(`${ORIGIN}/index.html`);
  const dialog = tab.getByRole('dialog', { name: 'Needs Review' });
  return { tab, dialog, close: () => context.close() };
}

async function failures(page: Page, settleMs = 10_000) {
  const { tab, dialog, close } = await open(page);
  try {
    await settleMedia(dialog, settleMs);
    return [
      ...(await mediaFailures(dialog, 'the review')),
      ...(await swipeDeckFailures(tab, dialog)),
      ...(await optionFailures(dialog, 3)),
    ];
  } finally {
    await close();
  }
}

describe('the review E2E checks what the creator sees', () => {
  it('pass a deck whose pictures, clips and sounds all load, with every option and the swipe card', async () => {
    expect(await failures({})).toEqual([]);
  });

  // The revert check: one media URL broken in the fixture fails the run, naming the element.
  it('fail on a picture whose URL is broken', async () => {
    const found = await failures({ still: 'gone.png' }, 2_000);
    expect(found).toContain('the review <img "Review" gone.png> did not load (naturalWidth 0)');
    expect(found).toContain('the review <img "Picture" gone.png> did not load (naturalWidth 0)');
  });

  it('fail on a clip that never reaches a playable frame', async () => {
    expect(await failures({ clip: 'gone.mp4' }, 2_000)).toContain(
      'the review <video gone.mp4> did not load (readyState 0)',
    );
  });

  // A looping clip drops to readyState 1 for a few ms each time it seeks back to its start; sampled then, the prod run
  // failed a deck whose clip was playing (#875). A clip that has played and has no error is loaded.
  it('pass a looping clip caught while it seeks back to its start', async () => {
    const { tab, dialog, close } = await open({});
    try {
      await settleMedia(dialog);
      await tab.evaluate(() => {
        for (const video of document.querySelectorAll('video'))
          Object.defineProperty(video, 'readyState', { get: () => HTMLMediaElement.HAVE_METADATA });
      });
      expect(await mediaFailures(dialog, 'the review')).toEqual([]);
      // Having played once is not enough: a clip that then failed still fails the run.
      await tab.evaluate(() => {
        for (const video of document.querySelectorAll('video'))
          Object.defineProperty(video, 'error', { get: () => ({ code: MediaError.MEDIA_ERR_NETWORK }) });
      });
      expect(await mediaFailures(dialog, 'the review')).toEqual([
        'the review <video clip.mp4> did not load (readyState 1)',
      ]);
    } finally {
      await close();
    }
  });

  it('fail on a sound with no length', async () => {
    expect(await failures({ sound: 'gone.mp3' }, 2_000)).toContain(
      'the review <audio "Sound" gone.mp3> did not load (duration NaN)',
    );
  });

  it('fail when the deck shows fewer options than the Command carries, or one is not on screen', async () => {
    expect(await failures({ options: 1 })).toEqual(['the Command shows 1 of 3 options']);
    expect(await failures({ hideOption: 2 })).toContain('option C media is not on screen');
    expect(await failures({ clearMedia: 1 })).toEqual(['option B media is not on screen']);
    expect(await failures({ noMedia: 0 })).toEqual(['option A shows no media']);
  });

  it('checks each navigable option and its loaded media in a card deck', async () => {
    expect(await failures({ paged: true })).toEqual([]);
    expect(await failures({ paged: true, noMedia: 1 })).toContain('option B shows no media');
    expect(await failures({ paged: true, options: 1 })).toContain('the Command shows 1 of 3 options');
  });

  it('fail when the round has no card that follows a drag, or no approve and changes controls', async () => {
    expect(await failures({ swipe: false, controls: false })).toEqual([
      'the swipe card does not follow a drag',
      'the round has no "Looks good" control',
      'the round has no "Needs changes" control',
    ]);
  });
});
