// Safari rejects getUserMedia with InvalidStateError ("AudioSession category is not compatible with audio capture")
// while navigator.audioSession.type is anything but 'auto' or 'play-and-record'. The app sets 'playback' on every tap
// so its sounds play through the iPhone's silent switch, so each capture switches the session to 'play-and-record'
// while the microphone is open and restores the previous type when the last capture ends (#1325).
type SessionNavigator = Navigator & { audioSession?: { type: string } };

export const RECORDING_SESSION = 'play-and-record';

let holds = 0;
let restoreType: string | undefined;

function audioSession(): { type: string } | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as SessionNavigator).audioSession;
}

function setType(session: { type: string }, type: string): void {
  try {
    session.type = type;
  } catch {
    // Older Safari exposes a read-only draft of the Audio Session API.
  }
}

/** True while a capture holds the session for recording: playback code must not switch it back to 'playback'. */
export function isRecordingSession(): boolean {
  return audioSession()?.type === RECORDING_SESSION;
}

/** Puts the audio session into recording mode; call the returned release once the microphone is closed. */
export function holdRecordingSession(): () => void {
  const session = audioSession();
  if (!session) return () => undefined;
  if (holds === 0) restoreType = session.type;
  holds += 1;
  setType(session, RECORDING_SESSION);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0 && restoreType !== undefined && session.type === RECORDING_SESSION) setType(session, restoreType);
  };
}
