# `@ogm/api`

The platform API: Hono on `127.0.0.1:$OGM_API_PORT`, the only process that opens the SQLite database
(`$OGM_DATA_DIR/ogm.sqlite3`). Boot runs the `@ogm/db` migrations, then mounts every context.

Env (through `@ogm/config`): `OGM_API_PORT`, `OGM_ANALYTICS_RETENTION_DAYS` (default `90`), `OGM_DATA_DIR`,
`OGM_GAMES_ROOT` (optional; defaults to the `games` directory beside `OGM_DATA_DIR`),
`OGM_GAMES_ORIGIN`, `OGM_INTERNAL_TOKEN`, `OGM_JOB_TOKEN_SECRET`, `OGM_BLOB_ROOT`, `OGM_BLOB_SIGNING_KEY`,
`OGM_PUBLIC_ORIGIN`; the auth
context adds `OGM_APP_ORIGIN`, `OGM_SESSION_SECRET`, `OGM_WS_TOKEN_SECRET` and the optional
`OGM_ALLOWED_EMAILS`, `OGM_MAINTAINER_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SMTP_URL`, `SMTP_FROM`, `OGM_QA_EMAILS` (see
`docs/ops/netlify-proxy.md`). Room lifecycle calls add `OGM_ROOMS_INTERNAL_URL` and `OGM_ROOMS_INTERNAL_SECRET`.
The sign-in allow list lives in the `allowed_users` table (lowercase email, `player` / `maker` / `admin` role,
who added it, when) and admins manage it at `/admin/users`. `OGM_ALLOWED_EMAILS` and `OGM_MAINTAINER_EMAILS` are
read once, on the first start after this table exists: the allowed addresses become `maker` rows and the
maintainers become `admin` rows. After that the database is the source of truth, so editing the env lists changes
nothing and an empty table admits nobody (one `auth-allow-list-empty` warning at startup).
`OGM_MAINTAINER_EMAILS` also stays a break-glass platform role read from the environment on every boot.
Roles reach the API as `capability` (a `player` cannot create or edit) and `platformRole` (`admin` manages users),
never as hidden buttons.
The API also reads `OGM_COMMIT_INTERNAL_URL`, `OGM_COMMIT_SERVICE_TOKEN`, `OGM_GAME_TEMPLATE_REF` (defaults to
`game-2d@1`), `OGM_INSTANCE_REPO` (`owner/repository` of the one repository every game's folder lives in),
`OGM_VAPID_KEY_FILE`, `OGM_VAPID_SUBJECT`, `OGM_BUILDER_WORKSPACES_ROOT` (optional), and
`OGM_CHAT_POLL_MS` (default `10000`), and `OGM_COMMAND_POLL_MS` (default `5000`).
Optional `OGM_ASSETS_ROOT` (the `assets-local/` library) gives `GET /api/catalog/style-families` its pack titles and
thumbnails; without it packs are named by id. Each style set includes `requiresPrivateRepository`: creation must force
private repository visibility when it is `true`. The field is `false` only when every referenced pack resolves to a
recognized public SPDX license; `LicenseRef-*`, unknown, and missing licenses fail closed to `true`.

`OGM_VAPID_KEY_FILE` defaults to `~/.config/ogm/env/ogm-api.vapid.json`; the API creates the key pair with mode
`0600` on first boot. Set `OGM_VAPID_SUBJECT` to the contact email used for the Web Push `mailto:` subject.
Push requests use a 10-second socket timeout. Expired subscriptions are removed immediately; other failures are
removed after five consecutive attempts without failing the notification emitter.

Build publishing (`src/builds`): a game repo's `before_remove` hook runs `pnpm run build` and posts the fresh `dist/` (plus `manifest.json`,
`design/design.json`, `achievements.json`) as a gzipped ustar archive to `POST /internal/jobs/by-ticket/:id/build` with
its daemon hook secret and `x-gm-sha`. Once Aiur reports the run completed, the API registers the build, moves it to
`$OGM_GAMES_ROOT/<gameId>/<buildId>/`, writes `.complete`, switches the job's branch to it and finishes the job. New-game,
feature and repair jobs stay running until then; a run with no build 30 minutes after completion fails
(`build_not_received`). A refused archive is logged as `build_upload_refused` with its reason and leaves the job
waiting; a staged build that fails to publish fails the job with the reason in the `build_publish_failed` log line.

The build chat (`/api/v1/jobs/:jobId/chat`) relays agent posts from `<workspace>/.gm/outbox/*.jsonl` under
`OGM_BUILDER_WORKSPACES_ROOT`; without it the relay stays off and the API logs the missing name. Lines of other types
go to a context's `src/<context>/outbox.ts`, which exports `type` and `handle(line, ctx)`. Production wires
`deps.registry.chatJobs` to the jobs table and `deps.registry.aiurClientFor` to the daemon directory; both stay
injectable for focused tests. Without an aiur client creator posts stay pending and nothing is polled. The trusted job
launcher must call `registerWorkspace(sqlite, jobId, workspaceRoot)` before sandbox output is accepted; unregistered
workspaces and lines naming another job are rejected.

