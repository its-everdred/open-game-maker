import { useEffect, useMemo, useState } from 'react';

import type { VoiceTarget } from '@ogm/contracts';
import { Dictation, type DictationTranscript } from '@ogm/voice-client';

import { Icon } from '../../components/Icon';
import { connectDictation } from '../build-chat/voice';

// The voice half of the review's whole-set notes. The app's voice support is its dictation (the same press-and-hold the
// build chat's composer offers), so a review's set-level note can be spoken instead of typed and lands in the same
// field. It only appears where the app supports it: the Command's job supplies a voice target and the browser has a
// microphone. A refused token or a missing microphone leaves the text field as the way in and says so.
export type DictationPort = {
  pressStart(): void;
  pressEnd(): void;
  cancel?(): void;
  on(event: 'transcript', listener: (value: DictationTranscript) => void): () => void;
  on(event: 'error', listener: (value: { code: string; message: string }) => void): () => void;
};

// The real port, built from the Command's voice target. A browser without a microphone gets no button, not a dead one.
export function dictationFor(target: VoiceTarget): DictationPort | undefined {
  if (!Dictation.isSupported()) return undefined;
  return new Dictation({ connection: () => connectDictation(target) });
}

export function VoiceNote({
  target,
  dictation: provided,
  onText,
}: {
  target?: VoiceTarget;
  dictation?: DictationPort;
  onText(text: string): void;
}) {
  const dictation = useMemo(
    () => provided ?? (target === undefined ? undefined : dictationFor(target)),
    [provided, target],
  );
  const [partial, setPartial] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (dictation === undefined) return;
    const offTranscript = dictation.on('transcript', (transcript) => {
      if (transcript.kind === 'partial') {
        setPartial(transcript.text);
        return;
      }
      setPartial('');
      onText(transcript.text);
    });
    const offError = dictation.on('error', (error) => setNotice(error.message));
    return () => {
      if (dictation.cancel) dictation.cancel();
      else dictation.pressEnd();
      offTranscript();
      offError();
    };
  }, [dictation, onText]);

  if (dictation === undefined) return null;

  const start = () => {
    setNotice('Dictation uses ElevenLabs transcription credits.');
    dictation.pressStart();
  };
  const end = () => dictation.pressEnd();
  const cancel = () => {
    if (dictation.cancel) dictation.cancel();
    else dictation.pressEnd();
  };

  return (
    <div className="review-deck-voice">
      {partial === '' ? null : (
        <p aria-live="polite" className="review-deck-voice-partial">
          {partial}
        </p>
      )}
      {notice === '' ? null : <p role="status">{notice}</p>}
      <button
        aria-label="Hold to talk your notes for the whole set"
        className="review-deck-voice-button tap-secondary"
        onKeyDown={(event) => {
          if (event.code === 'Space' && !event.repeat) start();
        }}
        onKeyUp={(event) => {
          if (event.code === 'Space') end();
        }}
        onPointerCancel={cancel}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          start();
        }}
        onPointerUp={end}
        type="button"
      >
        <Icon name="mic" />
        <span>Speak the notes</span>
      </button>
    </div>
  );
}
