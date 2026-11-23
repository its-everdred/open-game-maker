# Skill layers

Vendored on-demand sets include AnyMachine (`skills/vendor/anymachine/`), for custom Blender props and rigged machines, and AnyKit (`skills/vendor/anykit/`), for fal Tripo/Meshy prop kits. fal runs only on the NUC host through the `skills/gm-sprite-forge/scripts/fal3d.py` ledger.

## App domains

`OGM_PUBLIC_APP_ORIGIN` in `~/.config/ogm/env/web.env` is the one app origin. Any other domain the Netlify site
answers on (the bare domain, an old name) goes in `OGM_APP_ALIAS_ORIGINS` in the same file, and
`apps/web/tools/deploy.sh` writes a `301!` from each alias to the app origin into `_redirects`. A player only ever runs
the app on the origin the services trust, so the games host's frame-ancestors, the API's auth origin and rooms CORS
(`OGM_APP_ORIGIN` in `games.env`, `api.env`, `rooms.env`) name that one origin; the deploy refuses to start when one of
them does not list it. After every upload, and before `ogm-qa-game-play` plays any game, `gm qa frame-check` frames a
game in WebKit on every app domain and fails on a refused frame (#1297).
