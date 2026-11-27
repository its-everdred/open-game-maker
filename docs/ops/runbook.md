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

## CPU and IO priority

Prod serving (API, games host, rooms, commit, voice host) runs in `ogm-prod.slice` (CPUWeight=10000, IOWeight=1000),
so a busy agent fleet can't starve it. systemd nests dashed slice names, so it sits inside `ogm.slice` with the
background services and `ogm-agents.slice` (builder daemons and their agents, CPUWeight=50, IOWeight=10), and wins
there. `ogm.slice` itself must outweigh `app.slice`, where terminal sessions and their builds run. A host that runs the stack from a checkout without these units starts
each service with `ops/bin/ogm-prod-start <api|games|rooms|commit>`. It installs the slice, replaces the previous
`ogm-prod-<service>` unit, and logs to `~/ogm-stack.<service>.log`. Check placement with
`systemd-cgls --user-unit ogm-prod.slice`.

The API writes `<file>.br` beside each text file a build serves right after the build goes live, so the games host
streams it instead of compressing on request.

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

| Unit file        | Fill                                                                                                                                                                                                                                                                                                                                                                     | Optional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.env`        | `OGM_API_PORT`, `OGM_PUBLIC_ORIGIN`, `OGM_APP_ORIGIN`, `OGM_GAMES_ORIGIN`, `OGM_DATA_DIR`, `OGM_BLOB_ROOT`, `OGM_ROOMS_INTERNAL_URL`, `OGM_COMMIT_INTERNAL_URL`, `OGM_INSTANCE_REPO` (`owner/repository` for creator games), `OGM_BUILDER_BOT_LOGIN`, `OGM_INTAKE_BOT_LOGIN`, `OGM_VAPID_SUBJECT`; tokens you obtain: `OGM_BUILDER_BOT_TOKEN`, `OGM_INTAKE_GITHUB_TOKEN` | `OGM_INSTANCE_OWNER_ID`, `OGM_GAMES_ROOT`, `OGM_ASSETS_ROOT`, `OGM_INTAKE_DIR`, `OGM_VOICE_HOST_INTERNAL_URL`, `OGM_VOICE_WS_URL`, `OGM_BUILDER_WORKSPACES_ROOT`, `OGM_VAPID_KEY_FILE`, `OGM_GAME_TEMPLATE_REF`, `OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD`, `OGM_RESET_ZONE_DEFAULT`, `OGM_ANALYTICS_RETENTION_DAYS`, `OGM_REPORT_BUNDLE_MAX_BYTES`, `OGM_NARRATION_CONCURRENCY`, `OGM_INTAKE_SWEEP_SECONDS`, `OGM_CHAT_POLL_MS`, `OGM_COMMAND_POLL_MS`, `OGM_DESIGN_DEFAULT_MS`, `OGM_VOICE_QUESTIONS_AT`, `OGM_ALLOWED_EMAILS`, `OGM_MAINTAINER_EMAILS`, `OGM_QA_INSTANCE_REPO`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `SMTP_URL`/`SMTP_FROM`, `OGM_QA_EMAILS` |
| `rooms.env`      | `OGM_ROOMS_PORT`, `OGM_GAMES_ORIGIN`, `OGM_API_INTERNAL_URL`                                                                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `games.env`      | `OGM_GAMES_PORT`, `OGM_GAMES_ROOT`, `OGM_APP_ORIGIN`                                                                                                                                                                                                                                                                                                                     | `OGM_GAMES_SW` (defaults to the workspace's built `packages/host/dist/game-cache.js`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `voice-host.env` | `OGM_VOICE_PORT`, `OGM_VOICE_INTERNAL_PORT`, `OGM_API_INTERNAL_URL`, `OGM_VOICE_PROVIDER` (`fake`)                                                                                                                                                                                                                                                                       | Live ElevenLabs only: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `OGM_VOICE_LLM`, `OGM_VOICE_CLEANUP_ROOT`; tuning: `OGM_VOICE_MAX_SESSIONS`, `OGM_VOICE_RENDER_DIR`, `OGM_VOICE_NARRATION_ENABLED`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `intake.env`     | `OGM_ASSETS_ROOT`, `OGM_STATE_DIR`                                                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `drive-sync.env` | none; the worker reads `~/.config/ogm/drive-sync.toml` and `drive-sa.json` (`scripts/py/drive-sync/README.md`)                                                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `backup.env`     | `OGM_DATA_DIR`, `OGM_BLOB_ROOT`, `OGM_BACKUP_TARGET`                                                                                                                                                                                                                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ogm-commit.env` | `OGM_COMMIT_PORT`, `OGM_DATA_DIR`, `OGM_API_INTERNAL_URL`, `OGM_PLATFORM_ISSUE_REPO`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `OGM_BUILDER_BOT_LOGIN`                                                                                                                                                                                                            | `OGM_BLOCKLIST_FILE`, `OGM_GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `repair.env`     | `OGM_API_INTERNAL_URL`, `OGM_GAMES_ROOT`; no unit runs `services/repair` yet                                                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `core-bump.env`  | `OGM_CORE_BUMP_REPOS`, `OGM_CORE_BUMP_CORE_REPO`; the App credentials come from `ogm-commit.env`                                                                                                                                                                                                                                                                         | `OGM_CORE_BUMP_CORE_BRANCH`, `OGM_CORE_BUMP_WORK_DIR`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Names read by more than one unit must hold the same value in each file:

| Name                                                                         | Files                                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `OGM_DATA_DIR`                                                               | `api`, `backup`, `ogm-commit`                                         |
| `OGM_BLOB_ROOT`                                                              | `api`, `backup`                                                       |
| `OGM_GAMES_ROOT`                                                             | `api`, `games`, `repair`                                              |
| `OGM_APP_ORIGIN`                                                             | `api`, `games`                                                        |
| `OGM_GAMES_ORIGIN`                                                           | `api`, `rooms`                                                        |
| `OGM_ASSETS_ROOT`                                                            | `api`, `intake`                                                       |
| `OGM_API_INTERNAL_URL`                                                       | `rooms`, `voice-host`, `ogm-commit`, `repair` (the API's port)        |
| `OGM_BUILDER_BOT_LOGIN`                                                      | `api`, `ogm-commit`                                                   |
| `OGM_WS_TOKEN_SECRET`, `OGM_ROOMS_INTERNAL_SECRET`                           | `api`, `rooms`                                                        |
| `OGM_VOICE_TOKEN_SECRET`, `OGM_VOICE_INTERNAL_SECRET`                        | `api`, `voice-host`                                                   |
| `OGM_COMMIT_SERVICE_TOKEN`                                                   | `api`, `ogm-commit`                                                   |
| `OGM_INTERNAL_TOKEN`                                                         | `api`, `ogm-commit`, `repair`                                         |
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

## Run the voice host

The live stack runs its services as detached processes started by the Executor's auto-update, not as the systemd
units above, so the voice host has its own control script that follows the same pattern: env from
`~/.config/ogm/env/voice-host.env`, log in `~/ogm-stack.voice-host.log`, the browser socket on `OGM_VOICE_PORT`
(40400) and `/healthz` plus the API's internal calls on `OGM_VOICE_INTERNAL_PORT` (40401), both on `127.0.0.1`.

```
ops/bin/ogm-voice-host check-env   # names every missing or mismatched setting, never a value
ops/bin/ogm-voice-host build       # Mix deps + prod release in services/voice-host (needs mise and GitHub)
ops/bin/ogm-voice-host start       # check-env, start, wait for /healthz
ops/bin/ogm-voice-host restart     # after each build
ops/bin/ogm-voice-host ensure      # restart only when /healthz does not answer as the voice host
ops/bin/ogm-voice-host health
```

The start command creates a missing cleanup directory with mode `0700`; `check-env` reports a missing or insecure directory. Fix an existing directory with `chmod 700` before starting.

One-time host settings (`check-env` lists whichever are still missing):

- `voice-host.env`: `OGM_VOICE_TOKEN_SECRET` and `OGM_VOICE_INTERNAL_SECRET` copied from `api.env` (they must match),
  `OGM_API_INTERNAL_URL=http://127.0.0.1:<OGM_API_PORT>`, and for live voice `OGM_VOICE_PROVIDER=elevenlabs_agents`,
  `OGM_VOICE_LLM` (the agent's model), `OGM_VOICE_CLEANUP_ROOT` (a durable directory such as
  `~/.local/state/ogm/voice-cleanup`, mode `0700`) and `ELEVENLABS_AGENT_ID` (the host does not read `OGM_VOICE_AGENT_ID`).
