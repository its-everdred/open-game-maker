# Sandbox

What isolates a game build on this host, the evidence that it holds, and how builds get dependencies with no
network. Policy and profile: OGM-037 (`services/builder/src/policy`, `services/builder/sandbox/profile.toml`).

## The boundary as built

Two layers, one uid (`<user>`). There is no VM and no second user.

- **Layer A, commands.** Every agent command runs in Codex's Linux sandbox (bubblewrap, landlock, seccomp) under
  the `gamebuilder` permission profile: it extends `:workspace` (the job's workspace is the only writable root),
  denies `/tmp`, denies reads of the credential paths and of every other daemon workspace, and has no network.
  The invocation is `codex sandbox -P gamebuilder --sandbox-state-disable-network -- <cmd>` with the rendered
  profile in the daemon's `CODEX_HOME`. Network is denied twice: by the flag and by the profile itself.
- **Layer B, processes.** Resource caps come from `systemd --user` cgroups (`systemd-run --user --scope -p
  TasksMax=… -p MemoryMax=…`, the agents slice), not from the sandbox.

The profile's deny list is `DEFAULT_DENY_READ_ROOTS` in `services/builder/src/policy/profile.ts` plus the roots the
daemon passes: every other game workspace, `~/github/aiur/.env` and `assets-local/`.

Each managed daemon has a distinct `CODEX_HOME` at `~/.config/ogm/codex/<slug>`. Its atomic `config.toml` render names every
other stored daemon workspace, and fleet membership changes re-render and preflight every live managed daemon profile.
`auth.json` is an absolute symlink to the existing `~/.config/ogm/codex-gamebuilder/auth.json` login, so the homes
share only subscription authentication and never require a second login. The daemon env file supplies its
`CODEX_HOME`; `agent.accounts.codex` stays empty so Aiur does not replace that path with a machine account profile.
For an externally registered live daemon, the fleet checks its checkout config's workspace root and Codex writable
roots for overlap with managed workspaces. Missing or unreadable config fails the check. This verifies write-path
separation, not the external daemon's read-deny rules; its sandbox remains operator-managed.

## Probe result and the fallback in force

OGM-037's `bash scripts/sandbox/probe.sh` on the host (PR #107): every E03-9 path DENIED, network DENIED, `/tmp`
write DENIED, workspace WRITABLE, profile ACCEPTED. Codex `deny` rules hold, so spike S1's fallback (moving
credential files out of reach) is not needed.

What stays open:

- **Commands no longer inherit the daemon's environment** (closed by #118). The profile carries
  `[shell_environment_policy] inherit = "core", ignore_default_excludes = false`, so a sandboxed command sees only
  HOME, PATH, LANG, USER, LOGNAME, SHELL and PWD; `*_TOKEN` and `*_KEY` names from the caller never reach it, and
  t06 PASSes from an environment that carries them. The results block below predates that change (its t06 row
  shows the FAIL that found the gap); refresh it with `--write` from a plain host shell.
