import { useEffect, useMemo, useRef, useState } from 'react';

import {
  captionsReducer,
  Dictation,
  VoiceClient,
  type Captions,
  type DictationError,
  type DictationConnection,
  type DictationTranscript,
  type VoiceClientOptions,
} from '@ogm/voice-client';
import type { VoiceTarget } from '@ogm/contracts';

import { Icon } from '../../components/Icon';
import { ApiError } from '../../lib/api/client';
import {
  addPastedText,
  addAttachments,
  ATTACH_ACCEPT,
  isLargeTextPaste,
  uploadAll,
  uploadChatAttachment,
  type PendingAttachment,
  type UploadAttachment,
} from './attachments';
import type { StreamedChatMessage } from './stream';
import {
  connectDictation as defaultConnectDictation,
  probeVoice as defaultProbeVoice,
  type VoiceAvailability,
} from './voice';

export type DictationPort = {
  pressStart(): void;
  pressEnd(): void;
  cancel?(): void;
  on(event: 'transcript', listener: (value: DictationTranscript) => void): () => void;
  on(event: 'error', listener: (value: DictationError) => void): () => void;
};

// `attachmentIds` is passed only when the message carries files.
type PostText = (jobId: string, text: string, attachmentIds?: string[]) => Promise<unknown>;
// Starts a job from the text and resolves its id, or undefined when admission was refused.
type StartJob = (text: string) => Promise<string | undefined>;

