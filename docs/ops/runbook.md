# Runbook

Everything runs as `<user>` under `systemd --user`; nothing here needs sudo. Steps only Kevin can do are in
[hand-steps.md](hand-steps.md).

## Install

```
ops/bin/ogm-host-setup.sh --dry-run   # what it would do
ops/bin/ogm-host-setup.sh             # dirs, units into ~/.config/systemd/user, enable services + backup timer
ops/bin/ogm-host-setup.sh --stop      # disable and stop them all
```

Units are rendered from `ops/systemd/` with this checkout's path; re-run after pulling unit changes. A service whose
build is missing runs `ops/bin/ogm-run`'s placeholder instead (see Placeholders).

## Start, stop, logs

```
systemctl --user status 'ogm-*'
systemctl --user restart ogm-api            # one unit
systemctl --user restart 'ogm-*'            # all of them
journalctl --user -u ogm-api -f             # follow one unit
journalctl --user -u 'ogm-*' --since -1h    # everything recent
```

Builder daemons run as `ogm-aiur@<slug>`, one per active game, at most four live; several daemons can share one instance
repository and each checks only its own `games/<slug>/` out of it. The API's fleet manager (`@ogm/builder`) renders
`~/.local/share/ogm/daemons/<slug>/` and `~/.config/ogm/env/ogm-aiur@<slug>.env`, starts the
unit on the first admitted job and stops it after 30 min with no active job; stopping keeps `workspaces/`. Each daemon
is registered in `~/.aiur/remote-instances.yaml` with a read token, so
`~/github/aiur/scripts/aiurdev --instance <slug> status` works without the cookie.

Two launchers exist for the same daemon: `ops/systemd/ogm-aiur@.service` runs `%h/github/aiur/scripts/aiurdev run
--container` (what the fleet manager starts), and `ops/bin/ogm-run aiur <slug>` runs `~/.local/bin/aiur run --container`.
Setup step 3 links `~/.local/bin/aiur` to `~/github/aiur/scripts/aiurdev`, so both start the same checkout. Which one is
canonical is open (setup-site plan, open question 3) until Kevin answers.

## Status

```
ops/bin/ogm-status            # units, placeholders, listeners, disk, sizes, backup, ingress
ops/bin/ogm-status --json
ops/bin/ogm-status --check    # exit 1 on a failed unit, a STRAY listener, a missing service build, or a backup over 48 h
```

It prints names and sizes only, never env values. A listener is `STRAY` when an OGM process (any process in an `ogm`
cgroup), or a `python3 -m http.server`, listens on anything but `127.0.0.1` or `[::1]`. Stray listeners are reported,
not killed: stop the process that owns the pid.

## Placeholders

`PLACEHOLDER <service>` in the journal means `ops/bin/ogm-run` found no build (or no setup) for that unit and is
idling. Node units run the file their package's `start` script names; `ogm-status --check` reports a missing one, and a
unit still idling after its build lands. It clears when the unit restarts. drive-sync waits for the Drive setup steps in
`~/remind.md`. `ogm-aiur@<slug>` has no placeholder: a failing preflight keeps it from starting, and the reasons
are on its `game_daemons` row.

## Env files and rotation

