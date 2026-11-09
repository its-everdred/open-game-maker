# Hand steps

Steps only the host's owner can do: they need sudo, a browser sign-in or an approval. All are free. Each item is in the
`remind` format, so the Executor copies it into `~/remind.md` as is. An item already in `~/remind.md` is skipped.

Fill the placeholders first: `<user>` is the account that runs OGM, `<tailnet-host>` the machine's Tailscale name,
`<backup-host>` the machine that keeps backups. Other files a new host edits by hand: [self-host.md](self-host.md).

- [ ] `xdg-open <app-origin>/login` — GATE-INSTANCE-PROOF: on a phone, sign in and run the instance-monorepo proof in [runbook.md](runbook.md) "Prove the instance monorepo flow" (create a game, edit it by chat, play, publish, roll back); save the phone-size recording and the `ops/bin/ogm-proof` record under `~/.local/share/ogm/acceptance/<date>/`, then paste them into the pull request
  - ctx: docs/ops/hand-steps.md · docs/ops/runbook.md "Prove the instance monorepo flow"
- [ ] `sudo tailscale set --operator=<user>` — GATE-TS-OPERATOR: lets this account mount the 8443 and 10000 serves with `ops/bin/ogm-ingress.sh` and read `tailscale serve status` without sudo
  - ctx: OGM-008 docs/ops/hand-steps.md · docs/ops/ingress.md
- [ ] `ops/bin/ogm-ingress.sh` — approve Funnel (public HTTPS on `<tailnet-host>:8443` and `:10000`), or run it with `--tailnet-only` instead
  - ctx: OGM-008 docs/ops/hand-steps.md · docs/ops/ingress.md
- [ ] `ssh <backup-host> 'mkdir -p ~/ogm-backups && df -h ~'` — GATE-BACKUP-TARGET: confirm `<backup-host>` is the backup node, that this account can reach it over Tailscale SSH, and that it has room; then set `OGM_BACKUP_TARGET=ssh:<backup-host>:~/ogm-backups` in `~/.config/ogm/env/backup.env`
  - ctx: OGM-008 docs/ops/hand-steps.md · docs/ops/runbook.md "Backup"
- [ ] `chmod 600 ~/github/aiur/.env` — the aiur env file is group-readable (0664)
  - ctx: OGM-008 docs/ops/hand-steps.md · T03 E03-9
- [ ] `xdg-open https://github.com/signup` — GATE-MACHINE-USERS: create the free `ogm-intake` and `ogm-builder` machine users, put their PATs in the builder env file, then remove your own PAT from `~/.aiur/.env`
  - ctx: OGM-008 docs/ops/hand-steps.md · T03 E03-8
- [ ] `xdg-open https://github.com/settings/apps/new` — GATE-GITHUB-APP: create the OGM GitHub App and install it on the instance repository only (every game in an instance lives in that one repo); tick **Request user authorization (OAuth) during installation** and put its App id, PEM path, OAuth client id and client secret in `~/.config/ogm/env/ogm-commit.env`, and `OGM_INSTANCE_REPO` in `api.env` names the repo as `owner/repository`; permissions and the installation lookup are in [services/commit/README.md](../../services/commit/README.md)
  - ctx: OGM-008 docs/ops/hand-steps.md
- [ ] `xdg-open https://console.cloud.google.com/apis/credentials` — GATE-GOOGLE-OAUTH: create an OAuth client (testing mode) for Google sign-in, the main sign-in method; steps in [netlify-proxy.md](netlify-proxy.md#google-sign-in-client-gate-google-oauth); until then the page falls back to email links
  - ctx: OGM-008 docs/ops/hand-steps.md
- [ ] `sudoedit /etc/systemd/journald.conf` — optional: set `SystemMaxUse=4G` and restart `systemd-journald`; the journal holds 2 GB today
  - ctx: OGM-008 docs/ops/hand-steps.md · T11 E11-14
- [ ] `aiur login codex gamebuilder` — game-builder fleet: the Codex account the sandboxed game daemons run under; sign in once in a browser
  - ctx: docs/ops/hand-steps.md · docs/ops/sandbox.md
- [ ] `ls -l ~/.config/ogm/codex-gamebuilder/auth.json` — after the login above, link or place that login's `auth.json` here (mode 0600); each daemon's Codex home symlinks it, never copies it elsewhere
  - ctx: docs/ops/hand-steps.md · docs/ops/sandbox.md
- [ ] `sudo apt update && sudo apt install -y unrar` — first add `non-free` to your Debian apt sources (the `Components:` line of `/etc/apt/sources.list.d/debian.sources`, or each `deb` line of `/etc/apt/sources.list`; Ubuntu: `multiverse`); `unrar` lives there, and some RAR packs use a method `7z` cannot read
  - ctx: docs/ops/hand-steps.md · docs/reference/local-asset-library.md
- [ ] `pnpm --dir apps/web exec playwright install --with-deps chromium` — the `--with-deps` part installs Chromium's system libraries with sudo, once, for `gm verify` and the browser tests
  - ctx: docs/ops/hand-steps.md · apps/web/package.json
- [ ] `sudo apt install blender` — optional: only when 3D asset work starts (R87)
  - ctx: OGM-008 docs/ops/hand-steps.md
- [ ] `id <user>` — check only: do not add `<user>` to the `docker` or `kvm` groups unless OGM-037 asks for it
  - ctx: OGM-008 docs/ops/hand-steps.md · T03 §7