## Scope session image uploads

`POST /api/v1/games/:gameId/scope/sessions/:sessionId/images` accepts one authenticated raw image body for the owner
of an open scope session. Set `Content-Type` to an `image/*` media type; do not send multipart data. The compressed
request body is limited to 10 MiB and uploads are limited to 10 per session and creator per minute. The API applies
the source orientation, re-encodes the pixels as WebP without source metadata, appends a creator image message to the
session's existing build-chat stream, mirrors a time-limited signed image reference to the scope worker, and returns:

```json
{ "imageId": "m_…" }
```

`imageId` is the appended build-chat message id. The creation transport should upload each image before posting any
accompanying text; no second attachment commit is required. The route returns `400 empty_image`, `413 image_too_large`,
`415 unsupported_image_type`, `422 invalid_image`, or `429 rate_limited` for upload validation failures. Missing or
mismatched sessions return `404 scope_session_not_found`, closed sessions return `409 scope_session_not_open`, and
normal authentication and game-owner authorization errors remain `401` or `403`.

## Chat attachments

`POST /api/v1/jobs/:jobId/chat/attachments` takes one raw file from the job's creator: `Content-Type` is an `image/*`
type (at most 10 MiB, re-encoded to WebP with no source metadata) or `text/plain`, `text/markdown` or
`application/json` (at most 64 KB, UTF-8, JSON must parse), and `X-File-Name` is the URI-encoded file name. It answers
`201` with a `chat.attachment.v1` object. Post the returned ids in `attachments` (at most 8) on
`POST /api/v1/jobs/:jobId/chat`; `text` may then be left out. Uploads return `400 empty_attachment`,
`413 attachment_too_large`, `415 unsupported_attachment_type`, `422 invalid_image`, `422 invalid_text`,
`422 invalid_json` or `429 rate_limited`; a post naming an id that is not the creator's unsent upload for that job
returns `422 attachment_not_found` and stores nothing.

The worker gets each file three ways: the job bundle lists it (`attachments[]`) and the after_create hook downloads it
from `/internal/jobs/by-ticket/:ticket/attachments/:id` into `.gm/inbox/attachments/`; a message posted after the
workspace is pinned copies its files there directly; and the aiur message inlines text files that fit within its
8,000 characters and names every file by that path (images also carry a signed URL).

Tier-3 game assets (agent-made or edited) live in the blob store, not the game repo. A game daemon puts and gets them
by sha256 at `PUT|GET /blobs/daemon/sha256/:hex` with its hook secret as the bearer (`gm assets register`
puts through `OGM_INTERNAL_URL` and `OGM_HOOK_SECRET_FILE`). A put whose body does not hash to
`:hex` returns `400 sha_mismatch`; one over `OGM_BLOB_PUT_MAX_BYTES` (default 64 MiB) returns `413 blob_too_large`; a
blob already stored answers `200` without reading the body.

Creator Commands use the same workspace pin. The API polls each active job's aiur Commands every
`OGM_COMMAND_POLL_MS`, keeps the supervisor token server-side, and writes answered or moot results under
`<workspace>/.gm/inbox/commands/` for the sandboxed `gm command wait` command.

```sh
pnpm --filter @ogm/api build && pnpm --filter @ogm/api start   # or: pnpm --filter @ogm/api dev
curl -s http://127.0.0.1:$OGM_API_PORT/healthz
```

## Adding a context

Create `src/<context>/routes.ts` whose default export is a `new Hono<ApiBindings>()`. It mounts at
`/api/v1/<context>` unless it exports `prefix`; an exported `setup(deps)` runs before mounting (push a resolver onto
`deps.registry.principalResolvers`, set `deps.registry.gameResolver`, subscribe to `deps.events`). Never edit
`src/app/`. Throw `HttpError(status, code)` for errors, use `parseBody`/`parseQuery` with `@ogm/contracts` schemas, and
read the caller with `requirePrincipal(c, kinds)`.

Contexts may share an exported prefix when they own distinct routes. Auth registers the mail sender and user directory
seams; games registers its resolver and uses the injected repository provisioner.

A context that needs tables adds `packages/db/src/schema/<context>.ts`, one line in `schema/index.ts`, and a
`packages/db/migrations/<YYYYMMDDHHmmss>_<name>.sql` (hand-written, or `pnpm --filter @ogm/db generate --name <name>`).
Applied migrations are never edited.