export function Composer({
  jobId,
  voiceTarget,
  dictation: providedDictation,
  postText,
  startJob,
  uploadAttachment = uploadChatAttachment,
  probeVoice = defaultProbeVoice,
  connectDictation = defaultConnectDictation,
  createVoiceClient = (options) => new VoiceClient(options),
  onOptimistic,
  onPosted,
  onFailed,
}: {
  jobId: string;
  voiceTarget?: VoiceTarget;
  dictation?: DictationPort;
  postText: PostText;
  startJob?: StartJob;
  uploadAttachment?: UploadAttachment;
  probeVoice?: (target: VoiceTarget) => Promise<VoiceAvailability>;
  connectDictation?: (target: VoiceTarget) => Promise<DictationConnection>;
  createVoiceClient?: (options: VoiceClientOptions) => VoiceClient;
  onOptimistic?: (message: StreamedChatMessage) => void;
  onPosted?: (message: StreamedChatMessage) => void;
  onFailed?: (messageId: string) => void;
}) {
  const targetKey = voiceTarget ? voiceTargetKey(voiceTarget) : undefined;
  const dictation = useMemo<DictationPort | undefined>(
    () =>
      providedDictation ??
      (voiceTarget && Dictation.isSupported()
        ? new Dictation({ connection: () => connectDictation(voiceTarget) })
        : undefined),
    [connectDictation, providedDictation, voiceTarget],
  );
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [partial, setPartial] = useState('');
  const [notice, setNotice] = useState('');
  const [voiceForTarget, setVoiceForTarget] = useState<{ key: string; value: VoiceAvailability }>();
  const voice =
    voiceForTarget && targetKey === voiceForTarget.key ? voiceForTarget.value : { available: false as const };
  const [voiceClient, setVoiceClient] = useState<VoiceClient>();
  const voiceClientRef = useRef<VoiceClient | undefined>(undefined);
  const [captions, setCaptions] = useState<Captions>({ you: [], builder: [] });
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const voiceStartingRef = useRef(false);
  const [voiceStarting, setVoiceStarting] = useState(false);

  useEffect(() => {
    if (!dictation) return;
    const offTranscript = dictation.on('transcript', (transcript) => {
      if (transcript.kind === 'partial') {
        setPartial(transcript.text);
        return;
      }
      setPartial('');
      setText(transcript.text);
    });
    const offError = dictation.on('error', (error) => setNotice(error.message));
    return () => {
      if (dictation.cancel) dictation.cancel();
      else dictation.pressEnd();
      offTranscript();
      offError();
    };
  }, [dictation]);

  useEffect(() => {
    if (!voiceTarget || !targetKey) return;
    let current = true;
    void probeVoice(voiceTarget)
      .then((result) => {
        if (current) setVoiceForTarget({ key: targetKey, value: result });
      })
      .catch(() => {
        if (current) setVoiceForTarget({ key: targetKey, value: { available: false } });
      });
    return () => {
      current = false;
    };
  }, [probeVoice, targetKey, voiceTarget]);

  useEffect(
    () => () => {
      voiceClientRef.current?.end();
      voiceClientRef.current = undefined;
    },
    [targetKey],
  );

  const submit = async () => {
    const value = text.trim();
    const files = attachments;
    const instruction = value || (files.some(({ preview }) => preview !== undefined) ? 'Pasted text attached.' : '');
    if ((startJob ? !instruction : !value && files.length === 0) || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setText('');
    setAttachments([]);
    try {
      if (!startJob) return await post(jobId, value, files);
      // With no job yet, the text starts one; files can only be uploaded to a job, so they follow into the new job.
      const optimistic = optimisticMessage(jobId, instruction, []);
      onOptimistic?.(optimistic);
      let started: string | undefined;
      try {
        started = await startJob(instruction);
      } catch {
        onFailed?.(optimistic.id);
        setText(value);
        setAttachments(files);
        setNotice('Message not sent. Try again.');
        return;
      }
      if (started === undefined) setAttachments(files);
      else if (files.length > 0) await post(started, '', files);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const post = async (target: string, value: string, files: PendingAttachment[]) => {
    const optimistic = optimisticMessage(target, value, files);
    onOptimistic?.(optimistic);
    try {
      const posted = await (files.length === 0
        ? postText(target, value)
        : postText(
            target,
            value,
            (await uploadAll(target, files, uploadAttachment)).map(({ id }) => id),
          ));
      if (posted && typeof posted === 'object' && 'id' in posted) onPosted?.(posted as StreamedChatMessage);
    } catch (error) {
      // 422 means the uploads were refused or already used (a post whose reply was lost); upload them again next time.
      if (error instanceof ApiError && error.status === 422) for (const item of files) delete item.uploaded;
      onFailed?.(optimistic.id);
      setText(value);
      setAttachments(files);
      setNotice('Message not sent. Try again.');
    }
  };

  const startVoice = async () => {
    if (!voice.available || !voiceTarget || voiceStartingRef.current) return;
    voiceStartingRef.current = true;
    setVoiceStarting(true);
    setNotice('Voice chat uses ElevenLabs conversational-AI credits.');
    setCaptions({ you: [], builder: [] });
    const client = createVoiceClient({ url: voice.url, token: voice.token, target: voiceTarget });
    voiceClientRef.current = client;
    let ended = false;
    for (const type of ['transcript', 'agent_text', 'interrupted'] as const) {
      client.on(type, (frame) => setCaptions((current) => captionsReducer(current, frame)));
    }
    client.on('error', (frame) => setNotice(frame.message));
    client.on('ended', () => {
      ended = true;
      if (voiceClientRef.current !== client) return;
      voiceClientRef.current = undefined;
      setVoiceClient(undefined);
    });
    try {
      await client.startFromGesture();
      if (!ended && voiceClientRef.current === client) setVoiceClient(client);
    } catch {
      client.end();
      if (voiceClientRef.current === client) voiceClientRef.current = undefined;
    } finally {
      voiceStartingRef.current = false;
      setVoiceStarting(false);
    }
  };

  if (voiceClient) {
    return (
      <section className="build-chat-voice" aria-label="Voice chat">
        <VoiceSide label="You" lines={captions.you.map(({ text: line }) => line)} />
        <VoiceSide label="Builder" lines={captions.builder.map(({ text: line }) => line)} />
        <button
          className="build-chat-type tap-secondary"
          type="button"
          onClick={() => {
            voiceClient.end();
            if (voiceClientRef.current === voiceClient) voiceClientRef.current = undefined;
            setVoiceClient(undefined);
          }}
        >
          Type instead
        </button>
      </section>
    );
  }

  const startDictation = () => {
    setNotice('Dictation uses ElevenLabs transcription credits.');
    dictation?.pressStart();
  };
  const endDictation = () => dictation?.pressEnd();
  const cancelDictation = () => {
    if (dictation?.cancel) dictation.cancel();
    else dictation?.pressEnd();
  };

  return (
    <div className="build-chat-composer">
      {partial ? <p className="build-chat-partial">{partial}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <label className="sr" htmlFor={`build-chat-text-${jobId}`}>
        Message the builder
      </label>
      {attachments.length > 0 ? (
        <ul className="build-chat-attachments">
          {attachments.map((attachment) => (
            <PendingAttachmentChip
              key={attachment.key}
              attachment={attachment}
              onRemove={() => setAttachments((current) => current.filter((item) => item.key !== attachment.key))}
            />
          ))}
        </ul>
      ) : null}
      <textarea
        id={`build-chat-text-${jobId}`}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const pastedText = event.clipboardData.getData?.('text/plain') ?? '';
          const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
          let next = attachments;
          if (isLargeTextPaste(pastedText)) next = addPastedText(next, pastedText);
          const attachedPaste = next.length > attachments.length;
          next = addAttachments(next, images);
          if (next.length > attachments.length) setAttachments(next);
          if (attachedPaste || (images.length > 0 && !event.clipboardData.types.includes('text/plain'))) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="build-chat-composer-actions">
        <button
          className="build-chat-attach tap-secondary"
          type="button"
          aria-label="Attach files"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="paperclip" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          hidden
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = '';
            setAttachments((current) => addAttachments(current, picked));
          }}
        />
        {dictation ? (
          <button
            className="build-chat-dictate tap-secondary"
            type="button"
            aria-label="Hold to talk"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              startDictation();
            }}
            onPointerUp={endDictation}
            onPointerCancel={cancelDictation}
            onKeyDown={(event) => {
              if (event.code === 'Space' && !event.repeat) startDictation();
            }}
            onKeyUp={(event) => {
              if (event.code === 'Space') endDictation();
            }}
          >
            <Icon name="mic" />
          </button>
        ) : null}
        {voice.available ? (
          <button
            className="build-chat-voice-button tap-secondary"
            type="button"
            disabled={voiceStarting}
            onClick={() => void startVoice()}
          >
            Start voice chat
          </button>
        ) : null}
        <button
          className="build-chat-send tap-primary"
          type="button"
          disabled={
            submitting ||
            (startJob
              ? !text.trim() && !attachments.some(({ preview }) => preview !== undefined)
              : !text.trim() && attachments.length === 0)
          }
          onClick={() => void submit()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function voiceTargetKey(target: VoiceTarget): string {
  if (target.kind === 'questions') return `questions:${target.game_id}:${target.creator_id}`;
  return target.kind === 'scope'
    ? `scope:${target.game_id}:${target.session_id}:${target.creator_id}`
    : `build:${target.game_id}:${target.job_id}:${target.ticket}:${target.creator_id}`;
}

function PendingAttachmentChip({
  attachment: { file, preview, title },
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove(): void;
}) {
  const label = title ?? file.name;
  return (
    <li className={preview === undefined ? undefined : 'build-chat-paste'}>
      {preview === undefined ? (
        <span>{label}</span>
      ) : (
        <details>
          <summary>
            <span>{label}</span>
            <small>{formatAttachmentSize(file.size)}</small>
          </summary>
          <pre>{preview}</pre>
        </details>
      )}
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
        <Icon name="close" />
      </button>
    </li>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const kilobytes = bytes / 1_024;
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
}

function VoiceSide({ label, lines }: { label: string; lines: string[] }) {
  return (
    <section className="build-chat-voice-side" aria-label={label}>
      <header>{label}</header>
      <div className={label === 'You' ? 'build-chat-seismograph' : 'build-chat-orb'} aria-hidden="true" />
      <div className="build-chat-captions" aria-live="polite">
        {lines.map((line, index) => (
          <p key={`${index}-${line}`}>{line}</p>
        ))}
      </div>
    </section>
  );
}

function optimisticMessage(jobId: string, value: string, files: PendingAttachment[]): StreamedChatMessage {
  return {
    id: `optimistic-${Date.now()}-${(optimisticCount += 1)}`,
    job_id: jobId,
    at: new Date().toISOString(),
    actor: 'creator',
    kind: 'text',
    ...(value ? { text: value } : {}),
    ...(files.length === 0
      ? {}
      : {
          attachments: files.map(({ key, file, type }) => ({
            id: key,
            kind: type.startsWith('image/') ? ('image' as const) : ('text' as const),
            name: file.name,
            mime: type.startsWith('image/') ? ('image/webp' as const) : (type as 'text/plain'),
            bytes: file.size,
          })),
        }),
    optimistic: true,
  };
}

let optimisticCount = 0;
