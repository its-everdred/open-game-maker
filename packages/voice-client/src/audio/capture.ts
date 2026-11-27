import { holdRecordingSession } from './session.js';

const TARGET_RATE = 16_000;

export interface CaptureHandle {
  context: AudioContext;
  setMuted(muted: boolean): void;
  stop(): void;
}

export function resamplePcm16(samples: Float32Array, sourceRate: number, targetRate = TARGET_RATE): Int16Array {
  if (samples.length === 0) return new Int16Array();
  const outputLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const output = new Int16Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = (index * sourceRate) / targetRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const interpolated = samples[left]! + (samples[right]! - samples[left]!) * (position - left);
    const bounded = Math.max(-1, Math.min(1, interpolated));
    output[index] = bounded < 0 ? Math.round(bounded * 32_768) : Math.round(bounded * 32_767);
  }

  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function startCapture(onChunk: (dataBase64: string) => void): Promise<CaptureHandle> {
  const releaseSession = holdRecordingSession();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true },
    });
  } catch (error) {
    releaseSession();
    throw error;
  }
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    releaseSession();
    throw error;
  }
  const nodes: AudioNode[] = [];
  let stopped = false;

  const publish = (samples: Float32Array) => {
    const pcm = resamplePcm16(samples, context.sampleRate);
    onChunk(bytesToBase64(new Uint8Array(pcm.buffer)));
  };

  try {
    const source = context.createMediaStreamSource(stream);
    nodes.push(source);

    if (context.audioWorklet) {
      await context.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      const worklet = new AudioWorkletNode(context, 'ogm-capture');
      const muted = context.createGain();
      muted.gain.value = 0;
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => publish(event.data);
      source.connect(worklet);
      worklet.connect(muted);
      muted.connect(context.destination);
      nodes.push(worklet, muted);
    } else {
      console.warn('AudioWorklet is unavailable; using legacy microphone capture.');
      const processor = context.createScriptProcessor(4096, 1, 1);
      const muted = context.createGain();
      muted.gain.value = 0;
      processor.addEventListener('audioprocess', (event) => {
        publish(event.inputBuffer.getChannelData(0));
      });
      source.connect(processor);
      processor.connect(muted);
      muted.connect(context.destination);
      nodes.push(processor, muted);
    }

    await context.resume();
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    releaseSession();
    await context.close();
    throw error;
  }

  return {
    context,
    setMuted(muted) {
      for (const track of stream.getAudioTracks()) track.enabled = !muted;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const node of nodes) node.disconnect();
      for (const track of stream.getTracks()) track.stop();
      releaseSession();
      void context.close();
    },
  };
}