- `api.env`: `OGM_VOICE_HOST_INTERNAL_URL=http://127.0.0.1:40401` and
  `OGM_VOICE_WS_URL=wss://<tailnet-host>:8443/ws/voice`; restart the API after.
- Ingress: `ops/bin/ogm-ingress.sh` mounts `/ws/voice` on 8443 beside `/` and `/ws/rooms`.

Auto-update wiring, in the Executor's `auto-update.sh` (`$STACK` is the stack checkout):

- In `update_ogm`, after the `pnpm -r ... build` succeeds:
  `(cd "$STACK" && ops/bin/ogm-voice-host build > "$HOME/ogm-stack.voice-build.log" 2>&1) || log "ogm: voice host build FAILED (~/ogm-stack.voice-build.log)"`
- At the end of `restart_services`:
  `"$STACK/ops/bin/ogm-voice-host" restart >> "$HOME/ogm-stack.voice-host.log" 2>&1 || log "ogm: service voice-host DOWN after restart (~/ogm-stack.voice-host.log)"`
- In the main loop, once per pass:
  `"$STACK/ops/bin/ogm-voice-host" ensure >> "$HOME/ogm-stack.voice-host.log" 2>&1 || log "ogm: voice-host down and restart failed"`

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

## Register an existing game as an operator