Each unit reads `~/.config/ogm/env/<unit>.env` (mode 0600). Create one with
`pnpm --filter @ogm/config exec ogm-env-init <unit>`. The commit unit is the exception: it reads `ogm-commit.env`,
copied from `services/commit/ops/ogm-commit.env.example` ([services/commit/README.md](../../services/commit/README.md)). Secrets shared between units (for example
`OGM_WS_TOKEN_SECRET` for api and rooms) are copied from whichever unit file already holds them.
The API file must set `OGM_APP_ORIGIN`, `OGM_COMMIT_INTERNAL_URL`, and `OGM_COMMIT_SERVICE_TOKEN`;
`OGM_GAME_TEMPLATE_REF` defaults to `game-2d@1` when left blank. Job admission defaults each member to
`OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD=5000000` and resets that allowance at midnight in
`OGM_RESET_ZONE_DEFAULT` (the host's IANA time zone when blank). Family budget settings override both defaults.

The commit file must also set the shared `OGM_INTERNAL_TOKEN` so boundary checks can read active repositories and
creator PII terms. The Aiur Executor's unit needs the same `OGM_INTERNAL_TOKEN`: it reads a New Game request's private
context through the API's `/internal/new-game` routes, can mint a scoped one-hour token for the worker it starts, and
puts neither credential in the parent issue ([New Game request parent issue](../reference/new-game-request.md)).
`OGM_BLOCKLIST_FILE` defaults to `$OGM_DATA_DIR/blocklist.txt`. Set
`OGM_GITHUB_WEBHOOK_SECRET` when GitHub pull-request webhooks are exposed; the 60-second poller remains active as the
fallback when it is blank.

### Per-unit values

`ogm-env-init` generates the secrets. These are the non-secret values a new host fills in each file, from the
`[unit]` tags in `.env.example`; an optional name has a default or turns its feature off when blank. Paths are absolute (systemd does not expand
`~`).

| Unit file | Fill | Optional |
| --- | --- | --- |
| `api.env` | `OGM_API_PORT`, `OGM_PUBLIC_ORIGIN`, `OGM_APP_ORIGIN`, `OGM_GAMES_ORIGIN`, `OGM_DATA_DIR`, `OGM_BLOB_ROOT`, `OGM_ROOMS_INTERNAL_URL`, `OGM_COMMIT_INTERNAL_URL`, `OGM_INSTANCE_REPO` (`owner/repository` every game lives in), `OGM_BUILDER_BOT_LOGIN`, `OGM_INTAKE_BOT_LOGIN`, `OGM_VAPID_SUBJECT`; tokens you obtain: `OGM_BUILDER_BOT_TOKEN`, `OGM_INTAKE_GITHUB_TOKEN` | `OGM_GAMES_ROOT`, `OGM_ASSETS_ROOT`, `OGM_INTAKE_DIR`, `OGM_VOICE_HOST_INTERNAL_URL`, `OGM_VOICE_WS_URL`, `OGM_BUILDER_WORKSPACES_ROOT`, `OGM_VAPID_KEY_FILE`, `OGM_GAME_TEMPLATE_REF`, `OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD`, `OGM_RESET_ZONE_DEFAULT`, `OGM_ANALYTICS_RETENTION_DAYS`, `OGM_REPORT_BUNDLE_MAX_BYTES`, `OGM_NARRATION_CONCURRENCY`, `OGM_INTAKE_SWEEP_SECONDS`, `OGM_CHAT_POLL_MS`, `OGM_COMMAND_POLL_MS`, `OGM_DESIGN_DEFAULT_MS`, `OGM_ALLOWED_EMAILS`, `OGM_MAINTAINER_EMAILS`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `SMTP_URL`/`SMTP_FROM`, `OGM_QA_EMAILS` |
| `rooms.env` | `OGM_ROOMS_PORT`, `OGM_GAMES_ORIGIN`, `OGM_API_INTERNAL_URL` | |
| `games.env` | `OGM_GAMES_PORT`, `OGM_GAMES_ROOT`, `OGM_APP_ORIGIN` | `OGM_GAMES_SW` (defaults to the workspace's built `packages/host/dist/game-cache.js`) |
| `voice-host.env` | `OGM_VOICE_PORT`, `OGM_VOICE_INTERNAL_PORT`, `OGM_API_INTERNAL_URL`, `OGM_VOICE_PROVIDER` (`fake`) | Live ElevenLabs only: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `OGM_VOICE_LLM`, `OGM_VOICE_CLEANUP_ROOT`; tuning: `OGM_VOICE_MAX_SESSIONS`, `OGM_VOICE_RENDER_DIR`, `OGM_VOICE_NARRATION_ENABLED` |
| `intake.env` | `OGM_ASSETS_ROOT`, `OGM_STATE_DIR` | |
| `drive-sync.env` | none; the worker reads `~/.config/ogm/drive-sync.toml` and `drive-sa.json` (`scripts/py/drive-sync/README.md`) | |
| `backup.env` | `OGM_DATA_DIR`, `OGM_BLOB_ROOT`, `OGM_BACKUP_TARGET` | |
| `ogm-commit.env` | `OGM_COMMIT_PORT`, `OGM_DATA_DIR`, `OGM_API_INTERNAL_URL`, `OGM_PLATFORM_ISSUE_REPO`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `OGM_BUILDER_BOT_LOGIN` | `OGM_BLOCKLIST_FILE`, `OGM_GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` |
| `repair.env` | `OGM_API_INTERNAL_URL`, `OGM_GAMES_ROOT`; no unit runs `services/repair` yet | |
| `core-bump.env` | `OGM_CORE_BUMP_REPOS`, `OGM_CORE_BUMP_CORE_REPO`; the App credentials come from `ogm-commit.env` | `OGM_CORE_BUMP_CORE_BRANCH`, `OGM_CORE_BUMP_WORK_DIR` |

Names read by more than one unit must hold the same value in each file:

| Name | Files |
| --- | --- |
| `OGM_DATA_DIR` | `api`, `backup`, `ogm-commit` |
| `OGM_BLOB_ROOT` | `api`, `backup` |
| `OGM_GAMES_ROOT` | `api`, `games`, `repair` |
| `OGM_APP_ORIGIN` | `api`, `games` |
| `OGM_GAMES_ORIGIN` | `api`, `rooms` |
| `OGM_ASSETS_ROOT` | `api`, `intake` |
| `OGM_API_INTERNAL_URL` | `rooms`, `voice-host`, `ogm-commit`, `repair` (the API's port) |
| `OGM_BUILDER_BOT_LOGIN` | `api`, `ogm-commit` |
| `OGM_WS_TOKEN_SECRET`, `OGM_ROOMS_INTERNAL_SECRET` | `api`, `rooms` |
| `OGM_VOICE_TOKEN_SECRET`, `OGM_VOICE_INTERNAL_SECRET` | `api`, `voice-host` |
| `OGM_COMMIT_SERVICE_TOKEN` | `api`, `ogm-commit` |
| `OGM_INTERNAL_TOKEN` | `api`, `ogm-commit`, `repair` |
| `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` | `ogm-commit`, `core-bump` (the core-bump unit loads `ogm-commit.env`) |

The API's internal URLs carry the other units' ports: `OGM_ROOMS_INTERNAL_URL` uses `OGM_ROOMS_PORT`,
`OGM_VOICE_HOST_INTERNAL_URL` uses `OGM_VOICE_INTERNAL_PORT`, `OGM_COMMIT_INTERNAL_URL` uses `OGM_COMMIT_PORT`.
`ogm-env-init` writes every `[shared]` name into every file; a unit ignores the ones it does not read.
`AIUR_ERLANG_COOKIE` and `GITHUB_TOKEN` (`[aiur]`) go in `~/.aiur/.env`; the fleet writes them into each
`ogm-aiur@<slug>.env`. `AIUR_API_URL` and `AIUR_API_TOKEN` are read by no unit today, and
the `[gm]` names belong to the `gm` CLI, not a unit.

The fake voice provider is the no-spend default. Enabling ElevenLabs is an operator spending decision: dictation uses transcription credits, two-way voice uses conversational-AI credits, and separately enabled narration uses text-to-speech credits. The host sets provider audio recording off and keeps no local audio or transcript; only final text enters normal chat retention. Keep `OGM_VOICE_CLEANUP_ROOT` on durable storage so provider cleanup survives a service restart.

### Rotation

`ogm-env-init` only generates a secret no unit file holds yet, and `--force` keeps existing secrets while blanking
non-secret values. To rotate a secret, replace its value by hand in every file that has it, then restart those units:

```
grep -l '^OGM_SESSION_SECRET=' ~/.config/ogm/env/*.env   # which files
openssl rand -hex 32                                    # new value; paste it into each file
systemctl --user restart ogm-api
```

## Sign-in and users

The sign-in allow list is data, not config: table `allowed_users` holds a lowercase email, its role (`player`,
`maker`, `admin`), who added it and when. Manage it in the admin area at `<app-origin>/admin/users` — add an
address with a role, change a role, remove an address (which ends its sessions) or resend the invite mail. Each
addition mails a sign-in link through the instance's mail sender, and the one URL to share with testers is
`<app-origin>/login`.

`OGM_ALLOWED_EMAILS` and `OGM_MAINTAINER_EMAILS` seed that table on the first start only: the allowed addresses
become makers and the maintainers become admins. Editing either list afterwards changes nothing.
`OGM_MAINTAINER_EMAILS` also keeps its own break-glass platform role, so a lost admin login is repaired by listing
the address there and restarting the API. An address that is not on the list gets the same neutral answer as one
that is, and no mail is sent to it.

## Ingress

See [ingress.md](ingress.md): `ops/bin/ogm-ingress.sh` mounts 8443 and 10000 on Tailscale, after Kevin's operator hand
step.

## Backup

`ogm-backup.timer` runs `ops/backup/backup.sh` nightly at 03:30 (`Persistent=true`, so a missed run happens at the next
boot). It reads `~/.config/ogm/env/backup.env` (systemd does not expand `~` there, so local paths are absolute):

```
OGM_DATA_DIR=/home/<user>/.local/share/ogm/data
OGM_BLOB_ROOT=/home/<user>/.local/share/ogm/blobs
OGM_BACKUP_TARGET=ssh:<backup-host>:~/ogm-backups      # or local:<absolute path>; ~/ is the remote home
```

Each run writes, under `<target path>/ogm-backups/`:

- `db-<STAMP>.sqlite`: a `VACUUM INTO` snapshot of `$OGM_DATA_DIR/ogm.db`, safe while the API writes. Skipped (with
  `no database yet`) until the database exists.
- `blobs-<STAMP>.tar.zst`: every blob and sidecar changed since the last verified run (the first run takes them all).
  Blobs never change, so this is an exact delta. The blob store also holds every game's tier-3 assets (agent-made or
  edited; game repos keep only their sha in `assets.lock.json`), so this backup is their only copy off the host.
- `manifest-<STAMP>.json`: the previous stamp, each file's size and sha256, the blob count, the host, the repo commit and
  the env file names (never their values).

The stamp (UTC `yyyymmddTHHMMSSZ`) is recorded in `~/.local/state/ogm/backup/last-stamp` and `last-ok` only after the
far-side sha256 of every file matches. A failed or interrupted run leaves them as they were, so the next run ships the
same delta again. The script never deletes anything at the target; prune old sets there by hand if space runs out.

Run one now:

```
systemctl --user start ogm-backup && journalctl --user -u ogm-backup -n 5
```

## Restore

```
ops/backup/restore.sh <stamp> --to /tmp/ogm-restore --target ssh:<backup-host>:~/ogm-backups
```

It follows the manifests back to the first full backup, checks every file's sha256 before writing, extracts the blob
tars oldest first, copies that stamp's database, checks that each restored blob's sha256 is its name, and prints the two
lines that point a service at the result:

```
OGM_DATA_DIR=/tmp/ogm-restore/data
OGM_BLOB_ROOT=/tmp/ogm-restore/blobs
```

It refuses a `--to` that is not empty. To put a restore in place: stop the units, move the old directories aside, move
the restored `data` and `blobs` to the paths in the env files, start the units. Env files are not in the backup;
recreate the ones the manifest lists with `ogm-env-init`.

`bash ops/test/backup-restore.sh` runs the same drill against a `local:` target in temp directories (CI runs it).

## Core bump

`ogm-core-bump.timer` runs `services/core-bump` every 15 minutes (`OnBootSec=5min`, then every 15 minutes after that).
Each tick reads
the core repository's branch head and compares it with the commit an instance repository pins in its `vendor/core.json`;
when they differ it runs that repository's `scripts/bump-core.sh` in a scratch clone and opens a `core-bump/<sha>` pull
request. It never merges: the instance repository's own checks gate the merge. A repository without `vendor/core.json`,
and one that already has a core bump pull request open, are left alone.

```
systemctl --user list-timers ogm-core-bump.timer
journalctl --user -u ogm-core-bump -f
systemctl --user start ogm-core-bump        # one tick now
```

`core-bump.env` names the instance repositories (`OGM_CORE_BUMP_REPOS`, comma-separated owner/repository) and the core
(`OGM_CORE_BUMP_CORE_REPO`). The unit also reads `ogm-commit.env`, so the GitHub App installed on the instance
repositories is the same one the commit service uses. The core repository must be public: its head commit is read
without a token. Scratch clones live in `OGM_CORE_BUMP_WORK_DIR` (`~/.local/state/ogm/core-bump`). Details:
[services/core-bump/README.md](../../services/core-bump/README.md).

The same `vendor/core.json` pin supplies the version of each core package when an instance repository installs them from
a registry instead of vendoring tarballs. Publishing is prepared but switched off: see
[core-packages.md](core-packages.md).

## Register a game whose repository already exists

Every game the app creates gets a new `games/<slug>/` folder in the instance repository. A game that already has
one — a game in an Open-Games monorepo, say — is registered instead, so nothing is created and no repository or
folder is touched. Registration is an admin API call, never a hand-edited row:

```
POST /api/v1/admin/games/import   # signed in as the family's owner or admin
{"title":"Blobs",
 "repo":{"owner":"<owner>","name":"<repository>","path":"games/blobs"},
 "daemon":{"port":4011,"checkoutPath":"<instance checkout>"}}
```

`ownerId` defaults to the admin who calls it and must be a member of that admin's family. `visibility` defaults to
`private` and `repoVisibility` to `public`. The daemon's `unit` and `envFile` default to the builder's convention for
the instance repository — `ogm-aiur@<repository>.service` and `<home>/.config/ogm/env/ogm-aiur@<repository>.env` — so
pass them only when the instance runs under a different name.

The folder under `games/` is the game's slug: `games/blobs` registers `blobs`, so the game's folder, its `/play/<slug>`
link and its daemon key are one name. A folder already answered by another game, or a repository and folder already
registered, is refused with a conflict rather than quietly shadowing the first game. So is a slug or port a daemon row
already answers to.

The `daemon` block is the game's link to the aiur instance already building that repository: its port and its
checkout, and — when the instance runs under a different name — its systemd unit and env file. The registration
writes that row keyed by the same slug and carrying the game's repository, so the fleet's daemon, the Commands poller
and the game's inbox read that instance's aiur and no other's.
The row's `status` defaults to `running`, because the instance the game is registered against is already up. Nothing
else changes — the game appears in the games picker and opens from its play link as soon as it is registered.

## Publish a build for a registered game

A game the app registered against a repository whose own tickets are not Game Maker jobs never gets a build: the
daemon's `before_remove` hook uploads a build per ticket, and those tickets never run in this instance's daemon. The
game appears in the picker and opens from its play link, but nothing is playable until an operator publishes a build.

`gm publish` builds one registered game at a git SHA and publishes the build through the same publisher the daemon's
uploads use, so the release history stays one path (`ops/bin/ogm-publish` is a thin wrapper that runs it with the
same arguments):

```
gm publish [<game-slug>] [--sha <ref>] [--checkout <path>] [--api <url>] [--keep] [--json]
```

Run from a game folder, the slug defaults to that game (the folder of the nearest `gm.manifest.json`). It reads the
internal token, the API port and the app origin from `~/.config/ogm/env/api.env` (or `$OGM_ENV_DIR/api.env`;
`OGM_INTERNAL_TOKEN`, `OGM_API_PORT`, `OGM_APP_ORIGIN`; the same names in the environment win), asks the API for the game's facts — its folder in the
instance repository and the checkout its daemon row names — and checks the commit out into a scratch git worktree
under `~/.local/state/ogm/publish`. It refuses before building when the game's code names an asset its
`assets.lock.json` does not list. Without `--sha` the commit is the repository's remote `main` as fetched now, never
the checkout's own HEAD or a stale `origin/main`. It builds that folder's own build script in production mode with a
relative base (`--base=./`, so the build works under `/g/<gameId>/<buildId>/`) and `OGM_ASSETS_ROOT`, then archives
`dist/` with the repository's `manifest.json`, `design/design.json` and `achievements.json` and posts it to the API's
internal route. The build lands as the next build on the game's `main` branch and as a release in the game's history;
the command prints the build id and the game's play link.

It needs the host's `~/.config/ogm/env/api.env`, so run it on the host as the API's user:

```
gm publish blobs                 # build the registered game "blobs" at its repository's remote main
cd games/blobs && gm publish     # the same, from the game's folder
gm publish blobs --sha <sha>     # build a specific commit
gm publish blobs --keep          # keep the worktree and the archive for inspection
gm publish blobs --json          # one JSON line: state, slug, gameId, sha, buildId, jobId, play
```

Re-run it with a newer SHA to publish the next release; the previous build stays playable until the new one is
tested and the branch pointer moves. Exit codes follow the gm CLI: 0 published, 1 the build or the upload failed (a
refused archive prints the API's reason), 2 bad usage, an unknown game, no checkout or no internal token.

The two routes it calls are operator-only, reached with the internal token in `x-ogm-internal` and never with a user
session: `GET /internal/operator/games/<slug>` returns the game's facts and `POST /internal/operator/games/<slug>/builds`
takes the gzipped archive with the commit in `x-gm-sha`. The upload writes a `feature` job row that the publisher
settles — `done` for a published build, `failed` for a refused archive — so the release history reads like any other
build's.

## QA a game's newest build

`ops/bin/ogm-qa` plays a registered game's newest build on the games origin like a player, with the four `gm qa`
commands (the `gm-qa` skill), and leaves one run directory:

```
ops/bin/ogm-qa blobs                      # the newest build on main, rooms with 2 clients
ops/bin/ogm-qa blobs --clients 4          # rooms with 4 clients (phone and desktop mixed)
ops/bin/ogm-qa blobs --build <buildId>    # a specific build
```

It reads the internal token like `ogm-publish` and the games origin from `OGM_GAMES_ORIGIN` (`games.env`), asks the
facts route for the newest build, then runs `gm qa open`, `gm qa drive` for each solo journey and `gm qa room` for each
room journey in `<game>/qa/journeys/`, `gm qa look` and `gm qa look --report` from the game's folder in its registered
checkout. The run lands in `~/.local/state/ogm/qa/<slug>/<buildId>/` (`OGM_QA_ROOT` moves it). Answer
`look/answers.json` there after opening the stills, then `gm qa look --report --out <run>` again. Exit codes: 0 the
report passed, 1 a step failed or a look is unanswered, 64 bad usage, 65 no game, build, origin or token.

## Sign the QA account in

Headless capture of the app shell (`gm run --frame app`, the Executor's `executor/shell-shots.mjs` with `STORAGE=…`)
lands on the Sign in card unless it carries a signed-in Playwright storage state. The QA account is a member of the
family like any player, and its state lives outside git at `~/.config/ogm/qa/storage.json` (directory 700, file 600):

1. Put the QA address on the allow list (Admin › Users) and in `api.env`: `OGM_QA_EMAILS=<address>`, then restart the
   API. Mail to that address stays in the admin inbox even with `SMTP_URL` set, so the host can read its links.
2. Invite the address to the family once (Admin › Invites, member).
3. Run `ops/bin/ogm-qa-signin`. It asks the app for a magic link, reads it from the admin inbox in the database, opens it
   in Chromium, accepts the pending invitation while the account has no family, and saves the state. It prints the
   account and its family, never the cookie.

Sessions last 7 days: run it again when a capture shows Sign in. `--origin http://127.0.0.1:5173` signs in to the local
stack instead of `OGM_APP_ORIGIN`; `--out` writes elsewhere. Exit codes: 0 saved, 1 sign-in failed, 64 bad usage, 65 no
address, origin or database.

## Prove the instance monorepo flow

Every game in an instance lives in the one repository named by `OGM_INSTANCE_REPO`: `games/<slug>/` per game and
`packages/` for components the instance's games share. No repository is created per game. This run proves that flow on
the deployed app from a phone, so it happens after a deploy and needs the operator's sign-in. It covers acceptance
checks 3, 4, 7, 11 and 18 in [acceptance.md](../plans/ogm-v1-build/acceptance.md); record the results in the pull
request, since the planning pack is frozen.

1. Sign in at `<app-origin>/login`: the age screen, then passkey or magic link, then the games picker.
2. New game: complete "Talk it through" until the job is admitted. Note the game's slug.
3. In a clone of the instance repository, confirm `games/<slug>/` is on `main`, and that creating the game added no
   repository to the account.
4. Open the game and ask build chat for a change. When the build is tested, confirm the edit landed as commits under
   `games/<slug>/` and that nothing outside that folder changed.
5. Play the draft on the phone and tap once so sound starts.
6. Publish from Releases; confirm the `<slug>/v<version>` tag and the pointer move.
7. Roll back to the previous version; confirm a second release and its own `<slug>/v<version>` tag.

Save the phone screen recording under `~/.local/share/ogm/acceptance/<date>/` with a `SHA256SUMS`, as
[acceptance.md](../plans/ogm-v1-build/acceptance.md) describes. The helper reads the folder, the commits and the release
tags a run left in that clone and prints one record to paste into the pull request; it needs no token and writes
nothing to the repository. Its exit code names the step that did not land: 2 no `games/<slug>/`, 3 no `<slug>/v*`
release tag, and 4 fewer than two releases with `--expect-rollback`.

```
ops/bin/ogm-proof --repo <clone> --slug <slug> --expect-rollback [--out <dir>]
```

## Disk and journal

`ogm-status` shows the sizes of `~/.local/share/ogm`, `~/.local/state/ogm`, `~/.aiur`, `~/.local/share/aiur` and the
user journal. `~/.aiur` grows with agent workspaces and their `.claude/worktrees`; `git worktree prune` in a checkout
drops worktree entries whose directories are gone. A permanent journal cap (`SystemMaxUse`) is a sudo hand step.
