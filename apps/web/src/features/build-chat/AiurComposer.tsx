import { createElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Dictation, VoiceClient } from '@ogm/voice-client';
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
      .card { display:flex; flex-wrap:wrap; align-items:center; gap:4px; }
      .attachments { flex-basis:100%; }
      .row { display:contents; }
      .spacer { display:none; }
      .attach { order:0; } textarea { order:1; flex:1; min-width:0; }
      .mic { order:2; } .voice { order:3; } .send { order:4; }
      :host(:not([data-recording]):not([data-voice-live])) .voice { display:none; }
    `
        : '';
    element.shadowRoot?.append(style);
    const input = element.shadowRoot?.querySelector('textarea');
    let dictationFailed = false;
    const edited = () => {
      dictationFailed = false;
    };
    input?.addEventListener('input', edited);
    const fileInput = element.shadowRoot?.querySelector<HTMLInputElement>('input[type="file"]');
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
    const recording = (event: Event) => {
      if (event instanceof KeyboardEvent && event.code !== 'Space' && event.code !== 'Enter') return;
      const mic = event
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.getAttribute('part') === 'mic');
      if (mic && (event.type === 'pointerdown' || event.type === 'keydown')) element.setAttribute('data-recording', '');
    };
    element.addEventListener('pointerdown', recording);
    element.addEventListener('pointerup', recording);
    element.addEventListener('pointercancel', recording);
    element.addEventListener('keydown', recording);
    element.addEventListener('keyup', recording);
    const transcriptionTarget = dictationTarget ?? voiceTarget;
    const dictation =
      transcriptionTarget && Dictation.isSupported()
        ? new Dictation({ connection: () => connectDictation(transcriptionTarget) })
        : undefined;
    element.adapters = {
      upload: async (file) => {
        if (!attachmentType(file)) throw new Error('Unsupported attachment');
        return { name: file.name, file };
      },
      ...(dictation
        ? {
            dictation: {
              start: async ({ onPartial }) => {
                dictationFailed = false;
                let resolveCancelled: () => void = () => {};
                let cleanup: () => void = () => {};
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
                    dictationFailed = true;
                    cleanup();
                    reject(codedError(value.code, value.message));
                  });
                  cleanup = () => {
                    offTranscript();
                    offError();
                  };
                });
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
                if (dictationFailed)
                  throw codedError('incomplete_transcript', 'Review the dictation before continuing');
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
                const voice = new VoiceClient({ url: available.url, token: available.token, target: voiceTarget });
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
                  element.removeAttribute('data-recording');
                  onEnd();
                });
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
                    if (voiceRef.current === voice) voiceRef.current = undefined;
                  },
                };
              },
            },
          }
        : {}),
    };
    element.onSend = async (text, attachments) => {
      if (dictationFailed) throw codedError('incomplete_transcript', 'Review the dictation before sending');
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
      element.removeEventListener('pointerdown', recording);
      element.removeEventListener('pointerup', recording);
      element.removeEventListener('pointercancel', recording);
      element.removeEventListener('keydown', recording);
      element.removeEventListener('keyup', recording);
      input?.removeEventListener('paste', paste);
      input?.removeEventListener('input', edited);
      style.remove();
    };
  }, [jobId, voiceTarget, dictationTarget, reading]);
  return (
    <>
      {createElement('aiur-composer', { ref, placeholder: 'Message' })}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

let optimisticCount = 0;

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