Run `gm games register <slug> --repo <owner>/<repo> --folder games/<slug> --title "<title>"` on the API host. It reads the API token from `api.env` and the daemon port from the checkout's `.aiur/config`; the checkout defaults to `~/games/<repo>` and can be set with `--checkout`. The repository origin must match `--repo`. The owner defaults to `OGM_INSTANCE_OWNER_ID` in the API environment, or the sole family owner when only one exists. Set that value to the instance owner’s app user ID for installations with multiple families, or pass `--owner <user-id>` for a specific registration. Use `--visibility listed` to show the game in the picker (the default is private). Repeating the command updates the title, owner, visibility and daemon details for the same game; conflicting slugs or daemon registrations are refused.

Operator publish can reuse a repository daemon checkout for multiple registered games. Those registrations do not create additional game daemon rows.

## Publish a build for a registered game

A game the app registered against a repository whose own tickets are not Game Maker jobs never gets a build: the
daemon's `before_remove` hook uploads a build per ticket, and those tickets never run in this instance's daemon. The
game appears in the picker and opens from its play link, but nothing is playable until an operator publishes a build.

`gm publish` builds one registered game at a git SHA and publishes the build through the same publisher the daemon's
uploads use, so the release history stays one path (`ops/bin/ogm-publish` is a thin wrapper that runs it with the
same arguments):

```
gm publish [<game-slug>] [--sha <ref>] [--checkout <path>] [--api <url>] [--keep] [--dry-run] [--json]
```

