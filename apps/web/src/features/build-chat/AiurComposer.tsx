import { createElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Dictation, VoiceClient } from '@ogm/voice-client';
import type { VoiceTarget } from '@ogm/contracts';
import { defineComposer, type AiurComposer as ComposerElement } from '@aiur/conversation';
import { attachmentType, uploadChatAttachment } from './attachments';
import type { Composer } from './Composer';
import { connectDictation, probeVoice } from './voice';

type Props = Pick<ComponentProps<typeof Composer>, 'jobId' | 'voiceTarget' | 'postText' | 'startJob' | 'onPosted'> & {
  reading?: 'inline' | 'stacked';
  dictationTarget?: VoiceTarget;
};

/** Host adapters for the pinned upstream composer; no provider credentials enter the component. */
export function AiurComposer({
  jobId,
  voiceTarget,
  dictationTarget,
  postText,
  startJob,
  onPosted,
  reading = 'inline',
}: Props) {
  const ref = useRef<ComposerElement>(null);
  const voiceRef = useRef<VoiceClient | undefined>(undefined);
  const pendingAdmission = useRef<{ text: string; jobId: string } | undefined>(undefined);
  const callbacks = useRef({ postText, startJob, onPosted });
  callbacks.current = { postText, startJob, onPosted };
  const [error, setError] = useState('');
  useEffect(() => () => voiceRef.current?.end(), []);
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
      if (mic) element.toggleAttribute('data-recording', event.type === 'pointerdown' || event.type === 'keydown');
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
                dictation.pressStart();
                return {
                  stop: () =>
                    new Promise<string>((resolve, reject) => {
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
                      dictation.pressEnd();
                    }),
                  cancel: () => dictation.cancel(),
                };
              },
            },
          }
        : {}),
      ...(voiceTarget
        ? {
            voice: {
              start: async ({ onEnd }) => {
                const available = await probeVoice(voiceTarget);
                if (!available.available) throw new Error('Voice is unavailable');
                const voice = new VoiceClient({ url: available.url, token: available.token, target: voiceTarget });
                voiceRef.current = voice;
                voice.on('ended', onEnd);
                await voice.startFromGesture();
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
      const { startJob, postText, onPosted } = callbacks.current;
      const instruction = text.trim();
      const target = startJob
        ? pendingAdmission.current?.text === instruction
          ? pendingAdmission.current.jobId
          : await startJob(instruction)
        : jobId;
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
      if (!startJob || uploaded.length) {
        const posted = await postText(
          target,
          startJob ? '' : text.trim(),
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
      dictation?.cancel();
    };
  }, [jobId, voiceTarget, dictationTarget, reading]);
  return (
    <>
      {createElement('aiur-composer', { ref, placeholder: 'Message' })}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
