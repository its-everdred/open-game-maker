import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { settleMedia } from '../src/qa-review-checks.js';
import { detailFailures } from '../src/qa-ticket-detail-e2e.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;

// The ticket detail's markup as the app renders it (TicketDetail.tsx) with the E2E's fixture media, so the check sees
// what Kevin would on his phone: the summary, a picture, clip and sound that load, his verdict quoted, no sideways scroll.
const MEDIA = new URL('../qa/review-e2e/', import.meta.url);
const TYPES: Record<string, string> = { 'still.png': 'image/png', 'clip.mp4': 'video/mp4', 'sound.mp3': 'audio/mpeg' };
const ORIGIN = 'http://detail.test';

type Shape = { still?: string; quote?: boolean; wide?: boolean };

function html({ still = 'still.png', quote = true, wide = false }: Shape) {
  return `<!doctype html><body style="margin:0">
<section role="dialog" aria-label="QA running ticket"><h2>QA running ticket</h2>
  <div class="ticket-detail-body" style="overflow-x:hidden;overflow-y:auto;width:360px">
    <p>QA: building the forest backdrop.</p>
    <ul>
      <li><img src="${still}" alt="Forest still" style="width:100%"></li>
      <li><video src="clip.mp4" controls playsinline muted style="width:100%"></video></li>
      <li><audio src="sound.mp3" controls style="width:100%"></audio></li>
    </ul>
    ${wide ? '<div style="width:900px">wide</div>' : ''}
    <ol><li><time>Nov 17</time><span>Needs changes</span>${quote ? '<blockquote>QA: make it greener</blockquote>' : ''}</li></ol>
  </div>
</section></body>`;
}

let browser: Browser;
beforeAll(async () => {
  const { launch } = await import('@ogm/gm-verify');
  browser = await launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function failures(shape: Shape, settleMs = 10_000) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.route(`${ORIGIN}/**`, (route) => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (file === 'index.html') return route.fulfill({ contentType: 'text/html', body: html(shape) });
      if (TYPES[file]) return route.fulfill({ contentType: TYPES[file], body: readFileSync(new URL(file, MEDIA)) });
      return route.fulfill({ status: 404, body: '' });
    });
    const tab = await context.newPage();
    await tab.goto(`${ORIGIN}/index.html`);
    const dialog = tab.getByRole('dialog', { name: 'QA running ticket' });
    await settleMedia(dialog, settleMs);
    return await detailFailures(dialog, 'the running ticket');
  } finally {
    await context.close();
  }
}

describe('the ticket detail check', () => {
  it('passes a detail with its summary, loaded media and the verdict quote', async () => {
    expect(await failures({})).toEqual([]);
  });

  it('fails on a broken picture, a missing quote, or a detail that scrolls sideways', async () => {
    expect(await failures({ still: 'gone.png' }, 2_000)).toContain(
      'the running ticket <img "Forest still" gone.png> did not load (naturalWidth 0)',
    );
    expect(await failures({ quote: false })).toEqual(['the running ticket: no verdict quote']);
    expect(await failures({ wide: true })).toEqual(['the running ticket: scrolls sideways']);
  });
});
