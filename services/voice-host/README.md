# Voice host

The voice host supervises one `voice_converse` instance and ElevenLabs Scribe sessions. It accepts short-lived OGM tokens on a loopback WebSocket, serves briefings from an in-memory cache, and forwards confirmed instruction drafts and final voice turns to the API. It stores no audio or transcript; final text follows the normal API chat-retention policy.

At conversation start, the briefing includes every open Aiur Command for the current request, including older unanswered Commands. The agent reads those choices aloud and sends an explicit spoken choice through the same Aiur Decision API used by typed Command replies. A new feature mentioned during the call stays separate and becomes its own change request.

## Reuse boundary

OGM pins Aiur's `voice_converse` package for provider connections, normalized events, limits, cleanup, and the Command tools, and consumes Aiur's Scribe transcriber package for one-way dictation rather than carrying a transcriber of its own. OGM owns target authorization, short-lived tokens, chat delivery, environment wiring, and the existing browser presentation. Provider fixes belong in Aiur rather than local forks.

## Build

The Mix project pins both Aiur packages at the commits in `mix.exs` (`@aiur_pin` for `voice_converse`, `@aiur_transcribe_pin` for the Scribe transcriber, mirrored in `mix.lock`). On the OGM host, use the local aiur checkout so dependency resolution does not need GitHub access:

```sh
OGM_AIUR_GIT=$HOME/github/aiur HEX_OFFLINE=1 mise exec -C services/voice-host -- mix deps.get
MIX_ENV=prod mise exec -C services/voice-host -- mix release
```

While the Scribe pin is an unmerged pull-request commit, fetch it into the local aiur checkout first: `git -C "$HOME/github/aiur" fetch origin <scribe-pin>`.

The release is `_build/prod/rel/voice_host`. `ops/bin/ogm-run voice-host` starts it through the existing `ogm-voice-host.service` unit.

## Configure

Create missing API and voice-host environment files. The initializer refuses to overwrite an existing file and preserves shared secret values across unit files; add new names to an existing file manually.

```sh
pnpm --filter @ogm/config build
pnpm --filter @ogm/config exec ogm-env-init api
pnpm --filter @ogm/config exec ogm-env-init voice-host
```

Set `OGM_API_INTERNAL_URL` to the loopback API base URL and `OGM_VOICE_WS_URL` to the public `/ws/voice` URL. The voice host defaults to `OGM_VOICE_PROVIDER=fake`, which needs no provider key and spends nothing. To enable ElevenLabs after accepting its charges, set `OGM_VOICE_PROVIDER=elevenlabs_agents`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `OGM_VOICE_LLM`, and an absolute durable `OGM_VOICE_CLEANUP_ROOT` in `voice-host.env`. Keep every env file mode `0600`; the key and agent id never reach the browser. Until the pinned `voice_converse` carries hosted-agent selection, the ElevenLabs adapter opens the account's default agent, so set that default to this game's agent and expect `ELEVENLABS_AGENT_ID` to take effect once the pin is bumped.

One-way dictation consumes ElevenLabs transcription credits while its press-to-talk session is active. Two-way voice consumes conversational-AI credits until the call ends. Batch narration consumes text-to-speech credits only when separately enabled below. The host requests `record_voice: false`, keeps no audio or provider transcript, and stores only bounded final text through the API's normal chat history. The cleanup root holds provider-conversation cleanup work, not transcript text, so it must survive service restarts.

Batch narration is off until `OGM_VOICE_NARRATION_ENABLED=true`; until then `POST /internal/narration` answers
501 `narration_disabled` and games fall back to browser speech, even with a provider key present. When on, it
writes temporary WAV files to `OGM_VOICE_RENDER_DIR` (the system temporary directory's
`ogm-voice-renders` child by default). The host creates it with mode `0700`; the API deletes each WAV after
transcoding it. `OGM_NARRATION_CONCURRENCY` limits API-side renders to 2 by default.

[`roles/creator.md`](roles/creator.md) is the source of truth for the creator agent's role prompt. When enabling a live provider, paste that file into the provider's agent prompt; the host also includes it in every briefing so local and live behavior use the same guidance.

The service binds the conversation socket to `127.0.0.1:40400` and internal HTTP to `127.0.0.1:40401` by default. The internal surface is:

- `GET /healthz`
- `POST /internal/briefing` with `Authorization: Bearer <OGM_VOICE_INTERNAL_SECRET>`; the legacy
  `X-OGM-Internal` form is also accepted
- `POST /internal/narration` with the same credential and `{ text, voice_id, format: "pcm_24000" }`

Ingress setup remains owned by `ops/bin/ogm-ingress.sh`, which maps `/ws/voice` to `OGM_VOICE_PORT`.

## Run

Build the release before enabling the existing user unit:

```sh
ops/bin/ogm-host-setup.sh
systemctl --user restart ogm-voice-host
curl --fail --silent http://127.0.0.1:40401/healthz
journalctl --user -u ogm-voice-host --since today
```

The health response identifies `voice-host` and the selected provider. Inspect logs only for service state; token and provider secret values must never appear.
