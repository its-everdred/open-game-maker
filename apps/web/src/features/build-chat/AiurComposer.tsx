import { createElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { captionsReducer, Dictation, VoiceClient, type Captions } from '@ogm/voice-client';
import type { VoiceTarget } from '@ogm/contracts';
import { MAX_CHAT_ATTACHMENTS } from '@ogm/contracts/browser';
import { defineComposer, type AiurComposer as ComposerElement, type ComposerErrorDetail } from '@aiur/conversation';
import { attachmentType, isLargeTextPaste, uploadChatAttachment, type UploadAttachment } from './attachments';
import type { Composer } from './Composer';
import { codedError, describeComposerError, reportComposerError } from './composer-errors';
import { connectDictation, probeVoice, voiceProbeFailure, type VoiceAvailability } from './voice';
import type { StreamedChatMessage } from './stream';

type Props = Pick<ComponentProps<typeof Composer>, 'jobId' | 'voiceTarget' | 'postText' | 'startJob' | 'onPosted'> & {
  reading?: 'inline' | 'stacked';
  dictationTarget?: VoiceTarget;
  wasAdmissionReused?: () => boolean;
  onOptimistic?: (message: StreamedChatMessage) => void;
  onFailed?: (messageId: string) => void;
  uploadAttachment?: UploadAttachment;
};

/** Host adapters for the pinned upstream composer; no provider credentials enter the component. */
export function AiurComposer({
  jobId,
  voiceTarget,
  dictationTarget,
  wasAdmissionReused,
  postText,
  startJob,
  onPosted,
  onOptimistic,
  onFailed,
  uploadAttachment = uploadChatAttachment,
  reading = 'inline',
}: Props) {
  const ref = useRef<ComposerElement>(null);
  const voiceRef = useRef<VoiceClient | undefined>(undefined);
  const microphoneMuted = useRef(false);
  const voiceStarting = useRef(false);
  const cancelDictation = useRef<(() => void) | undefined>(undefined);
  const voiceAvailability = useRef<VoiceAvailability>({ available: false });
  const pendingAdmission = useRef<{ text: string; jobId: string } | undefined>(undefined);
  const admissionInFlight = useRef(false);
  const lastAdmittedJob = useRef<string | undefined>(undefined);
  const lastVoiceSession = useRef<string | undefined>(undefined);
  const callbacks = useRef({
    postText,
    startJob,
    onPosted,
    onOptimistic,
    onFailed,
    uploadAttachment,
    wasAdmissionReused,
  });
  callbacks.current = { postText, startJob, onPosted, onOptimistic, onFailed, uploadAttachment, wasAdmissionReused };
  const [error, setError] = useState('');
  const [voiceLive, setVoiceLive] = useState(false);
  const [voiceCaptions, setVoiceCaptions] = useState<Captions>({ you: [], builder: [] });
  useEffect(
    () => () => {
      voiceRef.current?.end();
      cancelDictation.current?.();
    },
    [],
  );
  useEffect(() => {
    let active = true;
    if (voiceTarget?.kind === 'edit' && lastVoiceSession.current !== voiceTarget.session_id) {
      lastVoiceSession.current = voiceTarget.session_id;
      lastAdmittedJob.current = undefined;
    }
    voiceAvailability.current = { available: false, code: 'starting' };
    const refresh = () => {
      if (voiceTarget)
        void probeVoice(voiceTarget)
          .then((value) => {
            if (active) voiceAvailability.current = value;
          })
          .catch((error: unknown) => {
            /* A failed refresh keeps a token that still works. */
            if (active && !voiceAvailability.current.available) voiceAvailability.current = voiceProbeFailure(error);
          });
    };
    refresh();
    const timer = window.setInterval(refresh, 240_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [voiceTarget]);
  useEffect(() => {
    defineComposer();
    const element = ref.current;
    if (!element) return;
    const style = document.createElement('style');
    style.textContent =
      reading === 'inline'
        ? `
      .card { display:grid; gap:0; }
      .attachments { flex-basis:100%; }
      .row { display:flex; flex-wrap:nowrap; align-items:center; gap:8px; }
      .spacer { display:none; }
      .attach, .cancel { order:0; }
      textarea { order:1; flex:1 1 0; flex-basis:0; min-width:0; padding-inline:4px; }
      :host([data-recording]) textarea { flex:1 1 0; flex-basis:0; padding-inline:4px; }
      .stop { display:none !important; }
      .wave { order:2; }
      :host([data-voice-live]) .wave { display:flex !important; }
      @keyframes live-wave { from { transform:scaleY(.16); } 50% { transform:scaleY(.82); } to { transform:scaleY(.34); } }
      @media (prefers-reduced-motion:no-preference) {
        :host([data-recording]:not([data-mic-muted])) .wave i, :host([data-voice-live]:not([data-mic-muted])) .wave i { animation:live-wave 720ms ease-in-out infinite; }
        .wave i:nth-child(3n+1) { animation-delay:-230ms; }
        .wave i:nth-child(3n+2) { animation-delay:-470ms; }
      }
      @media (prefers-reduced-motion:reduce) {
        :host([data-recording]:not([data-mic-muted])) .wave i, :host([data-voice-live]:not([data-mic-muted])) .wave i { transform:scaleY(.45); }
      }
      .voice { order:3; opacity:0; transform:translateX(6px); transition:opacity 160ms ease, transform 160ms ease; }
      :host([data-recording]) .voice, :host([data-voice-live]) .voice { opacity:1; transform:translateX(0); }
      .mic { order:4; position:relative; }
      :host([data-recording]) .mic, :host([data-voice-live]) .mic { display:inline-grid !important; }
      .mic[data-muted='true']::after { content:''; position:absolute; width:2px; height:25px; border-radius:2px; background:currentColor; transform:rotate(-45deg); }
      .send { order:5; }
      :host(:not([data-recording]):not([data-voice-live])) .voice { display:none; }
    `
        : '';
    element.shadowRoot?.append(style);
    element.classList.add('build-chat-aiur-composer');
    const composerProperties: Record<string, string> = {
      '--aiur-composer-bg': 'rgba(24, 22, 32, .88)',
      '--aiur-composer-fg': '#f2ead6',
      '--aiur-composer-muted': 'rgba(242, 234, 214, .6)',
      '--aiur-composer-line': 'rgba(242, 234, 214, .22)',
      '--aiur-composer-button-bg': 'rgba(55, 51, 64, .78)',
      '--aiur-composer-accent': '#94d742',
      '--aiur-composer-on-accent': '#1d1b16',
      '--aiur-composer-focus': '#6fd6b4',
      '--aiur-composer-radius': '28px',
      '--aiur-composer-font': 'Nunito, system-ui, sans-serif',
      '--aiur-composer-shadow': '0 18px 44px rgba(0, 0, 0, .32)',
      '--aiur-composer-button-size': '40px',
    };
    for (const [property, value] of Object.entries(composerProperties)) element.style.setProperty(property, value);
    const cardStyle = document.createElement('style');
    cardStyle.textContent = `
      aiur-composer.build-chat-aiur-composer::part(card) { gap:0; padding:5px; border-color:rgba(242,234,214,.2); background:rgba(24,22,32,.88); -webkit-backdrop-filter:blur(22px) saturate(1.4); backdrop-filter:blur(22px) saturate(1.4); }
      aiur-composer.build-chat-aiur-composer::part(actions) { flex-wrap:nowrap; gap:8px; align-items:center; }
      aiur-composer.build-chat-aiur-composer::part(attach), aiur-composer.build-chat-aiur-composer::part(mic), aiur-composer.build-chat-aiur-composer::part(voice), aiur-composer.build-chat-aiur-composer::part(send), aiur-composer.build-chat-aiur-composer::part(cancel) { color:#f2ead6; border:1px solid rgba(255,255,255,.38); background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.04) 50%,transparent 51%),rgba(55,51,64,.72); box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 22px rgba(0,0,0,.3); }
      aiur-composer.build-chat-aiur-composer::part(input) { color:#f2ead6; }
      aiur-composer.build-chat-aiur-composer::part(input)::placeholder { color:rgba(242,234,214,.6); }
      aiur-composer.build-chat-aiur-composer::part(send) { color:#1d1b16; border-color:rgba(255,255,255,.55); background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.04) 50%,transparent 51%),#94d742; }
      aiur-composer.build-chat-aiur-composer::part(cancel) { color:#ff9b8f; }
      aiur-composer.build-chat-aiur-composer[data-recording]::part(mic), aiur-composer.build-chat-aiur-composer[data-voice-live]::part(mic) { color:#1d1b16; background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.04) 50%,transparent 51%),#6fd6b4; }
      aiur-composer.build-chat-aiur-composer[data-mic-muted]::part(mic) { color:#1d1b16; background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.04) 50%,transparent 51%),#d795e4; }
    `;
    element.after(cardStyle);
    const input = element.shadowRoot?.querySelector('textarea');
    const fileInput = element.shadowRoot?.querySelector<HTMLInputElement>('input[type="file"]');
    const microphone = element.shadowRoot?.querySelector<HTMLButtonElement>('[part="mic"]');
    const twoWay = element.shadowRoot?.querySelector<HTMLButtonElement>('[part="voice"]');
    const transcriptionTarget = dictationTarget ?? voiceTarget;
    const dictation =
      transcriptionTarget && Dictation.isSupported()
        ? new Dictation({ connection: () => connectDictation(transcriptionTarget) })
        : undefined;
    if (twoWay)
      twoWay.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h8.5a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7l-4 3v-4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" fill="#7d6b8c" stroke="#7d6b8c"/><path d="M10 3.5h9A1.5 1.5 0 0 1 20.5 5v5.5A1.5 1.5 0 0 1 19 12h-1v4l-4-4h-3A1.5 1.5 0 0 1 9.5 10.5V5A1.5 1.5 0 0 1 11 3.5Z" fill="none" stroke="#f2ead6" stroke-width="2"/></svg>`;
    const isVoiceActive = () => element.hasAttribute('data-recording') || element.hasAttribute('data-voice-live');
    const syncMicrophone = () => {
      if (!microphone) return;
      const shouldHide = !isVoiceActive() && !dictation;
      if (microphone.hidden !== shouldHide) microphone.hidden = shouldHide;
      if (isVoiceActive()) {
        microphone.setAttribute('aria-pressed', String(microphoneMuted.current));
        microphone.setAttribute('aria-label', microphoneMuted.current ? 'Unmute microphone' : 'Mute microphone');
        microphone.dataset.muted = String(microphoneMuted.current);
        element.toggleAttribute('data-mic-muted', microphoneMuted.current);
        microphone.style.background = microphoneMuted.current ? '#d795e4' : '#6fd6b4';
        microphone.style.color = '#1d1b16';
      } else {
        microphone.removeAttribute('aria-pressed');
        microphone.setAttribute('aria-label', 'Dictate');
        delete microphone.dataset.muted;
        element.removeAttribute('data-mic-muted');
        microphone.style.background = '';
        microphone.style.color = '';
        microphoneMuted.current = false;
      }
    };
    const toggleMicrophone = () => {
      if (!isVoiceActive()) return;
      microphoneMuted.current = !microphoneMuted.current;
      if (element.hasAttribute('data-voice-live')) voiceRef.current?.setMuted(microphoneMuted.current);
      else dictation?.setMuted(microphoneMuted.current);
      if (microphoneMuted.current) drawComposerWave(element, 0);
      syncMicrophone();
    };
    const microphonePointer = (event: Event) => {
      if (!microphone || !isVoiceActive() || !event.composedPath().includes(microphone)) return;
      const pointer = event as PointerEvent;
      if (pointer.button > 0) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      toggleMicrophone();
    };
    const microphoneKeyboard = (event: Event) => {
      if (!microphone || !isVoiceActive() || !event.composedPath().includes(microphone)) return;
      if ((event as MouseEvent).detail !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      toggleMicrophone();
    };
    const stateObserver = new MutationObserver(syncMicrophone);
    stateObserver.observe(element, { attributes: true, attributeFilter: ['data-recording', 'data-voice-live'] });
    if (microphone) stateObserver.observe(microphone, { attributes: true, attributeFilter: ['hidden'] });
    syncMicrophone();
    element.addEventListener('pointerdown', microphonePointer, true);
    element.addEventListener('click', microphoneKeyboard, true);
    const paste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard || !fileInput) return;
      const pastedFiles = Array.from(clipboard.items)
        .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
        .filter((file): file is File => file !== null);
      const text = clipboard.getData('text/plain');
      const files =
        pastedFiles.length > 0
          ? pastedFiles
          : text && isLargeTextPaste(text)
            ? [new File([text], 'pasted-text.txt', { type: 'text/plain' })]
            : [];
      const room = MAX_CHAT_ATTACHMENTS - element.attachments.length;
      const accepted = files.filter((file) => attachmentType(file)).slice(0, room);
      if (accepted.length === 0) return;
      event.preventDefault();
      const transfer = new DataTransfer();
      accepted.forEach((file) => transfer.items.add(file));
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    };
    input?.addEventListener('paste', paste);
    element.adapters = {
      upload: async (file) => {
        if (!attachmentType(file)) throw new Error('Unsupported attachment');
        return { name: file.name, file };
      },
      ...(dictation
        ? {
            dictation: {
              start: async ({ onPartial, onLevel }) => {
                let resolveCancelled: () => void = () => {};
                let cleanup: () => void = () => {};
                let offLevel = () => {};
                const result = new Promise<string>((resolve, reject) => {
                  resolveCancelled = () => {
                    cleanup();
                    resolve('');
                  };
                  const offTranscript = dictation.on('transcript', (value) => {
                    if (value.kind !== 'final') {
                      onPartial(value.text);
                      return;
                    }
                    cleanup();
                    resolve(value.text);
                  });
                  const offError = dictation.on('error', (value) => {
                    cleanup();
                    reject(codedError(value.code, value.message));
                  });
                  cleanup = () => {
                    offTranscript();
                    offError();
                    offLevel();
                  };
                });
                offLevel = dictation.on('level', onLevel);
                // The microphone or token can fail before the user releases the button.
                void result.catch(() => {});
                cancelDictation.current = () => {
                  dictation.cancel();
                  cleanup();
                  resolveCancelled();
                };
                dictation.pressStart();
                return {
                  stop: () => {
                    dictation.pressEnd();
                    return result;
                  },
                  cancel: () => cancelDictation.current?.(),
                };
              },
            },
          }
        : {}),
      ...(voiceTarget
        ? {
            voice: {
              start: async ({ onEnd, initialText }) => {
                if (!element.isConnected) throw codedError('cancelled', 'The conversation was closed');
                if (voiceStarting.current || voiceRef.current)
                  throw codedError('starting', 'Voice is already starting');
                if (
                  admissionInFlight.current ||
                  (lastAdmittedJob.current &&
                    voiceTarget.kind === 'edit' &&
                    voiceTarget.job_id !== lastAdmittedJob.current)
                )
                  throw codedError('starting', 'The conversation is starting');
                const available = voiceAvailability.current;
                if (!available.available)
                  throw codedError(available.code ?? 'voice_unavailable', 'Voice is unavailable');
                const voice = new VoiceClient({
                  url: available.url,
                  token: available.token,
                  target: voiceTarget,
                  onLevel: (level) => drawComposerWave(element, level),
                });
                microphoneMuted.current = false;
                setVoiceCaptions({ you: [], builder: [] });
                let openingPending = initialText;
                const restoreOpening = () => {
                  if (openingPending && element.isConnected) {
                    element.value = [openingPending, element.value.trim()].filter(Boolean).join(' ');
                    openingPending = '';
                  }
                };
                voiceStarting.current = true;
                voiceRef.current = voice;
                voice.on('ended', () => {
                  restoreOpening();
                  if (voiceRef.current === voice) voiceRef.current = undefined;
                  setVoiceLive(false);
                  element.removeAttribute('data-recording');
                  onEnd();
                });
                voice.on('transcript', (frame) => setVoiceCaptions((current) => captionsReducer(current, frame)));
                voice.on('agent_text', (frame) => setVoiceCaptions((current) => captionsReducer(current, frame)));
                voice.on('interrupted', (frame) => setVoiceCaptions((current) => captionsReducer(current, frame)));
                const offState = voice.on('state', (frame) => {
                  const capabilities = (frame as unknown as { capabilities?: { text?: boolean } }).capabilities;
                  if (!capabilities?.text) return;
                  offState();
                  if (openingPending && voiceRef.current === voice) {
                    voice.sendText(openingPending);
                    openingPending = '';
                  }
                });
                try {
                  if (input) input.readOnly = true;
                  await voice.startFromGesture();
                  if (voiceRef.current === voice) setVoiceLive(true);
                } catch (error) {
                  voice.end();
                  if (voiceRef.current === voice) voiceRef.current = undefined;
                  throw error;
                } finally {
                  voiceStarting.current = false;
                  if (input) input.readOnly = false;
                }
                return {
                  stop: async () => {
                    restoreOpening();
                    voice.end();
                    setVoiceLive(false);
                    if (voiceRef.current === voice) voiceRef.current = undefined;
                  },
                };
              },
            },
          }
        : {}),
    };
    element.onSend = async (text, attachments) => {
      if (!element.isConnected) throw codedError('cancelled', 'The conversation was closed');
      const { startJob, postText, onPosted, onOptimistic, onFailed, uploadAttachment, wasAdmissionReused } =
        callbacks.current;
      const instruction = text.trim();
      let target: string | undefined = jobId;
      if (startJob) {
        if (pendingAdmission.current?.text === instruction) {
          target = pendingAdmission.current.jobId;
        } else {
          admissionInFlight.current = true;
          try {
            target = await startJob(instruction);
            if (target) lastAdmittedJob.current = target;
          } finally {
            admissionInFlight.current = false;
          }
        }
      }
      if (!target) throw codedError('not_sent', 'Message not sent');
      if (startJob) pendingAdmission.current = { text: instruction, jobId: target };
      const uploaded = await Promise.all(
        attachments.map(async (attachment) => {
          const file = attachment.file;
          if (!(file instanceof File)) throw new Error('Invalid attachment');
          const type = attachmentType(file);
          if (!type) throw new Error('Unsupported attachment');
          return uploadAttachment(target, file, type);
        }),
      );
      const separateText = !startJob || wasAdmissionReused?.() === true;
      if ((separateText && text.trim()) || uploaded.length) {
        const optimistic = optimisticMessage(
          target,
          separateText ? text.trim() : '',
          attachments.map(({ file }) => file as File),
        );
        onOptimistic?.(optimistic);
        try {
          const posted = await postText(
            target,
            separateText ? text.trim() : '',
            uploaded.length ? uploaded.map(({ id }) => id) : undefined,
          );
          if (posted && typeof posted === 'object' && 'id' in posted)
            onPosted?.(posted as Parameters<NonNullable<Props['onPosted']>>[0]);
        } catch (error) {
          onFailed?.(optimistic.id);
          throw error;
        }
      }
      pendingAdmission.current = undefined;
      setError('');
    };
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<ComposerErrorDetail>).detail;
      const failure = describeComposerError(detail);
      setError(failure.text);
      reportComposerError(
        detail.action,
        failure,
        (detail.action === 'dictation' ? transcriptionTarget : voiceTarget)?.kind,
      );
    };
    element.addEventListener('aiur-composer-error', onError);
    return () => {
      element.removeEventListener('aiur-composer-error', onError);
      element.removeEventListener('pointerdown', microphonePointer, true);
      element.removeEventListener('click', microphoneKeyboard, true);
      stateObserver.disconnect();
      cardStyle.remove();
      element.classList.remove('build-chat-aiur-composer');
      input?.removeEventListener('paste', paste);
      style.remove();
    };
  }, [jobId, voiceTarget, dictationTarget, reading]);
  return (
    <>
      <div className="build-chat-composer-stack">
        {voiceLive && (
          <section className="build-chat-voice" aria-label="Live voice conversation">
            <div className="build-chat-voice-side">
              <header>You</header>
              <div className="build-chat-captions" role="log" aria-live="polite">
                {voiceCaptions.you.map((line) => (
                  <p key={line.id}>{line.text}</p>
                ))}
              </div>
            </div>
            <div className="build-chat-voice-side">
              <header>Agent</header>
              <div className="build-chat-captions" role="log" aria-live="polite">
                {voiceCaptions.builder.map((line) => (
                  <p key={line.id}>{line.text}</p>
                ))}
              </div>
            </div>
          </section>
        )}
        {createElement('aiur-composer', { ref, placeholder: 'Message' })}
        {error && <p role="alert">{error}</p>}
      </div>
    </>
  );
}