Run from a game folder, the slug defaults to that game (the folder of the nearest `gm.manifest.json`). It reads the
internal token, API port, app origin and games origin from `~/.config/ogm/env/api.env` (or `$OGM_ENV_DIR/api.env`;
`OGM_INTERNAL_TOKEN`, `OGM_API_PORT`, `OGM_APP_ORIGIN`, `OGM_GAMES_ORIGIN`; the same names in the environment win), asks the API for the game's facts — its folder in the
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
gm publish blobs --dry-run       # confirm registration without building or publishing
gm publish blobs --json          # one JSON line with build details, exact-build play URL and prototypeReview status
```

Re-run it with a newer SHA to publish the next release; the previous build stays playable until the new one is
tested and the branch pointer moves. Exit codes follow the gm CLI: 0 published, 1 the build or the upload failed (a
refused archive prints the API's reason), 2 bad usage, an unknown game, no checkout or no internal token.

The two routes it calls are operator-only, reached with the internal token in `x-ogm-internal` and never with a user
session: `GET /internal/operator/games/<slug>` returns the game's facts and `POST /internal/operator/games/<slug>/builds`
takes the gzipped archive with the commit in `x-gm-sha`. The upload writes a `feature` job row that the publisher
settles — `done` for a published build, `failed` for a refused archive — so the release history reads like any other
build's.

### Verify a game-workspace publish

An agent workspace does not have the host's internal token or signed-in QA session. For a ticket that needs a merged
game published and played in the app, the operator runs the following on the API host after the merge:

1. Run `gm publish <slug> --sha <merged-sha> --json` and retain its output. Confirm `state` is `done` and the returned
   `sha` is the merged commit; record the `buildId` and `play` link with the ticket's evidence.
2. Open the returned play link in a browser signed in as the QA account. In the browser's network panel, confirm the
   loaded game files use `/g/<gameId>/<buildId>/` with the `buildId` returned by publish. The play link follows the
   current build, which may have changed since the publish.
3. Exercise the ticket's actual gameplay acceptance steps in that browser. Record the steps, results, observed build ID,
   and a screen recording in a ticket- and build-specific directory under the shared `assets-local/review/` library.
   Give the agent that evidence directory and the publish output to inspect.

Keep the API token and QA storage state on the host; do not copy either into the workspace or evidence directory.
If publishing, capture, or gameplay fails, record the failure rather than treating a local `dist/` build as a
published app check.

Do not use `gm run --frame app` as proof of the published artifact: its capture substitutes the local build for game
files in the app frame.

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
room journey in `<game>/qa/journeys/`, `gm qa playtest . --all-modes` (every mode in `gm.manifest.json`, results in
`playtest/`), `gm qa look` and `gm qa look --report` from the game's folder in its registered
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

To exercise the tester journey, run `ops/bin/ogm-qa-signin --admin-state <admin-storage.json>` on the host. The
admin storage state must contain a signed-in administrator who belongs to the target family. The QA address must be in
`OGM_QA_EMAILS`; the command adds a fresh address as a maker from Admin › Users, opens the emailed link at
phone size, checks both first-run choices, and waits for the Blobs game frame. The QA address must not already be on the allow list or belong to a family. The check removes the membership and allow-list entry it created, then removes its uniquely identified invitation from the local database so repeated checks do not exhaust the daily invite limit. It does not save a session state in this mode.

Sessions last 7 days: run it again when a capture shows Sign in. `--origin http://127.0.0.1:5173` signs in to the local
stack instead of `OGM_APP_ORIGIN`; `--out` writes elsewhere. Exit codes: 0 saved, 1 sign-in failed, 64 bad usage, 65 no
address, origin or database.

## Check new game creation on prod

On the host after deploy, run `gm qa new-game-e2e --sha <deployed sha>` with the QA creator session from
`ops/bin/ogm-qa-session`. The host needs ffmpeg, its user service manager, and a `gh` credential with write access to
the QA repository (and the instance repository when cleaning older runs). The command creates a game at each phone orientation, sends two text messages,
finishes creation, and checks the private context, privacy-safe parent issue, and library progress. It saves stills,
MP4s, a result, and private recovery state under `assets-local/review/app/new-game-e2e/<sha>/`.
Set `OGM_QA_INSTANCE_REPO` in `api.env` to a separate `owner/repository` before running this check. Install the commit
service's GitHub App and grant the builder and intake credentials access to that repository. The QA creator's new games
are refused if this setting is absent or names `OGM_INSTANCE_REPO`.

