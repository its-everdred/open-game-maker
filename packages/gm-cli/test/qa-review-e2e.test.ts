import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NOTE, PICK_NOTE, reached, reviewE2e, type Report } from '../src/qa-review-e2e.js';
import { reviewOptionImageReady, reviewRoundMediaReady } from '../src/qa-review-media.js';
import { gm, tempDir } from './helpers.js';

vi.mock('../src/qa-review-checks.js', () => ({
  settleMedia: async () => {},
  mediaFailures: async () => [],
  swipeDeckFailures: async () => [],
  optionFailures: async () => [],
}));

// The hammer's ticket-detail steps (#873) run first in each size and have their own browser test; this suite drives the
// review deck.
vi.mock('../src/qa-ticket-detail-e2e.js', () => ({ ticketDetailSteps: async () => {} }));

afterEach(() => vi.unstubAllGlobals());

it('rejects broken images and unloaded video or audio in the production readiness gate', () => {
  const image = { naturalWidth: 100 };
  const video = { readyState: 2 };
  const audio = { duration: 2 };
  const deck = { querySelector: (kind: string) => ({ img: image, video, audio })[kind as 'img' | 'video' | 'audio'] };
  vi.stubGlobal('document', {
    querySelector: (selector: string) => (selector === '.build-review-dialog' ? deck : image),
  });
  expect(reviewRoundMediaReady()).toBe(true);
  expect(reviewOptionImageReady()).toBe(true);
  image.naturalWidth = 0;
  expect(reviewRoundMediaReady()).toBe(false);
  expect(reviewOptionImageReady()).toBe(false);
  image.naturalWidth = 100;
  video.readyState = 1;
  expect(reviewRoundMediaReady()).toBe(false);
  video.readyState = 2;
  audio.duration = 0;
  expect(reviewRoundMediaReady()).toBe(false);
  audio.duration = 0.5;
  expect(reviewRoundMediaReady()).toBe(false);
});

it.each(['image', 'video', 'audio', 'option'] as const)(
  'fails the actual QA run when %s media does not load',
  async (broken) => {
    const image = { naturalWidth: broken === 'image' ? 0 : 100 };
    const video = { readyState: broken === 'video' ? 1 : 2 };
    const audio = { duration: broken === 'audio' ? 0 : 2 };
    const deck = { querySelector: (kind: string) => ({ img: image, video, audio })[kind as 'img' | 'video' | 'audio'] };
    vi.stubGlobal('document', {
      querySelector: (selector: string) =>
        selector === '.build-review-dialog' ? deck : { naturalWidth: broken === 'option' ? 0 : 100 },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"options":3}', { status: 200 })),
    );
    const element = {
      click: async () => {},
      waitFor: async () => {},
      fill: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }),
      first() {
        return this;
      },
      locator() {
        return this;
      },
      getByText() {
        return this;
      },
      getByRole() {
        return this;
      },
      getByLabel() {
        return this;
      },
      filter() {
        return this;
      },
    };
    const context = {
      addCookies: async () => {},
      close: async () => {},
      newCDPSession: async () => ({ send: async () => {}, detach: async () => {} }),
      newPage: async () => ({
        goto: async () => {},
        close: async () => {},
        screenshot: async () => {},
        getByRole: () => element,
        getByLabel: () => element,
        locator: () => element,
        context: () => context,
        waitForFunction: async (check: () => boolean) => {
          if (!check()) throw new Error('media did not load');
        },
      }),
    };
    const browser = { newContext: async () => context } as unknown as Parameters<typeof reviewE2e>[0];
    const results = await reviewE2e(browser, {
      origin: 'https://app.example.test',
      api: 'http://127.0.0.1:4300',
      internalToken: 'test',
      cookie: { name: 'session', value: 'test' },
      out: tempDir(),
      injectRegression: false,
      breakMedia: false,
      stamp: 'test',
    });
    const step = broken === 'option' ? 'pick B on the Command with a note' : 'load the round image, video and audio';
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.failure).toBe(`${step}: media did not load`);
    }
  },
);

function host(qa: string) {
  const home = tempDir();
  const env = join(home, '.config', 'ogm', 'env');
  mkdirSync(env, { recursive: true });
  writeFileSync(
    join(env, 'api.env'),
    'OGM_APP_ORIGIN=https://app.example.test\nOGM_API_PORT=4300\nOGM_INTERNAL_TOKEN=t\n',
  );
  if (qa) writeFileSync(join(env, 'qa.env'), qa);
  return home;
}

describe('gm qa review-e2e', () => {
  // The deploy hook reads the last line, so a host that cannot run the E2E still ends with a failing exit line.
  it('fails with its exit line when the host has no QA session', async () => {
    const { code, out, err } = await gm(['qa', 'review-e2e'], { home: host('') });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe('exit=1 qa-review-e2e');
    expect(err.join('\n')).toContain('ops/bin/ogm-qa-session');
  });

  it('fails with its exit line when the QA session has expired', async () => {
    const qa =
      'OGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=v\nOGM_QA_SESSION_EXPIRES=2020-01-01T00:00:00.000Z\n';
    const { code, out, err } = await gm(['qa', 'review-e2e'], { home: host(qa) });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe('exit=1 qa-review-e2e');
    expect(err.join('\n')).toContain('expired');
  });

  // Two runs at once share the host's one QA game: each clears and seeds its fixtures, so one wiped the other's cards
  // and the deck never opened (#875). A second run waits for the first and gives up rather than run alongside it.
  it('does not start while another run holds the QA game', async () => {
    const home = host('OGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=v\n');
    const { acquireSlot } = await import('@ogm/gm-verify');
    const held = await acquireSlot({
      runtimeDir: join(home, '.local', 'state', 'ogm', 'qa', 'review-e2e-lock'),
      slots: 1,
    });
    const launched = vi.fn();
    vi.stubGlobal('fetch', launched);
    try {
      const { code, out, err } = await gm(['qa', 'review-e2e'], { home, env: { OGM_QA_LOCK_WAIT_MS: '50' } });
      expect(code).toBe(1);
      expect(out.at(-1)).toBe('exit=1 qa-review-e2e');
      expect(err.join('\n')).toContain('another review E2E still held the QA game');
      expect(launched).not.toHaveBeenCalled();
    } finally {
      held.release();
    }
  });
});

describe('verdicts reaching aiur', () => {
  const delivered: Report = {
    round: { verdict: 'needs_work', notes: NOTE, dispatch: 'delivered' },
    received: [
      { kind: 'answer', response: JSON.stringify({ answers: [{ option_id: 'b' }], notes: PICK_NOTE }) },
      { kind: 'rework', reason: `<!-- marker -->\n${NOTE}` },
    ],
  };

  it('passes only when the round note and the Command pick with its note both arrived', () => {
    expect(reached(delivered)).toBeNull();
  });

  it('fails when the round verdict stayed in the app', () => {
    expect(reached({ ...delivered, received: delivered.received.filter((item) => item.kind !== 'rework') })).toBe(
      'the round verdict did not reach aiur',
    );
  });

  it('fails when the Command answer is not the pick the creator made', () => {
    const wrong = { kind: 'answer', option: 'a' };
    expect(reached({ ...delivered, received: [delivered.received[1]!, wrong] })).toBe(
      'the Command answer is not B with its note',
    );
  });
});
