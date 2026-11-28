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

Live workspace generations are served at `/l/<gameId>/<capability>/<generation>/<path>` after the signed-in API issues
a short-lived capability for an active ticket's workspace grant. The entry URL chooses a generation once per load;
responses are not cached, and workspace files are opened with containment and link checks.
Each served file must also match the content scanned when its capability was issued. Session aliases expire after 30 minutes;
reopen the live URL to obtain another. Old generations remain available for at least one hour after replacement.

The repository daemon's trusted workspace hooks must run `node <core-checkout>/scripts/preview/repository-hook.ts create`
from the workspace after creation, and the same command with `remove` before removal. The create hook requires
`THIS_REPOSITORY_URL` and a ticket identifier in `AIUR_HOOK_TICKET_IDENTIFIER` (or a numeric workspace basename),
and grants only an open ticket carrying exactly one game label. For existing workspaces, run the create hook once
from each workspace with the same environment. The API and games host must run as the account that owns these grants.

The service exposes `GET /healthz`, `GET|HEAD /g/<gameId>/<buildId>/<path>`, shared content-addressed blobs at
`GET|HEAD /a/<sha256>.<ext>`, and the cache worker at `GET|HEAD /game-cache.js`. It never sets cookies, never lists a
directory, and applies the game security headers to every game, blob, and worker response. Text responses negotiate
Brotli or gzip; media files are never compressed.
