import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRunningTicket, openTicketBuilds } from './qa-review-checks.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;

// The prod voice check (#879): as the QA creator, open a seeded build's chat on a phone, hold the mic while a recorded
// clip plays into a fake microphone and see the words land in the message box, then hold a short voice session and
// see the agent's audio stream back and the turn stored in the chat. Everything after the seed is the deployed path:
// the app, the API's tokens, the voice host and ElevenLabs.

/** Spoken by Piper's public-domain LJSpeech voice, 16 kHz mono; together 3.2 s, under the ticket's 10 s cap. */
export const CLIPS = { dictate: 'say.wav', talk: 'hello.wav' } as const;
export const CLIP_SECONDS = { dictate: 1.61, talk: 1.62 } as const;
/** The clip's distinctive words must both reach the box in order. */
export const DICTATED = /\bsk(?:y|ies)\b.*\bblue\b/iu;
const MEDIA_DIR = new URL('../qa/voice-e2e/', import.meta.url);
const VIEWPORT = { width: 390, height: 844 };
const TITLE = 'QA voice';
/** The vendored aiur composer's button names (apps/web/vendor/aiur-conversation); a renamed button blinds this check. */
export const LABELS = {
  dictate: 'Dictate',
  startVoice: 'Switch to voice conversation',
  endVoice: 'End voice conversation',
} as const;

/** Voice is offered from the active dictation row in the shared composer. */
export async function startVoiceFromDictation(dialog: ReturnType<Page['getByRole']>): Promise<void> {
  await dialog.getByRole('button', { name: LABELS.dictate }).click({ timeout: 20_000 });
  await dialog.getByRole('button', { name: LABELS.startVoice }).click({ timeout: 20_000 });
}

export async function endVoiceConversation(dialog: ReturnType<Page['getByRole']>): Promise<void> {
  await dialog.getByRole('button', { name: LABELS.endVoice }).click({ timeout: 20_000 });
}

/** Release a failed one-way attempt so it cannot hide the next attempt's microphone. */
export async function cancelFailedDictation(page: Page, dialog: ReturnType<Page['getByRole']>): Promise<void> {
  const cancel = dialog.getByRole('button', { name: 'Cancel dictation' });
  if (await cancel.isVisible().catch(() => false)) await cancel.dispatchEvent('click').catch(() => undefined);
  await page.mouse.up().catch(() => undefined);
}

export type VoiceE2eConfig = {
  origin: string;
  api: string;
  internalToken: string;
  cookie: { name: string; value: string };
  out: string;
  stamp: string;
  /** Reads the ElevenLabs account's used characters; absent when no key is configured. */
  usage?: () => Promise<number | null>;
  /** How long to wait for each voice step; prod runs keep the default. */
  timeoutMs?: number;
};

/** What crossed the voice socket, by the voice-client wire's frame types. */
export type VoiceTally = {
  states: string[];
  finalTranscripts: string[];
  agentText: string[];
  agentAudioFrames: number;
  agentAudioBytes: number;
  errors: string[];
};

export type VoiceStep = { name: 'dictation' | 'two-way'; ok: boolean; failure?: string; detail?: string; url?: string };

export type VoiceCost = {
  characters: number | null;
  audioSentSeconds: number;
  callSeconds: number;
};

export type VoiceE2eResult = { steps: VoiceStep[]; cost: VoiceCost; stills: string[] };

export function tallyFrames(frames: readonly string[]): VoiceTally {
  const tally: VoiceTally = {
    states: [],
    finalTranscripts: [],
    agentText: [],
    agentAudioFrames: 0,
    agentAudioBytes: 0,
    errors: [],
  };
  for (const raw of frames) {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const text = typeof frame.text === 'string' ? frame.text : '';
    switch (frame.type) {
      case 'state':
        if (typeof frame.state === 'string') tally.states.push(frame.state);
        break;
      case 'transcript':
        if (frame.kind === 'final' && text) tally.finalTranscripts.push(text);
        break;
      case 'agent_text':
        if (frame.final === true && text) tally.agentText.push(text);
        break;
      case 'agent_audio':
        if (typeof frame.data_b64 === 'string' && frame.data_b64.length > 0) {
          tally.agentAudioFrames += 1;
          tally.agentAudioBytes += Math.floor((frame.data_b64.length * 3) / 4);
        }
        break;
      case 'error':
        tally.errors.push(typeof frame.code === 'string' ? frame.code : JSON.stringify(frame).slice(0, 120));
        break;
    }
  }
  return tally;
}

