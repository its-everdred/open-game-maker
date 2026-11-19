import { createElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Dictation, VoiceClient } from '@ogm/voice-client';
import type { VoiceTarget } from '@ogm/contracts';
import { defineComposer, type AiurComposer as ComposerElement } from '@aiur/conversation';
import { attachmentType, uploadChatAttachment } from './attachments';
import type { Composer } from './Composer';
import { connectDictation, probeVoice, type VoiceAvailability } from './voice';

type Props = Pick<ComponentProps<typeof Composer>, 'jobId' | 'voiceTarget' | 'postText' | 'startJob' | 'onPosted'> & {
  reading?: 'inline' | 'stacked';
  dictationTarget?: VoiceTarget;
  wasAdmissionReused?: () => boolean;
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
  reading = 'inline',
}: Props) {
  const ref = useRef<ComposerElement>(null);
  const voiceRef = useRef<VoiceClient | undefined>(undefined);
  const voiceStarting = useRef(false);
  const dictationResult = useRef<Promise<string> | undefined>(undefined);
  const cancelDictation = useRef<(() => void) | undefined>(undefined);
  const voiceAvailability = useRef<VoiceAvailability>({ available: false });
  const pendingAdmission = useRef<{ text: string; jobId: string } | undefined>(undefined);
  const admissionInFlight = useRef(false);
  const lastAdmittedJob = useRef<string | undefined>(undefined);
  const lastVoiceSession = useRef<string | undefined>(undefined);
  const callbacks = useRef({ postText, startJob, onPosted, wasAdmissionReused });
  callbacks.current = { postText, startJob, onPosted, wasAdmissionReused };
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
    voiceAvailability.current = { available: false };
    const refresh = () => {
      if (voiceTarget)
        void probeVoice(voiceTarget)
          .then((value) => {
            if (active) voiceAvailability.current = value;
          })
          .catch(() => {});
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
      :host(:not([data-recording])) .voice { display:none; }
    `
        : '';
    element.shadowRoot?.append(style);
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
              start: async () => {
                let resolveCancelled: () => void = () => {};
                const result = new Promise<string>((resolve, reject) => {
                  resolveCancelled = () => resolve('');
                  const offTranscript = dictation.on('transcript', (value) => {
                    if (value.kind !== 'final') return;
                    offTranscript();
                    offError();
                    resolve(value.text);
                  });
                  const offError = dictation.on('error', (value) => {
                    offTranscript();
                    offError();
                    reject(new Error(value.message));
                  });
                });
                // The microphone or token can fail before the user releases the button.
                void result.catch(() => {});
                dictationResult.current = result;
                cancelDictation.current = () => {
                  dictation.cancel();
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
              start: async ({ onEnd }) => {
                if (voiceStarting.current || voiceRef.current) throw new Error('Voice is already starting');
                if (
                  admissionInFlight.current ||
                  (lastAdmittedJob.current &&
                    voiceTarget.kind === 'edit' &&
                    voiceTarget.job_id !== lastAdmittedJob.current)
                )
                  throw new Error('The conversation is starting');
                const available = voiceAvailability.current;
                if (!available.available) throw new Error('Voice is unavailable');
                const voice = new VoiceClient({ url: available.url, token: available.token, target: voiceTarget });
                voiceStarting.current = true;
                voiceRef.current = voice;
                voice.on('ended', () => {
                  if (voiceRef.current === voice) voiceRef.current = undefined;
                  element.removeAttribute('data-recording');
                  onEnd();
                });
                const offState = voice.on('state', (frame) => {
                  const capabilities = (frame as unknown as { capabilities?: { text?: boolean } }).capabilities;
                  if (!capabilities?.text) return;
                  offState();
                  void Promise.resolve(dictationResult.current)
                    .catch(() => undefined)
                    .then(async () => {
                      // Let the upstream composer insert the final transcript before reading it.
                      await Promise.resolve();
                      const openingText = element.value.trim();
                      if (!openingText || voiceRef.current !== voice) return;
                      voice.sendText(openingText);
                      if (element.value.trim() === openingText) element.value = '';
                    });
                });
                try {
                  await voice.startFromGesture();
                } catch (error) {
                  voice.end();
                  if (voiceRef.current === voice) voiceRef.current = undefined;
                  throw error;
                } finally {
                  voiceStarting.current = false;
                }
                return {
                  stop: async () => {
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
      const { startJob, postText, onPosted, wasAdmissionReused } = callbacks.current;
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
      if (!target) throw new Error('Message not sent');
      if (startJob) pendingAdmission.current = { text: instruction, jobId: target };
      const uploaded = await Promise.all(
        attachments.map(async (attachment) => {
          const file = attachment.file;
          if (!(file instanceof File)) throw new Error('Invalid attachment');
          const type = attachmentType(file);
          if (!type) throw new Error('Unsupported attachment');
          return uploadChatAttachment(target, file, type);
        }),
      );
      const separateText = !startJob || wasAdmissionReused?.() === true;
      if ((separateText && text.trim()) || uploaded.length) {
        const posted = await postText(
          target,
          separateText ? text.trim() : '',
          uploaded.length ? uploaded.map(({ id }) => id) : undefined,
        );
        if (posted && typeof posted === 'object' && 'id' in posted)
          onPosted?.(posted as Parameters<NonNullable<Props['onPosted']>>[0]);
      }
      pendingAdmission.current = undefined;
      setError('');
    };
    const onError = () => setError('Message or voice could not be started.');
    element.addEventListener('aiur-composer-error', onError);
    return () => {
      element.removeEventListener('aiur-composer-error', onError);
      element.removeEventListener('pointerdown', recording);
      element.removeEventListener('pointerup', recording);
      element.removeEventListener('pointercancel', recording);
      element.removeEventListener('keydown', recording);
      element.removeEventListener('keyup', recording);
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