It removes the QA games and their associated repository, scope and issue artifacts, including earlier QA leftovers. Cleanup
can wait up to 40 minutes for a game daemon or create operation to stop. The commit service fences each QA game while
cleanup runs; a failed or interrupted create leaves a marker for inspection rather than assuming GitHub did nothing.
If a run fails, preserve its recovery state and rerun with the same SHA; an ambiguous game or unexpected repository
change stops cleanup for inspection. `--out` selects another
evidence directory, and `--origin` and `--api` select the app and loopback API origins. The internal QA routes accept
only the internal token.

## Check the review deck on prod

`gm qa review-e2e` completes a review round and a three-option Command in the deployed app as the QA creator, so a
review change is checked without anyone's sign-in. The QA creator is its own account: a maker in a family of its own
that owns one private game (`QA Review`), never a person's account, and unlike the family member `ogm-qa-signin`
signs in. The QA game has no repository and no aiur instance: its rounds and Commands are seeded on the host, and what
the app sends to aiur for it is recorded on the host instead of starting an agent.

1. `ops/bin/ogm-qa-session` creates the QA account the first time (`qa@<app host>` unless `--email` names another
   address no one signs in with) and mints a 7-day session into `~/.config/ogm/env/qa.env` (mode 600). It prints the
   account, the game and the key names it wrote, never the cookie.
2. `gm qa review-e2e --sha <deployed sha>`, at 390×844, 844×390, 820×1180 and 1180×820: seeds a round (picture, clip,
   sound) and a Command (A picture, B clip, C sound), verifies the image decodes and the video and audio load, swipes
   the round right, undoes, swipes it left with a note, views B and C, picks B with a note, and checks that both
   verdicts reached the QA game's aiur boundary and that the deck showed no error.
   Before swiping and before picking it fails the size on what the creator would see broken: a picture with no pixels
   (`naturalWidth` 0), a clip that has not played a frame within 10 s or has an error (a looping clip drops to
   `readyState` 1 for a moment at each loop, so `readyState` alone is not the test), a sound with no length, fewer options
   than the Command carries or one inaccessible or without its media, and a round with no draggable card or no
   "Looks good" and "Needs changes" controls; the failure names each element, and the still is saved first.
   First, at each size, it seeds a running and a closed ticket on the QA game (each with a summary, a picture, a clip,
   a sound and a quoted verdict), opens the hammer, taps the running ticket and then the closed one under Completed,
   and fails the size when a detail lacks its summary, its three media or the quote, scrolls sideways, or has media
   that did not load; one still per ticket.
   One run at a time per QA env dir (`~/.config/ogm/env`): a second run waits up to 30 minutes for the first,
   because each run clears the QA game's fixtures and would wipe the other's cards.
   It deletes its fixtures, saves stills per size in `assets-local/review/app/qa-e2e/<sha>/` and ends with
   `exit=<n> qa-review-e2e` (0 passed, 1 failed). `--inject-regression` hides the round's note box and
   `--break-media` answers the review picture with a 404, each to prove a broken deck fails the run.
