import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandReached, NOTE, PICK_NOTE, reached, reviewE2e, type Report } from '../src/qa-review-e2e.js';
import { reviewOptionImageReady, reviewRoundMediaReady } from '../src/qa-review-media.js';
import { gm, tempDir } from './helpers.js';

const openDeck = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/qa-review-checks.js', () => ({
  settleMedia: async () => {},
  openReviewDeck: openDeck,
  openReviewItem: async () => {},
  mediaFailures: async () => [],
  swipeDeckFailures: async () => [],
  optionFailures: async () => [],
}));
vi.mock('../src/qa-review-touch.js', () => ({ swipeReviewMedia: async () => {} }));

// The hammer's ticket-detail steps (#873) run first in each size and have their own browser test; this suite drives the
// review deck.
const ticketSteps = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/qa-ticket-detail-e2e.js', () => ({ ticketDetailSteps: ticketSteps }));

afterEach(() => vi.unstubAllGlobals());

it('captures the shared ticket step failure and its URL at each size', async () => {
  ticketSteps.mockImplementation(async () => {
    throw new Error('locator.click: timeout\nwaiting for Details');
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({})),
  );
  const page = {
    url: () => 'https://app.example.test/all',
    screenshot: async ({ path }: { path: string }) => writeFileSync(path, 'still'),
  };
  const context = { addCookies: async () => {}, newPage: async () => page, close: async () => {} };
  const browser = { newContext: async () => context } as unknown as Parameters<typeof reviewE2e>[0];
  try {
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
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.url).toBe('https://app.example.test/all');
      expect(result.failure).toContain('waiting for Details');
      expect(result.stills).toHaveLength(1);
    }
  } finally {
    ticketSteps.mockImplementation(async () => {});
  }
});

it('captures the review page and named wait when opening the deck fails', async () => {
  openDeck.mockRejectedValueOnce(new Error('wait for review row QA review: timeout'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ gameId: 'g_qa', decisionId: 'qa_test' })),
  );
  const page = {
    url: () => 'https://app.example.test/all',
    goto: async () => {},
    close: async () => {},
    screenshot: async ({ path }: { path: string }) => writeFileSync(path, 'still'),
    getByRole: () => ({}),
  };
  const context = { addCookies: async () => {}, newPage: async () => page, close: async () => {} };
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
  expect(results[0]?.failure).toContain('wait for review row QA review: timeout');
  expect(results[0]?.stills[0]).toMatch(/review-failure\.png$/u);
  expect(results[0]?.url).toBe('https://app.example.test/all');
});

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
      vi.fn(async () => new Response('{"gameId":"g_qa","decisionId":"qa_test","options":3}', { status: 200 })),
    );
    const element = {
      click: async () => {},
      waitFor: async () => {},
      fill: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }),
      evaluate: async () => ({ x: 50, y: 50 }),
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
        url: () => 'https://app.example.test/all',
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
    const step = broken === 'option' ? 'wait for Command image' : 'load the round image, video and audio';
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.failure).toBe(`${step}: media did not load`);
    }
  },
);

