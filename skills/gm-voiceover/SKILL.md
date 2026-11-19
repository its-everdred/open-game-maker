---
name: gm-voiceover
description: Sample expressive character voices through the media broker and make captioned local draft voiceovers.
---

# Game Maker voiceover

Use this for a short NPC line, trailer read, or accessibility draft. Keep the written script as the caption source of
truth. Transcription supplies draft timestamps and an intelligibility check; it never rewrites approved words.

## Voice samples for creator picks

Use the same media-broker route as `gm-image-mock`: `request-mock.py --kind voices --out <dir>` lists voices;
`--kind voice --voice-id <id> --prompt-file <line.txt> --out <dir>` generates a short sample. Offer six expressive
voices per character, each saying the same two lines, with `--voice-model eleven_v3 --stability 0.0` and emotion tags.
Attach audio to every option before raising a non-blocking pick. Build the recommendation while waiting; silence is
not approval. Generate no full set until the creator picks. Do not send private or unconsented reference audio.

## Local draft rights and size gate

Use a synthetic built-in reference or a reference whose speaker gave explicit consent for this use. Never imitate a
real person, public figure, or minor without that consent. For local drafts, keep the reference, model cache, generated WAV, and caption
files local; do not publish or upload them. A model download over 5 GB or generation beyond a short test needs Kevin's
approval before it starts.

Use a task-local virtual environment. Before resolving Chatterbox, install CPU-only `torch==2.6.0` and
`torchaudio==2.6.0` from PyTorch's official CPU wheel index. Install the remaining declared dependencies without
replacing those wheels, then install `chatterbox-tts==0.1.7` from source revision with `--no-deps`:
`5de7a54aa4e5e2baadb0182dde554908b48b85c2`; the PyPI wheel carrying the same version predates Nano support. Download
only `ResembleAI/chatterbox-nano` revision `71ccd1d0081b430592cea481f4307e764e07bc64`. Load that snapshot locally with
Nano mode on CPU. Do not silently fall back to Turbo, the original 500M model, or another checkpoint. Keep the
model's watermarking intact.

For caption timing, pin `faster-whisper==1.2.1`, its working media boundary `av==16.0.1`, and
`Systran/faster-whisper-tiny.en` revision
`0d3d19a32d3338f10357c0889762bd8d64bbdeba`. Run it from the downloaded local snapshot with CPU `int8`; do not allow
an unpinned name to fetch a newer model during generation. Newer PyAV 19 removes an argument that faster-whisper
1.2.1 still passes, so leaving `av>=11` unconstrained is not reproducible.

## Make and verify the line

Normalize the consented reference to mono PCM WAV and keep at least six clean seconds because Nano rejects shorter
prompts. Generate one short scripted line, save PCM WAV, then transcribe it locally. Write SRT timings around the
approved script text, using the transcription only to place and check the words.

Use FFprobe to require a non-empty audio stream, expected duration, and PCM sample format. Listen when the current
environment has audible playback; otherwise record the listening step as a post-deploy check and do not claim it ran.
Reject unexpected speech, a materially different script, clipping, or a voice whose permission is unclear.

## Worked example

The local example uses Chatterbox Nano's bundled synthetic conditionals on CPU to say “Local tools keep every game
voice private.” It writes
`assets-local/sets/examples/gm-voiceover/voiceover.wav` and a script-led `captions.srt`. The reference, output, and model
cache remain ignored local evidence.
