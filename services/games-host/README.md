# Games host

`@ogm/games-host` serves completed game builds from a loopback-only process. Tailscale ingress owns the public
games origin; this service owns immutable file responses and the browser security headers around untrusted game code.

## Environment

- `OGM_GAMES_PORT`: loopback port for the HTTP server.
- `OGM_GAMES_ROOT`: directory containing `<gameId>/<buildId>/` build trees.
- `OGM_APP_ORIGIN`: one or more space-separated HTTP(S) origins allowed by CSP `frame-ancestors`.
- `OGM_GAMES_BIND`: optional assertion; if set, it must be `127.0.0.1`.
- `OGM_GAMES_SW`: optional path to the built game cache worker; defaults to `packages/host/dist/game-cache.js` in the
  workspace.

A build is invisible until its directory contains `.complete`. Publishers should use the exported
`@ogm/games-host/layout` helpers and call `markComplete` only after every build file has been durably written.
The API's build publisher (`services/api/src/builds`) is the production writer.

The service exposes `GET /healthz`, `GET|HEAD /g/<gameId>/<buildId>/<path>`, shared content-addressed blobs at
`GET|HEAD /a/<sha256>.<ext>`, and the cache worker at `GET|HEAD /game-cache.js`. It never sets cookies, never lists a
directory, and applies the game security headers to every game, blob, and worker response. Text responses negotiate
Brotli or gzip; media files are never compressed.