async function runAnswerReceiptCase(
  delivery: 'late' | 'immediate',
  routeAnswer: { status: string; option_id: string } = { status: 'answered', option_id: 'b' },
) {
  let reportReads = 0;
  let responseWaitRegistered = false;
  let responseBodyRead = false;
  let resolveAnswer!: (response: FakeAnswerResponse) => void;
  let answerResponse: Promise<FakeAnswerResponse>;
  const responseOrdering: boolean[] = [];
  const roundPollCounts: number[] = [];
  const answerPath = '/api/v1/games/g_qa/commands/qa_test/answer';
  const fakeAnswerResponse: FakeAnswerResponse = {
    request: () => ({ method: () => 'POST' }),
    url: () => `https://app.example.test${answerPath}`,
    ok: () => true,
    status: () => 200,
    json: async () => {
      responseBodyRead = true;
      return routeAnswer;
    },
  };
  const resetAnswerResponse = () => {
    reportReads = 0;
    responseWaitRegistered = false;
    responseBodyRead = false;
    answerResponse = new Promise((resolve) => (resolveAnswer = resolve));
  };
  resetAnswerResponse();
  const waitingRound: Report['round'] = { verdict: null, notes: null, dispatch: null };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/review-fixtures') && init?.method === 'POST') {
        resetAnswerResponse();
        return Response.json({ gameId: 'g_qa', decisionId: 'qa_test', options: 3 });
      }
      if (url.pathname.includes('/review-fixtures/') && init?.method !== 'DELETE') {
        reportReads += 1;
        let report: Report;
        if (delivery === 'late' && reportReads === 1) report = { round: waitingRound, received: [] };
        else if (delivery === 'immediate' && reportReads === 1)
          report = {
            round: waitingRound,
            received: [
              {
                kind: 'answer',
                response: JSON.stringify({
                  kind: 'question_answers',
                  answers: [{ option_id: 'b', verdict: 'like' }],
                  notes: PICK_NOTE,
                }),
              },
            ],
          };
        else if (delivery === 'immediate' && reportReads === 2)
          report = {
            round: waitingRound,
            received: [
              {
                kind: 'answer',
                response: JSON.stringify({
                  kind: 'question_answers',
                  answers: [{ option_id: 'b', verdict: 'like' }],
                  notes: PICK_NOTE,
                }),
              },
            ],
          };
        else
          report = {
            round: { verdict: 'needs_work', notes: NOTE, dispatch: null },
            received: [
              {
                kind: 'answer',
                response: JSON.stringify({
                  kind: 'question_answers',
                  answers: [{ option_id: 'b', verdict: 'like' }],
                  notes: PICK_NOTE,
                }),
              },
              { kind: 'rework', reason: NOTE },
            ],
          };
        if (delivery === 'immediate') roundPollCounts.push(reportReads);
        if (reportReads === 1 && report.received.some((item) => item.kind === 'answer'))
          responseOrdering.push(responseBodyRead);
        return Response.json(report);
      }
      return Response.json({});
    }),
  );

  const makeLocator = (name = ''): FakeLocator => ({
    click: async () => {
      if (name === 'Send choice') {
        if (!responseWaitRegistered) throw new Error('answer response waiter was not registered before the click');
        resolveAnswer(fakeAnswerResponse);
      }
    },
    waitFor: async () => {},
    fill: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }),
    evaluate: async () => ({ x: 50, y: 50 }),
    first() {
      return this;
    },
    locator() {
      return this;
    },
    getByText() {
      return this;
    },
    getByRole(_role, options) {
      return makeLocator(String(options?.name ?? ''));
    },
    getByLabel() {
      return this;
    },
    filter() {
      return this;
    },
    count: async () => 0,
    innerText: async () => '',
  });

  const page = {
    url: () => 'https://app.example.test/all',
    goto: async () => {},
    close: async () => {},
    screenshot: async ({ path }: { path: string }) => writeFileSync(path, 'still'),
    getByRole: (_role: string, options?: { name?: string | RegExp }) => makeLocator(String(options?.name ?? '')),
    getByLabel: () => makeLocator(),
    locator: () => makeLocator(),
    waitForFunction: async () => {},
    waitForResponse: (matches: (response: FakeAnswerResponse) => boolean) => {
      if (!matches(fakeAnswerResponse)) throw new Error('unexpected answer request');
      responseWaitRegistered = true;
      return answerResponse;
    },
  };
  const context = {
    addCookies: async () => {},
    close: async () => {},
    newPage: async () => page,
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
    stamp: `receipt-${delivery}`,
  });
  return { results, responseOrdering, roundPollCounts };
}

type FakeAnswerResponse = {
  request: () => { method: () => string };
  url: () => string;
  ok: () => boolean;
  status: () => number;
  json: () => Promise<{ status: string; option_id: string }>;
};

type FakeLocator = {
  click: () => Promise<void>;
  waitFor: () => Promise<void>;
  fill: (_value: string) => Promise<void>;
  scrollIntoViewIfNeeded: () => Promise<void>;
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number }>;
  evaluate: () => Promise<{ x: number; y: number }>;
  first: () => FakeLocator;
  locator: () => FakeLocator;
  getByText: () => FakeLocator;
  getByRole: (_role: string, options?: { name?: string | RegExp }) => FakeLocator;
  getByLabel: () => FakeLocator;
  filter: () => FakeLocator;
  count: () => Promise<number>;
  innerText: () => Promise<string>;
};

