# Skill layers

Vendored on-demand sets include AnyMachine (`skills/vendor/anymachine/`), for custom Blender props and rigged machines, and AnyKit (`skills/vendor/anykit/`), for fal Tripo/Meshy prop kits. fal runs only on the NUC host through the `skills/gm-sprite-forge/scripts/fal3d.py` ledger.

## System planning and related work

`gm-new-game-plan` groups a game's streams under system epics and features, and names the prototype where they converge.
`gm-prototype` asks workers to inspect in-flight and built work before each round and record whether to build, extend,
or fold into an owner. Aiur's overlap reviewer supplies advisory dispatch and round verdicts and periodic feature
scans. `gm work search <feature>` uses the local aiur feature registry, GitHub, the asset catalog and
local decision inventories to collect context. Its limitations are part of the output: a missing match is not proof
that no related work exists. PR checks with `gm check --body <file>` require a `## Related work` section with
`Reused:`, `Overlap:` and `Verdict:` lines, except for documentation-only changes.
The hourly meta pass can summarize per-feature consolidation proposals and reviewed weekly duplicate metrics with
[`scripts/meta/overlap-report.ts`](../scripts/meta/overlap-report.md); missing reviewer coverage remains unknown.

## App domains

`OGM_PUBLIC_APP_ORIGIN` in `~/.config/ogm/env/web.env` is the one app origin. Any other domain the Netlify site
answers on (an old name) goes in `OGM_APP_ALIAS_ORIGINS` in the same file, and
`apps/web/tools/deploy.sh` writes a `301!` from each alias to the app origin into `_redirects`. A player only ever runs
the app on the origin the services trust, so the games host's frame-ancestors, the API's auth origin and rooms CORS
(`OGM_APP_ORIGIN` in `games.env`, `api.env`, `rooms.env`) name that one origin; the deploy refuses to start when one of
them does not list it. After every upload, and before `ogm-qa-game-play` plays any game, `gm qa frame-check` frames a
game in WebKit on every app domain and fails on a refused frame or an alias that does not redirect (#1297). The bare
`makeopen.games` (and `www`) is the separate marketing site (`apps/site`, Netlify site `makeopen-site`), never an app
alias; the app is `weaver.makeopen.games` (Kevin, 2026-11-25).
