import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  costLine,
  cancelFailedDictation,
  dictationFailure,
  endVoiceConversation,
  elevenLabsUsage,
  LABELS,
  startVoiceFromDictation,
  tallyFrames,
  twoWayFailure,
  voiceE2e,
  waitForDictationCommit,
} from '../src/qa-voice-e2e.js';
import { gm, tempDir } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

const frame = (value: Record<string, unknown>) => JSON.stringify(value);

it('waits for the final commit and rejects an error even when partial text looks complete', async () => {
  let checks = 0;
  await expect(
    waitForDictationCommit(
      async () => ++checks > 1,
      async () => 'final transcript missing',
      1_000,
    ),
  ).rejects.toThrow('dictation failed: final transcript missing');
  expect(checks).toBe(2);
  await expect(
    waitForDictationCommit(
      async () => false,
      async () => null,
      0,
    ),
  ).rejects.toThrow('dictation did not finish committing');
});

// The prod check clicks the app's composer by its button names. When the build chat moved to the aiur composer the old
// names ('Hold to talk', 'Start voice chat') matched nothing, and the post-deploy voice check failed on every deploy
// without ever reaching the voice host (2026-11-21).
it('looks for the button names the vendored composer renders', () => {
  const composer = ['composer.mjs', 'composer-view.mjs']
    .map((file) =>
      readFileSync(new URL(`../../../apps/web/vendor/aiur-conversation/src/${file}`, import.meta.url), 'utf8'),
    )
    .join('\n');
  for (const label of Object.values(LABELS)) expect(composer).toMatch(new RegExp(`['"]${label}['"]`));
});

it('opens dictation before switching to two-way voice', async () => {
  const clicks: string[] = [];
  const dialog = {
    getByRole: (_role: string, { name }: { name: string }) => ({
      click: async () => {
        clicks.push(name);
      },
    }),
  };
  await startVoiceFromDictation(dialog as unknown as Parameters<typeof startVoiceFromDictation>[0]);
  expect(clicks).toEqual(['Dictate', 'Switch to voice conversation']);
});

it('cancels a failed dictation before releasing the mouse', async () => {
  const actions: string[] = [];
  const page = {
    mouse: {
      up: async () => {
        actions.push('release');
      },
    },
  };
  const dialog = {
    getByRole: () => ({
      isVisible: async () => true,
      dispatchEvent: async () => {
        actions.push('cancel');
      },
    }),
  };
  await cancelFailedDictation(
    page as unknown as Parameters<typeof cancelFailedDictation>[0],
    dialog as unknown as Parameters<typeof cancelFailedDictation>[1],
  );
  expect(actions).toEqual(['cancel', 'release']);
});

it('fails the two-way check when the end voice control is unavailable', async () => {
  const dialog = {
    getByRole: () => ({
      click: async () => {
        throw new Error('missing end control');
      },
    }),
  };
  await expect(endVoiceConversation(dialog as unknown as Parameters<typeof endVoiceConversation>[0])).rejects.toThrow(
    'missing end control',
  );
});

it.each([false, true])('records each voice failure even when screenshot capture fails: %s', async (captureFails) => {
  const out = tempDir();
  const locator = {
    and: () => locator,
    getByRole: () => locator,
    isVisible: async () => true,
    dispatchEvent: async () => {},
  };
  const page = {
    mouse: { up: async () => {} },
    on: () => {},
    getByRole: () => locator,
    locator: () => locator,
    goto: vi.fn(async () => {
      throw new Error('locator.click: timeout\nwaiting for QA voice');
    }),
    url: () => 'https://app.example.test/all',
    screenshot: async ({ path }: { path: string }) => {
      if (captureFails) throw new Error('capture unavailable');
      writeFileSync(path, 'still');
    },
  };
  const context = {
    grantPermissions: vi.fn(async () => {}),
    addCookies: async () => {},
    addInitScript: async () => {},
    newPage: async () => page,
    close: async () => {},
  };
  const browser = { newContext: async () => context } as unknown as Parameters<typeof voiceE2e>[0];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({})),
  );
  const result = await voiceE2e(browser, {
    origin: 'https://app.example.test',
    api: 'https://api.example.test',
    internalToken: 'test',
    cookie: { name: 'session', value: 'test' },
    out,
    stamp: 'run-1',
  });
  expect(page.goto).toHaveBeenCalledTimes(2);
  expect(context.grantPermissions).toHaveBeenCalledWith(['local-network-access'], {
    origin: 'https://app.example.test',
  });
  expect(result.stills).toHaveLength(captureFails ? 0 : 2);
  for (const step of result.steps) {
    expect(step).toMatchObject({ ok: false, url: 'https://app.example.test/all' });
    expect(step.failure).toContain('waiting for QA voice');
    if (captureFails) expect(step.failure).toContain('Screenshot failed: Error: capture unavailable');
  }
  expect(JSON.parse(readFileSync(join(out, 'voice-e2e.json'), 'utf8')).stills).toEqual(result.stills);
});