let optimisticCount = 0;

function drawComposerWave(element: ComposerElement, level: number): void {
  const bars = element.shadowRoot?.querySelectorAll<HTMLElement>('[part="waveform"] i');
  if (!bars) return;
  const phase = performance.now() / 160;
  bars.forEach((bar, index) => {
    const envelope = 0.25 + (Math.sin(index * 0.9 + phase) + 1) * 0.3;
    const height = Math.max(0.1, Math.min(1, level * envelope * 1.8));
    bar.style.transform = `scaleY(${height.toFixed(2)})`;
  });
}

function optimisticMessage(jobId: string, text: string, files: File[]): StreamedChatMessage {
  const count = (optimisticCount += 1);
  return {
    id: `optimistic-${Date.now()}-${count}`,
    job_id: jobId,
    at: new Date().toISOString(),
    actor: 'creator',
    kind: 'text',
    ...(text ? { text } : {}),
    ...(files.length === 0
      ? {}
      : {
          attachments: files.map((file, index) => {
            const type = attachmentType(file)!;
            return {
              id: `optimistic-${count}-${index}`,
              kind: type.startsWith('image/') ? ('image' as const) : ('text' as const),
              name: file.name,
              mime: type.startsWith('image/') ? ('image/webp' as const) : (type as 'text/plain'),
              bytes: file.size,
            };
          }),
        }),
    optimistic: true,
  };
}