- **Same uid.** A kernel or sandbox escape is the user's own account, and the bot PAT in
  `~/.aiur/github-budget/agent-token` is readable by the daemon's processes outside Layer A (E03-8). The real fix is
  a second user: `sudo adduser ogm-builder` plus an SSH key, so the daemon runs its Codex workers over aiur's SSH
  worker seam (E03-18, Kevin's choice).

## Proof results

`bash scripts/sandbox/proof/run.sh` runs B4 §6 tests 3, 6, 9, 10, 11, 13 and 14, adapted to this host, in two temp
workspaces under `~/.cache` (removed afterwards) with the profile rendered by the builder's own renderer. Each test
prints PASS, FAIL or SKIP with what it saw; the runner exits 1 on any FAIL. Tests read no secret: readability is
`wc -c` (fstat) or `ls -A`, to `/dev/null`.

| id | B4 test | checks |
|---|---|---|
| t03 | 3 isolation | workspace A cannot list, read or write workspace B |
| t06 | 6 secrets | every path in `scripts/sandbox/paths.txt` (E03-9) unreadable; `env` has no secret-named variable |
| t09 | 9 egress | `/proc/net/dev` has only `lo`; `curl https://1.1.1.1`, `getent hosts github.com`, UDP/53 fail |
| t10 | 10 installs | `pnpm install --offline` in a copied template completes from the seeded store |
| t11 | 11 writes | `$HOME`, `/tmp`, `/usr`, workspace B and a symlink out are unwritable; workspace A is writable |
| t13 | 13 git push | `git push --dry-run` fails and `~/.config/gh/hosts.yml` is unreadable |
| t14 | 14 resources | a fork bomb stays at `pids.max` 256, a 4 GB allocation is OOM-killed at `memory.max` 2 G, `ogm-api` unchanged |

```
bash scripts/sandbox/proof/run.sh                # all tests
bash scripts/sandbox/proof/run.sh --only t06     # one test (repeatable)
bash scripts/sandbox/proof/run.sh --only t03 --fleet # t03 against two createFleet-rendered daemon homes
bash scripts/sandbox/proof/run.sh --write        # also replace the block below
bash scripts/sandbox/proof/run.sh --self-test    # wrong invocations; exits 0 only if the tests FAIL them
```

`--self-test` reruns t09 with the network opened (flag dropped and the profile's network switch on) and t03 and
t06 outside the sandbox; each must FAIL, which shows the tests can fail. Run the suite from a plain host shell,
not from inside an agent turn, and again after any Codex CLI, aiur or profile change.

<!-- proof-results -->

Run: 2026-11-01T11:41Z · codex-cli 0.162.1 · bubblewrap 0.12.0 · scripts @ b5436c6

| id | test | result | observed |
|---|---|---|---|
| t03 | cross-workspace | PASS | ws-b from ws-a: list denied, read denied, write denied |
| t06 | secret reads | FAIL | 10 DENIED, 0 READ, 1 MISSING; env: AIUR_COOKIE_FILE AIUR_GITHUB_BUDGET_IDENTITY_KEY CLAUDE_CODE_MESSAGING_TOKEN |
| t09 | egress | PASS | /proc/net/dev: lo only; curl: exit 7; getent: exit 2; udp/53: exit 1 |
| t10 | offline install | SKIP | no templates/game-*/pnpm-lock.yaml yet (OGM-023/024) |
| t11 | write boundary | PASS | $HOME denied, /tmp denied, /usr denied, ws-b denied, symlink to $HOME denied; ws-a: ok |
| t13 | git push | PASS | push: exit 128, fatal: unable to access 'https://github.com/its-everdred/open-game-maker-2000.git/': Could not resolve host: github.com; gh hosts.yml: unreadable |
| t14 | resource caps | PASS | fork bomb: pids.peak 256/256, host fork ok, scope stopped in 0s (inactive); memory.max 2147483648; 4 GB alloc: exit 143, scope result oom-kill; ogm-api: not running (check skipped) |

- t06: `~/.config/gh/hosts.yml` DENIED
- t06: `~/.aiur/github-budget/agent-token` DENIED
- t06: `~/.codex/auth.json` DENIED
- t06: `~/.claude/.credentials.json` DENIED
- t06: `~/.claude-2/.credentials.json` DENIED
- t06: `~/.config/netlify/config.json` DENIED
- t06: `~/.config/ogm` DENIED
- t06: `~/.ssh` DENIED
- t06: `~/.aiur/.env` DENIED
- t06: `~/github/aiur/.env` DENIED
- t06: `<repo>/assets-local` MISSING

<!-- /proof-results -->

## Offline dependencies

Agent commands have no network, so builds install only from a pnpm store seeded on the host.

```
bash scripts/sandbox/seed-store.sh                         # every templates/game-*/pnpm-lock.yaml (+ packages/sdk)
bash scripts/sandbox/seed-store.sh three@0.181.0           # add single packages (exact versions)
bash scripts/sandbox/seed-store.sh --core <instance-repo>   # the released core packages the instance's games install
bash scripts/sandbox/seed-store.sh --register <instance-repo>   # before the workspace's first install
bash scripts/sandbox/seed-store.sh --unregister <instance-repo> # when the instance repository is deleted
```

The store is `~/.local/share/ogm/pnpm-store` (`OGM_PNPM_STORE` overrides it). It is readable inside the sandbox and
never in the deny list; it holds no secrets. Seeding needs the registry, so the script refuses to run without a
network interface. It is idempotent and prints the store's size and package count.

Each `templates/game-*/.npmrc` carries (OGM-023/024 add it with the templates):

```
store-dir=${HOME}/.local/share/ogm/pnpm-store
offline=true
prefer-offline=true
```

and the instance setup and build flow run `pnpm install --offline` from the repository root after `gm new` writes a
game under `games/<game-slug>/`.

An instance repository's games install the published core packages (see
[core packages](core-packages.md)), so the store needs them too: `--core <instance-repo>` reads that repository's
`vendor/core-packages.json` and adds each destination name at its exact version. Re-run it after every core release.

`--register` exists because pnpm 10 writes a link to every project it installs into `<store>/projects`, and the
store is read-only inside the sandbox, so a first install fails with `EROFS`. Whatever creates the instance repository
on the host registers the workspace root first; pnpm then finds the link and leaves the store untouched.

## New dependency request

A worker never runs `npm install` or adds a package itself. When a build needs a package that is not in the store:

1. The worker raises an aiur Command (`decision.requested`, the `aiur-agent` skill's tool): "needs
   `<pkg>@<version>` because …".
2. The Executor or an admin runs `bash scripts/sandbox/seed-store.sh <pkg>@<version>` on the host and adds the
   package to the template's `package.json` and `pnpm-lock.yaml` through a platform PR.
3. They answer the Command.
4. The worker reruns `pnpm install --offline`.