describe('voice socket tally (#879)', () => {
  // The two-way check passes only on audio the agent actually streamed back, so the tally must count agent_audio
  // frames and nothing else as reply audio; a state or caption frame alone is not a reply Kevin would hear.
  it('counts the agent audio, final captions and states that crossed the socket', () => {
    const tally = tallyFrames([
      frame({ type: 'state', state: 'connecting' }),
      frame({ type: 'state', state: 'listening' }),
      frame({ type: 'transcript', kind: 'partial', text: 'Hel' }),
      frame({ type: 'transcript', kind: 'final', text: 'Hello, can you hear me?' }),
      frame({ type: 'agent_text', turn_id: 't1', text: 'Yes', final: false }),
      frame({ type: 'agent_text', turn_id: 't1', text: 'Yes, I can.', final: true }),
      frame({ type: 'agent_audio', turn_id: 't1', format: 'pcm_16000', data_b64: 'AAAA' }),
      frame({ type: 'agent_audio', turn_id: 't1', format: 'pcm_16000', data_b64: 'AAAAAAAA' }),
      frame({ type: 'agent_audio', turn_id: 't1', format: 'pcm_16000', data_b64: '' }),
      'not json',
    ]);
    expect(tally).toEqual({
      states: ['connecting', 'listening'],
      finalTranscripts: ['Hello, can you hear me?'],
      agentText: ['Yes, I can.'],
      agentAudioFrames: 2,
      agentAudioBytes: 9,
      errors: [],
    });
  });

  it('keeps the error codes the host sent', () => {
    expect(tallyFrames([frame({ type: 'error', code: 'provider_unavailable' })]).errors).toEqual([
      'provider_unavailable',
    ]);
  });
});