3. After a deploy, auto-update calls `ops/bin/ogm-qa-review-hook <have> <want> --attention <file>`. It runs both
   steps when the deploy changed the review deck (`apps/web/src/**review**`,
   `apps/web/src/features/{worker-builds,commands-inbox}/`, `apps/web/src/app/StudioMenu*`) or the review API
   (`services/api/src/{review-rounds,commands,previews,qa,worker-progress,blobs,blob-proxy}/`) and appends one line to the attention file when the run fails, which wakes the Executor. Its log is
   `~/.local/state/ogm/qa/review-e2e/<sha>.log`.

   The hook also runs `gm qa new-game-e2e` when game templates, the game repository template, games API routes,
   or commit service change. `ops/bin/ogm-host-setup.sh` installs and enables `ogm-qa-new-game.timer` for a daily
   run; it uses the deployed checkout's HEAD and saves stills under `assets-local/review/app/new-game-e2e/<sha>/`.
   The hook remembers the attention file passed by auto-update for the timer; alternatively set `OGM_QA_ATTENTION`
   in `~/.config/ogm/env/qa-hook.env`. Check the timer and its journal with `systemctl --user status
ogm-qa-new-game.timer` and `journalctl --user -u ogm-qa-new-game.service`.

   Changes to the games host, games/build API or games route also run `gm qa games-cache --game blobs --json` after a
   fresh QA session; its log is `~/.local/state/ogm/qa/games-cache/<sha>.log`, and a failed cache check appends an
   attention line. After publishing a build, compare it with its predecessor using `gm qa games-cache --game blobs
--after-publish <buildId> --json`; this reports transferred bytes for the game's files and fails if an unchanged
   content URL transfers again. The publish comparison uses the configured QA account and game origins.

   `ops/bin/ogm-host-setup.sh` also installs `ogm-qa-publish-review.timer`, which runs `gm qa publish-review-check
--all` every ten minutes. It finds published builds whose review state is still pending and appends one line per
   sweep to the configured QA attention file; explicit `Prototype review: none` results are recorded as complete and
   do not alert. Check it with `systemctl --user status ogm-qa-publish-review.timer` and `journalctl --user -u
ogm-qa-publish-review.service`.

The host routes behind it, `/internal/qa/session`, `/internal/qa/review-fixtures[/<run>]`,
`/internal/qa/ticket-fixtures[/<run>]` and `/internal/qa/voice-fixtures[/<run>]`, take only the internal
token in `x-ogm-internal`.

## Check voice on prod

`gm qa voice-e2e --sha <deployed sha>` checks one-way and two-way voice in the deployed app as the QA creator, at
390×844. It seeds a build named `QA voice` on the QA game (filed and released, so it takes no job slot and no daemon
runs it), opens its chat from the menu's builds sheet, and replaces the microphone with recorded speech
(`packages/gm-cli/qa/voice-e2e/`, 3.2 s in all):

1. One-way: holds "Hold to talk" while "Make the sky blue." plays, and passes when the message box shows the clip's
   words. The words are cleared, never sent.
2. Two-way: taps "Start voice chat", plays "Hello, can you hear me?" once the session is listening, and passes when the
   agent's audio streams back over the socket, the app plays it, and the creator's spoken turn is stored in the build's
   chat. It hangs up as soon as the reply arrives.

One run at a time per QA env dir: a second run waits up to 10 minutes, because each run replaces the voice build. It
deletes the build and its chat, saves a still per step and `voice-e2e.json` (steps, socket tally, cost) in
`assets-local/review/app/voice-e2e/<sha>/`, prints `cost elevenlabs characters=<n> minutes=<m> audio_sent_s=<s>
call_s=<s>` (characters are the account's usage before and after, so another session at the same time counts too;
`unknown` without `ELEVENLABS_API_KEY`) and ends with `exit=<n> qa-voice-e2e`. Each run spends ElevenLabs
transcription and conversational-AI credits, so it runs only when voice code changes: `ogm-qa-review-hook` runs it after
a deploy that touches a path in `ops/voice-paths` (the list CI's voice host job also reads), logs to
`~/.local/state/ogm/qa/voice-e2e/<sha>.log`, cuts off a run that takes longer than `OGM_QA_TIMEOUT_SEC` (3600), and
appends a `qa-voice-e2e failed` line to the attention file when it
fails. Run `ops/bin/ogm-voice-host build` and `restart` before it when the voice host changed.

## Check paid APIs stay off during gameplay

`ops/bin/ogm-qa-paid-apis` proves on prod that a played game cannot spend on a paid provider while the admin setting
"Allow paid APIs during gameplay" is off. As the QA creator (`qa.env`, from `ops/bin/ogm-qa-session`) and with the games
origin as `Origin`, it posts to `/api/v1/voice/token`, `/api/v1/voice/dictation-token` and the QA game's
`/narration/render`, and each must answer 403 `paid_apis_off_during_gameplay`. It then uploads a preview whose script
calls `api.openai.com`, with the QA game's daemon hook secret (another linked game's when the QA game has none), and it must
answer 422 `paid_integration`. When no game daemon holds a hook secret, the upload route rejects every caller before
the scan, so it prints `preview: unreachable` and does not fail. It makes no paid call and installs nothing: each request is one the route rejects right after its gate (an empty body,
no narration lines, an invalid cache plan in the preview), so a broken gate answers 400, 503 or 422 `cache_plan_invalid`
and the check fails. With the setting on it sends nothing and passes.

