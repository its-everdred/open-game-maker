---
name: gm-audio
description: Build a clear, varied game mix through the SDK's shared audio graph and host fallback.
---

# Game Maker audio

## One graph, four buses

Create one audio instance with `sdk.audio.createAudio({ rng })` from `@gm/sdk/audio`, passing the game's seeded runtime
RNG; never construct another AudioContext, use engine audio managers, or route around it. Route every cue through the `BusName` set
`music|sfx|amb|voice`. Keep the voice bus clearest, leave headroom on the others, and lower music and ambience while
voice plays. Start music at -12 dB under SFX, then tune by the rendered levels. Apply host mute and volume changes
through `GmAudio.applySettings()`.

The SDK's capture listeners call `GmAudio.unlock()` from the first `pointerup` or `touchend`, select the `audioSession`
playback type, and start a silent buffer. Do not add another unlock path. Use `GmAudio.status()` when the game must
show that sound still needs a tap; the SDK also handles interrupted or hidden contexts.

## Direction first

Read the game's audio direction before you search. The creation choices carry `choices.audio` (`style` and `mood`, plus
free text) and the scope document repeats it as "Audio direction". That is a direction, never pack ids: pull tracks and
effects freely across every pack whose cards match it. Turn the axes into flags — `--genre <style> --mood <mood>` —
then widen one axis when a pack's cards are thin. When no card matches, read `gm assets facets --kind audio` and take the
closest mood; never force a pack the creator did not pick.

## Samples and generated cues

Find pack samples by what they sound like, not by pack. `gm assets search --kind audio --mood tense` returns the
tracks and effects whose cards carry that mood; `--genre chiptune` narrows a style axis, and no words are needed.
Then `gm assets facets --kind audio` counts the moods, genres, instruments and `game_fit` situations the cards hold,
which is how you see the direction space before choosing. Select a hit with `gm assets use` and play its logical id
through `GmAudio.play()`. Check the card's rights with `gm assets info <id>` before it ships: a private-audience or
redistribution-restricted card cannot go in the build. Prefer a card whose row already says what you need over opening
files. Packs provide build-ready MP3 samples. Do not load an Ogg-only URL or bypass the asset manifest. For repeated
cues, pass `pitch: 0.05` for ±5% variation or choose a short pool with `GmAudio.playOneOf()`; keep the mechanic
deterministic and vary only its sound.

Use `GmAudio.zzfx()` for small interface, pickup, movement, and impact cues. Start from
[the preset sheet](references/zzfx-presets.md), then change one parameter at a time. The second ZzFX value controls
seeded pitch randomness; keep it subtle on repeated cues. Store the final number array with the game, not prose that
must be interpreted at runtime.

## Music and lifecycle

For a packed loop, start with `GmAudio.music(id, { fade: 1.2, vol: 0.45 })`, roughly -12 dB under the default SFX bus,
and add loop points when needed. For music as data, validate `song.json` with `sdk.audio.songSchema`, then pass it to
`GmAudio.song()`. The SDK owns Tone 15 and uses
`Tone.getTransport()`; never use Tone's deprecated global Transport or create a second Tone context.

Stop retained music and song handles when their state ends. Call `GmAudio.stop()` on a full reset and
`GmAudio.dispose()` when the game instance is disposed so sources, listeners, and the context do not leak.

Packed music and voice assets use the asset cache's `stream` phase. Put large tracks in a `lazy:<group>` phase in
`assets.lock.json`; set a tracked per-group budget in `gm.manifest.json` as
`{"assetBudgets":{"lazy":{"music":{"mobile":8388608,"desktop":16777216}}}}` (bytes). Stream-only groups may use up to
32 MiB on mobile/low and 64 MiB on desktop; groups with preloaded assets remain capped at 1.5 MiB and 4 MiB respectively. The
build report shows the measured bytes and rejects values above those ceilings.

## Host fallback

When the host requests iOS audio fallback, enable `GmAudio.relay(true)`. Samples and loops then leave through the
`audio.relay` bridge while local output is muted; disable relay to return to the same SDK graph. Do not post bridge
messages yourself.

## Verify the mix

Run `GmAudio.renderCue()` on every packed cue. `CueMetrics.peakDb` stays below -1 dBFS; compare
`CueMetrics.rmsDb` across cues so important events are distinct without one cue dominating. Check rapid repeats,
music-to-voice ducking, mute, resume after a hidden tab, and cleanup, then run `gm run` and listen from the start.

Meters and browser automation do not prove audible output. Always list iPhone Safari and sound as `unchecked` in V1
unless an operator actually listened on that hardware.

## Reference

Open `vendor/gamedev/audio-design` for mix and variation practice, and `vendor/phaser/audio-and-sound` only for
engine facts. The SDK graph wins when a vendor reference suggests a separate context, mixer, unlock path, or asset
loader.