/** One-way: the clip's words reached the message box. */
export function dictationFailure(box: string): string | null {
  if (!box.trim()) return 'the message box stayed empty after the clip';
  if (!DICTATED.test(box)) return `the message box shows "${box.slice(0, 80)}", not the clip's words`;
  return null;
}

/** Two-way: the agent's audio streamed back and played, and the creator's spoken turn is stored in the chat. */
export function twoWayFailure(
  tally: VoiceTally,
  playedSeconds: number,
  stored: readonly { actor: string; text: string | null }[],
): string | null {
  const failures: string[] = [];
  if (tally.errors.length) failures.push(`the voice socket sent errors: ${tally.errors.join(', ')}`);
  if (tally.agentAudioFrames === 0) failures.push('no agent audio streamed back');
  else if (playedSeconds <= 0) failures.push('the agent audio arrived but the app played none of it');
  // Only the creator's turn proves the clip was heard: an agent greeting alone would be stored without it.
  if (!stored.some((message) => message.actor === 'creator' && message.text?.trim()))
    failures.push("no transcript of the creator's turn was stored in the chat");
  return failures.length ? failures.join('; ') : null;
}

/** The characters an ElevenLabs account has used this period, from its subscription; null when unreadable. */
export function elevenLabsUsage(apiKey: string, fetcher: typeof fetch = fetch): () => Promise<number | null> {
  return async () => {
    try {
      const response = await fetcher('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { character_count?: unknown };
      return typeof body.character_count === 'number' ? body.character_count : null;
    } catch {
      return null;
    }
  };
}

export function costLine(cost: VoiceCost): string {
  const characters = cost.characters === null ? 'unknown' : String(cost.characters);
  return `cost elevenlabs characters=${characters} minutes=${(cost.callSeconds / 60).toFixed(2)} audio_sent_s=${cost.audioSentSeconds.toFixed(1)} call_s=${cost.callSeconds.toFixed(1)}`;
}

/**
 * Replaces the page's microphone with one that is silent until `__ogmFakeMic.play(name)`, then plays that clip once.
 * The app's own capture code reads it through `getUserMedia`, exactly as it reads a phone's microphone. It also counts
 * the seconds of audio the page itself plays (`playedSeconds`), so a reply passes only once it reached the speaker path.
 * It keeps Safari's audio-session rule, which Chromium lacks: the microphone is refused while
 * `navigator.audioSession.type` is neither 'auto' nor 'play-and-record' (#1325: 'playback' broke voice on iPhones).
 */
export function installFakeMic(clips: Record<string, string>): void {
  type Mic = {
    context?: AudioContext;
    destination?: MediaStreamAudioDestinationNode;
    played: string[];
    requested: number;
    playedSeconds: number;
  };
  const mic: Mic = { played: [], requested: 0, playedSeconds: 0 };
  const ours = new WeakSet<AudioBufferSourceNode>();
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<typeof start>) {
    // The client's audio unlock starts a one-sample silent buffer; only real audio (10 ms or more) counts.
    if (!ours.has(this) && this.buffer && this.buffer.duration >= 0.01) mic.playedSeconds += this.buffer.duration;
    return start.apply(this, args);
  };
  const ensure = () => {
    if (!mic.context) {
      mic.context = new AudioContext();
      mic.destination = mic.context.createMediaStreamDestination();
    }
    return { context: mic.context, destination: mic.destination! };
  };
  Object.defineProperty(window, '__ogmFakeMic', {
    value: {
      played: mic.played,
      get requested() {
        return mic.requested;
      },
      get playedSeconds() {
        return mic.playedSeconds;
      },
      async play(name: string) {
        const { context, destination } = ensure();
        await context.resume();
        const bytes = Uint8Array.from(atob(clips[name]!), (char) => char.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        const source = context.createBufferSource();
        ours.add(source);
        source.buffer = buffer;
        source.connect(destination);
        source.start();
        mic.played.push(name);
      },
    },
  });
  // Safari also loses the microphone when the session leaves recording while a capture is open: end the open tracks.
  const recordable = (type: string) => type === 'auto' || type === 'play-and-record';
  const open = new Set<MediaStreamTrack>();
  let sessionType = 'auto';
  const emulated = {
    get type() {
      return sessionType;
    },
    set type(value: string) {
      sessionType = value;
      if (recordable(value)) return;
      for (const track of open) track.stop();
      open.clear();
    },
  };
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (!nav.audioSession) Object.defineProperty(nav, 'audioSession', { value: emulated });
  const session = nav.audioSession!;
  // On the prototype: WebKit can run this before the page's navigator.mediaDevices exists (a routed document).
  if (typeof MediaDevices === 'undefined') return;
  MediaDevices.prototype.getUserMedia = async () => {
    mic.requested += 1;
    if (!recordable(session.type)) {
      throw new DOMException('AudioSession category is not compatible with audio capture.', 'InvalidStateError');
    }
    const { context, destination } = ensure();
    await context.resume();
    // Each caller gets its own tracks: the app stops them when a capture ends, which must not mute the next capture.
    const tracks = destination.stream.getAudioTracks().map((track) => track.clone());
    for (const track of tracks) open.add(track);
    return new MediaStream(tracks);
  };
}

type FakeMic = { requested: number; playedSeconds: number; played: string[]; play(name: string): Promise<void> };
// Page functions are serialized on their own, so each reaches the fake microphone through `window` itself.
type MicWindow = { __ogmFakeMic: FakeMic };

class StepFailed extends Error {}

async function internal(config: VoiceE2eConfig, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.api}/internal/qa${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-ogm-internal': config.internalToken, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new StepFailed(`${init.method ?? 'GET'} ${path} answered ${response.status}`);
  return body;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Wait for the composer to finish committing, and reject its reported errors. */
export async function waitForDictationCommit(
  isSettled: () => Promise<boolean>,
  error: () => Promise<string | null>,
  timeoutMs: number,
): Promise<void> {
  if (!(await until(isSettled, timeoutMs))) throw new StepFailed('dictation did not finish committing');
  const message = await error();
  if (message) throw new StepFailed(`dictation failed: ${message}`);
}

export async function openChat(page: Page, origin: string, title = TITLE): Promise<void> {
  const timeout = { timeout: 20_000 };
  await page.goto(`${origin}/all`, { waitUntil: 'load', timeout: 60_000 });
  await openTicketBuilds(page);
  await openRunningTicket(page, title);
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Conversation' }).click(timeout);
  await page
    .getByRole('dialog', { name: title })
    .and(page.locator('.job-conversation-dialog:not(.ticket-detail-dialog)'))
    .waitFor(timeout);
}

export async function voiceE2e(browser: Browser, config: VoiceE2eConfig): Promise<VoiceE2eResult> {
  mkdirSync(config.out, { recursive: true });
  const wait = config.timeoutMs ?? 30_000;
  const run = config.stamp;
  const stills: string[] = [];
  const steps: VoiceStep[] = [];
  const frames: string[] = [];
  const cost: VoiceCost = { characters: null, audioSentSeconds: 0, callSeconds: 0 };
  let callStarted: number | undefined;
  const clips = Object.fromEntries(
    Object.entries(CLIPS).map(([name, file]) => [name, readFileSync(new URL(file, MEDIA_DIR)).toString('base64')]),
  );
  const before = (await config.usage?.()) ?? null;
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: true });
  try {
    // The host resolves its Funnel name to a local Tailnet address. Headless Chromium cannot accept the local-network
    // permission prompt, so grant it for this QA app origin as a user would when connecting to that address.
    await context.grantPermissions(['local-network-access'], { origin: config.origin });
    // A dead run's build would list beside this one; the seed replaces it.
    await internal(config, '/voice-fixtures', { method: 'POST', body: JSON.stringify({ run }) });
    await context.addCookies([{ ...config.cookie, url: config.origin }]);
    await context.addInitScript(installFakeMic, clips);
    const page = await context.newPage();
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/ws/voice')) return;
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string') frames.push(payload);
      });
    });
    const still = async (label: string) => {
      const file = join(config.out, `voice-${stills.length + 1}-${label}.png`);
      await page.screenshot({ path: file });
      stills.push(file);
    };
    const failed = async (name: VoiceStep['name'], error: unknown) => {
      const url = page.url();
      let failure = error instanceof Error ? error.message : String(error);
      try {
        await still(`${name}-failure`);
      } catch (captureError) {
        failure += `\nScreenshot failed: ${String(captureError)}`;
      }
      steps.push({ name, ok: false, failure, url });
    };
    const dialog = page
      .getByRole('dialog', { name: TITLE })
      .and(page.locator('.job-conversation-dialog:not(.ticket-detail-dialog)'));
    let reopenForVoice = false;

    try {
      await openChat(page, config.origin);
      const mic = dialog.getByRole('button', { name: LABELS.dictate });
      await mic.waitFor({ timeout: 20_000 });
      await dialog.locator('aiur-composer').evaluate((composer) => {
        composer.addEventListener('aiur-composer-error', () => composer.setAttribute('data-qa-dictation-error', ''));
      });
      const box = (await mic.boundingBox())!;
      const textbox = dialog.locator('textarea').first();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // The clip starts once the app has opened the microphone, so none of it is spoken into nothing.
      await page.waitForFunction(() => (window as unknown as MicWindow).__ogmFakeMic.requested > 0, null, {
        timeout: wait,
      });
      await page.waitForTimeout(300);
      await page.evaluate(() => (window as unknown as MicWindow).__ogmFakeMic.play('dictate'));
      cost.audioSentSeconds += CLIP_SECONDS.dictate;
      await page.waitForTimeout(CLIP_SECONDS.dictate * 1000 + 800);
      await page.mouse.up();
      // Partials appear while recording; only inspect the draft after the final commit settles.
      const alert = dialog.getByRole('alert');
      await waitForDictationCommit(
        async () => textbox.evaluate((input) => !(input as HTMLTextAreaElement).readOnly),
        async () =>
          (await dialog.locator('aiur-composer').getAttribute('data-qa-dictation-error')) !== null
            ? 'the composer reported an error'
            : (await alert.isVisible())
              ? await alert.innerText()
              : null,
        wait,
      );
      await until(async () => dictationFailure(await textbox.inputValue()) === null, wait);
      const text = await textbox.inputValue();
      const failure = dictationFailure(text);
      if (failure) {
        reopenForVoice = true;
        await failed('dictation', new StepFailed(failure));
      } else {
        await still('dictation');
        // The words stay a draft: the run never sends them.
        await textbox.fill('');
        steps.push({ name: 'dictation', ok: true, detail: text });
      }
    } catch (error) {
      await cancelFailedDictation(page, dialog);
      reopenForVoice = true;
      await failed('dictation', error);
    }

    try {
      if (reopenForVoice || !(await dialog.isVisible())) await openChat(page, config.origin);
      frames.length = 0;
      callStarted = Date.now();
      await startVoiceFromDictation(dialog);
      const listening = await until(() => tallyFrames(frames).states.includes('listening'), wait);
      if (!listening)
        throw new StepFailed(
          `the session never reached listening (states: ${tallyFrames(frames).states.join(', ') || 'none'})`,
        );
      await page.evaluate(() => (window as unknown as MicWindow).__ogmFakeMic.play('talk'));
      cost.audioSentSeconds += CLIP_SECONDS.talk;
      const played = () => page.evaluate(() => (window as unknown as MicWindow).__ogmFakeMic.playedSeconds);
      await until(async () => tallyFrames(frames).agentAudioFrames > 0 && (await played()) > 0, wait);
      // Let the first reply finish arriving, so its caption and stored turn have landed.
      await until(() => tallyFrames(frames).agentText.length > 0, 5_000);
      const playedSeconds = await played();
      await still('voice');
      // Hang up as soon as the reply is in: the call is billed by the minute.
      await endVoiceConversation(dialog);
      cost.callSeconds = (Date.now() - callStarted) / 1000;
      callStarted = undefined;
      let stored: { actor: string; text: string | null }[] = [];
      await until(async () => {
        const report = await internal(config, `/voice-fixtures/${run}`);
        stored = (report.messages as typeof stored) ?? [];
        return stored.some((message) => message.actor === 'creator' && message.text?.trim());
      }, 15_000);
      const tally = tallyFrames(frames);
      const failure = twoWayFailure(tally, playedSeconds, stored);
      if (failure) await failed('two-way', new StepFailed(failure));
      else
        steps.push({
          name: 'two-way',
          ok: true,
          detail: `agent audio ${tally.agentAudioFrames} frames, ${playedSeconds.toFixed(1)} s played; stored ${stored.length} turns`,
        });
    } catch (error) {
      await failed('two-way', error);
    }
  } finally {
    // A step that failed mid-call still spent the minutes up to the hang-up that closing the page does.
    if (callStarted !== undefined) cost.callSeconds = (Date.now() - callStarted) / 1000;
    await context.close().catch(() => undefined);
    await internal(config, `/voice-fixtures/${run}`, { method: 'DELETE' }).catch(() => undefined);
  }
  const after = (await config.usage?.()) ?? null;
  cost.characters = before === null || after === null ? null : after - before;
  writeFileSync(
    join(config.out, 'voice-e2e.json'),
    `${JSON.stringify({ steps, cost, frames: tallyFrames(frames), stills }, null, 2)}\n`,
  );
  return { steps, cost, stills };
}