`ogm-qa-review-hook` runs it after every deploy, logs to `~/.local/state/ogm/qa/paid-apis/<sha>.log`, and appends a
`qa-paid-apis failed` line to the attention file when a request is not refused. It ends with `exit=<n> qa-paid-apis`
(0 refused, 1 not refused, 64 missing configuration).

Nothing else on the host can reach a paid provider from a game: the games origin's CSP allows `connect-src 'self'`
only, the voice host opens a provider session only for a token from the two gated routes above, and its narration
endpoint listens on its internal port, which no ingress exposes, behind the internal secret.

## Check every game plays on prod

Before any play, every app domain (`OGM_PUBLIC_APP_ORIGIN` and `OGM_APP_ALIAS_ORIGINS` in `web.env`) frames the first
game's build in WebKit with `gm qa frame-check <frame url> --app <origin>...` (#1297). It fails when a domain does not
load, the browser logs a refused frame (`frame-ancestors`, `frame-src`, `X-Frame-Options`), the frame stays empty, or
an alias does not redirect to the app origin; a failure is checked once more, then appends one `qa-frame-check failed`
line to the attention file and fails the run. A missing `OGM_PUBLIC_APP_ORIGIN` or `OGM_GAMES_ORIGIN` fails it too;
only an instance with no tested build skips it. WebKit comes from the setup's
`playwright install --with-deps chromium webkit`. `apps/web/tools/deploy.sh` runs `ogm-qa-game-play --frames-only`
after every upload.

Next, `gm qa cards-check --app <app origin> --out <dir>` opens the games list in WebKit at 390x844 with the QA session,
showing every game's real card (the API's internal `/internal/qa/cards`, QA and delisted games left out), and requires
each card's thumbnail and logo to load within 30 s and stay visible for 5 s (#1312). It visits twice, as a returning
phone does: first with the cards' originals only, then a reload that shows that cached list until the live list (with
its display variants, images slowed to a phone's pace) lands, so a card that blanks while its art changes fails. It runs in every mode, including
`--frames-only`; a failure is checked once more, then appends one `qa-cards-check failed` line naming the card, the
image and what it did, with `cards-check.json` and a still under `assets-local/review/app/cards-check/`.