describe('verdicts', () => {
  // One-way passes only when the clip's own words land: an empty box, or text from somewhere else, is a failure.
  it('passes dictation only on the clip’s words', () => {
    expect(dictationFailure('Make the sky blue.')).toBeNull();
    expect(dictationFailure('make the skies Blue')).toBeNull();
    expect(dictationFailure('Make the sky')).toMatch(/not the clip's words/);
    expect(dictationFailure('the sky blue')).toMatch(/not the clip's words/);
    expect(dictationFailure('Make sky blue')).toMatch(/not the clip's words/);
    expect(dictationFailure('blue make the sky')).toMatch(/not the clip's words/);
    expect(dictationFailure('blue')).toMatch(/not the clip's words/);
    expect(dictationFailure('  ')).toBe('the message box stayed empty after the clip');
    expect(dictationFailure('Hello there')).toMatch(/not the clip's words/);
  });

  const heard = tallyFrames([frame({ type: 'agent_audio', turn_id: 't', format: 'pcm', data_b64: 'AAAA' })]);

  it('passes two-way only when audio came back, played, and the creator turn is stored in the chat', () => {
    expect(twoWayFailure(heard, 1.2, [{ actor: 'creator', text: 'Hello, can you hear me?' }])).toBeNull();
    expect(twoWayFailure(tallyFrames([]), 0, [{ actor: 'creator', text: 'Hello' }])).toBe(
      'no agent audio streamed back',
    );
    expect(twoWayFailure(heard, 1.2, [])).toBe("no transcript of the creator's turn was stored in the chat");
    expect(twoWayFailure(heard, 1.2, [{ actor: 'creator', text: ' ' }])).toBe(
      "no transcript of the creator's turn was stored in the chat",
    );
    // An agent greeting is stored even when the clip was never heard, so it alone must not pass.
    expect(twoWayFailure(heard, 1.2, [{ actor: 'agent', text: 'Hi there' }])).toBe(
      "no transcript of the creator's turn was stored in the chat",
    );
  });

  // Frames the app cannot decode never reach the speaker; Kevin would hear nothing, so the check must fail.
  it('fails two-way when audio frames arrived but the app played none of them', () => {
    expect(twoWayFailure(heard, 0, [{ actor: 'creator', text: 'Hello' }])).toBe(
      'the agent audio arrived but the app played none of it',
    );
  });

  it('fails two-way when the host reported an error, even with audio', () => {
    const tally = tallyFrames([
      frame({ type: 'agent_audio', turn_id: 't', format: 'pcm', data_b64: 'AAAA' }),
      frame({ type: 'error', code: 'transcript_store_failed' }),
    ]);
    expect(twoWayFailure(tally, 1, [{ actor: 'creator', text: 'Hello' }])).toBe(
      'the voice socket sent errors: transcript_store_failed',
    );
  });
});

describe('cost report', () => {
  it('reads the account’s used characters with the key in the header, never the URL', async () => {
    const fetcher = vi.fn(async () => Response.json({ character_count: 1234, character_limit: 100000 }));
    expect(await elevenLabsUsage('sk-test', fetcher as unknown as typeof fetch)()).toBe(1234);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/user/subscription');
    expect(url).not.toContain('sk-test');
    expect(init.headers).toEqual({ 'xi-api-key': 'sk-test' });
  });

  it('reports unknown rather than a wrong number when the usage cannot be read', async () => {
    const refused = vi.fn(async () => new Response('', { status: 401 }));
    expect(await elevenLabsUsage('sk-test', refused as unknown as typeof fetch)()).toBeNull();
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await elevenLabsUsage('sk-test', down as unknown as typeof fetch)()).toBeNull();
    expect(costLine({ characters: null, audioSentSeconds: 3.23, callSeconds: 9 })).toBe(
      'cost elevenlabs characters=unknown minutes=0.15 audio_sent_s=3.2 call_s=9.0',
    );
    expect(costLine({ characters: 41, audioSentSeconds: 3.2, callSeconds: 12 })).toContain('characters=41');
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

describe('gm qa voice-e2e', () => {
  // The deploy hook reads the last line, so a host that cannot run the check still ends with a failing exit line.
  it('fails with its exit line when the host has no QA session', async () => {
    const { code, out, err } = await gm(['qa', 'voice-e2e'], { home: host('') });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe('exit=1 qa-voice-e2e');
    expect(err.join('\n')).toContain('ops/bin/ogm-qa-session');
  });

  it('fails with its exit line when the QA session has expired', async () => {
    const qa =
      'OGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=v\nOGM_QA_SESSION_EXPIRES=2020-01-01T00:00:00.000Z\n';
    const { code, out, err } = await gm(['qa', 'voice-e2e'], { home: host(qa) });
    expect(code).toBe(1);
    expect(out.at(-1)).toBe('exit=1 qa-voice-e2e');
    expect(err.join('\n')).toContain('expired');
  });

  // Each run replaces the QA game's voice build; a second run alongside the first would delete its build mid-call.
  it('does not start while another run holds the QA game', async () => {
    const env = join(host('OGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=v\n'), '.config', 'ogm', 'env');
    const { acquireSlot } = await import('@ogm/gm-verify');
    const held = await acquireSlot({ runtimeDir: join(env, 'qa-voice-e2e-lock'), slots: 1 });
    const launched = vi.fn();
    vi.stubGlobal('fetch', launched);
    try {
      const { code, out, err } = await gm(['qa', 'voice-e2e'], {
        home: tempDir(),
        env: { OGM_ENV_DIR: env, OGM_QA_LOCK_WAIT_MS: '50' },
      });
      expect(code).toBe(1);
      expect(out.at(-1)).toBe('exit=1 qa-voice-e2e');
      expect(err.join('\n')).toContain('another voice E2E still held the QA game');
      expect(launched).not.toHaveBeenCalled();
    } finally {
      held.release();
    }
  });
});