describe('Command answer receipt timing', () => {
  it('fails before later polling can hide a delayed aiur receipt', async () => {
    const { results } = await runAnswerReceiptCase('late');
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.failure).toContain(
        'the Command answer did not reach aiur when the direct answer route acknowledged',
      );
    }
  });

  it('accepts the immediate Command receipt while the review round reconciles later', async () => {
    const { results, responseOrdering, roundPollCounts } = await runAnswerReceiptCase('immediate');
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(responseOrdering).toEqual([true, true, true, true]);
    expect(roundPollCounts).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
  });

  it('rejects a route response for a different option even when the report contains B', async () => {
    const { results } = await runAnswerReceiptCase('immediate', { status: 'answered', option_id: 'a' });
    expect(results).toHaveLength(4);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results.every((result) => result.failure === 'the Command answer route did not confirm choice B')).toBe(
      true,
    );
  });
});

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
    const env = join(host('OGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=v\n'), '.config', 'ogm', 'env');
    const { acquireSlot } = await import('@ogm/gm-verify');
    const held = await acquireSlot({ runtimeDir: join(env, 'qa-review-e2e-lock'), slots: 1 });
    const launched = vi.fn();
    vi.stubGlobal('fetch', launched);
    try {
      // Another home on the same QA env (another user or service) waits too: the lock follows the QA game.
      const { code, out, err } = await gm(['qa', 'review-e2e'], {
        home: tempDir(),
        env: { OGM_ENV_DIR: env, OGM_QA_LOCK_WAIT_MS: '50' },
      });
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
      {
        kind: 'answer',
        response: JSON.stringify({
          kind: 'question_answers',
          answers: [{ option_id: 'b', verdict: 'like' }],
          notes: PICK_NOTE,
        }),
      },
      { kind: 'rework', reason: `<!-- marker -->\n${NOTE}` },
    ],
  };

  it('passes only when the round note and the Command pick with its note both arrived', () => {
    expect(reached(delivered)).toBeNull();
  });

  it('requires the Command pick and note to have reached aiur before the answer response completes', () => {
    expect(commandReached(delivered)).toBeNull();
    expect(
      commandReached({ ...delivered, received: delivered.received.filter((item) => item.kind !== 'answer') }),
    ).toBe('the Command answer did not reach aiur');
    expect(commandReached({ ...delivered, received: [{ kind: 'answer', option: 'a', response: PICK_NOTE }] })).toBe(
      'the Command answer is not B with its note',
    );
    expect(
      commandReached({ ...delivered, received: [{ kind: 'answer', option: 'b', response: 'no creator note' }] }),
    ).toBe('the Command answer is not B with its note');
    expect(
      commandReached({
        ...delivered,
        received: [
          {
            kind: 'answer',
            response: JSON.stringify({
              kind: 'question_answers',
              answers: [{ option_id: 'b', verdict: 'dislike' }],
              notes: PICK_NOTE,
            }),
          },
        ],
      }),
    ).toBe('the Command answer is not B with its note');
  });

  it('rejects extra judgments and missing or altered notes in a valid Command receipt', () => {
    const receipt = (answers: unknown[], notes?: string) => ({
      ...delivered,
      received: [
        {
          kind: 'answer',
          response: JSON.stringify({
            kind: 'question_answers',
            answers,
            ...(notes === undefined ? {} : { notes }),
          }),
        },
      ],
    });
    expect(
      commandReached(receipt([{ option_id: 'b', verdict: 'like' }, { option_id: 'a', verdict: 'like' }], PICK_NOTE)),
    ).toBe('the Command answer is not B with its note');
    expect(commandReached(receipt([{ option_id: 'b', verdict: 'like' }]))).toBe(
      'the Command answer is not B with its note',
    );
    expect(commandReached(receipt([{ option_id: 'b', verdict: 'like' }], `unexpected ${PICK_NOTE}`))).toBe(
      'the Command answer is not B with its note',
    );
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