`ops/bin/ogm-qa-game-play` plays each published game's latest tested build the way a player on a phone reaches it
(#1272). For each game it runs `gm qa play-check <game id> <build id>`: production's app shell at 390×844, signed in as
the QA creator (`qa.env`), waits for the bridge handshake and the game's `load.frame`, takes the game's first tap path
from its hosted `manifest.json` (the first mode's `tap`, else `playArea.tap`), and makes one input: a drag on the
host's move stick, else a key bound to `move.right`, else a swipe. It fails when the bridge is not ready, the shell
shows Try again, no first frame arrives, a tap never appears, the frame is blank, or the input changes the frame no
more than waiting does. A swipe that moves nothing is reported as unchecked instead, unless the host should have drawn
the game's move stick (a `move` stick without `touch: "self"`). One game plays at a time, in the capture slot, and
each play has a load-adjusted wall-time budget capped at 340 s; capture-slot waiting is capped at 90 s. Published JSON fetches retry transient failures and report their final cause. A boot timeout is inconclusive. A game that fails is played once more and fails only when both plays fail: a loaded host
can miss one boot, a broken game misses both.

The QA account cannot read another family's private game, so the check answers that game's own API routes from its
published build (`design/design.json`) and absorbs its writes; the shell, auth, the rest of the API and the games host
are production's. Stills (`play.png`, `ingame.png`, `input.png`, `end.png`) and `play-check.json` (verdict, bridge
trace, page errors) land in `assets-local/review/app/play-check/<build>/`.

`ogm-qa-review-hook` plays the build just published after every publish (`--game <slug> --build <id>`; `gm publish`
allows the hook 20 minutes), and every game after a deploy that touches the boot path
(`apps/web/src/{routes/game,features/editor,features/room}/`, `apps/web` build files,
`packages/{contracts,host,iframe-bridge,sdk}/`, `services/games-host/`, `services/api/src/{games,builds}/`). A game that
fails appends one `qa-game-play failed` line to the attention file with its failures, the bridge messages it got, the
host's load average and its stills folder, and fails the hook; a crash of the check itself exits 70 and the hook writes
the line instead. Replay a build against an older shell with `--web-dist <web build>`; `--stall <seconds>` holds the
game's load reports that long after the first, the silence that left the shell on Try again (#1267).

## Crash and app-open telemetry

The app shell posts to `POST /api/v1/telemetry/client-events` (#1318), signed in, at most 240 batches an account an
hour. It sends an app open on load (and again on return after 10 minutes hidden), a session end when hidden or closed,
first-frame and in-world heartbeats per game build, and crashes: the Try again overlay, a bridge timeout, a save that
could not be restored, a failed lazy chunk, a shell error, and what the game frame relays over the bridge's `fault`
message (uncaught error, unhandled rejection, CSP block, failed asset, lost WebGL context). Games relay faults once
their SDK has this change (a core bump). Each event carries the account id, a per-load session id, the origin domain,
the user agent, the app version (`VITE_APP_VERSION`, the commit `deploy.sh` built) and, for a crash, the step reached
(`loading`, `title`, `play`, `in-world`) with the last 20 breadcrumbs. The API stores events in `client_events`
(pruned after 30 days) and groups crashes in `crash_groups` by game, build and signature (crash kind, normalised
message, top stack frame, game).

`ogm-telemetry-listen` (unit `ogm-telemetry-listen`) reads the database read-only every 15 s and appends one line to
the Executor's attention file (`HS_ATTENTION`, else `OGM_QA_ATTENTION` from `qa-hook.env`; put overrides in
`~/.config/ogm/env/telemetry.env`) for each new crash group and each app open. App opens from a headless browser (the
play check below) are skipped. The first new crash of a signature opens an issue on `OGM_TELEMETRY_REPO` (default
`its-everdred/open-game-maker`, label `priority:1`, since the repository has no P0 label) with the build, the release,
tag and merged PR that published it, the message, stack, breadcrumbs and a repro path. The same signature in a new build
comments on that issue. GitHub failures are retried on later passes. State (cursor, filed issues) is in
`~/.local/state/ogm/telemetry-listen.json`; without it the listener starts from now. The post-deploy play check below
drives the production shell, so its Try again failures reach the same crash groups.

```bash
ogm-telemetry-listen stats --days 7   # per game and build: sessions, crashed sessions, crashes, first frames, in-world rate
```

## Prove the instance monorepo flow

Creator games live in the repository named by `OGM_INSTANCE_REPO`: `games/<slug>/` per game and
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
