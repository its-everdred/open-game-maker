# `@ogm/api`

The platform API: Hono on `127.0.0.1:$OGM_API_PORT`, the only process that opens the SQLite database
(`$OGM_DATA_DIR/ogm.sqlite3`). Boot runs the `@ogm/db` migrations, then mounts every context.

Env (through `@ogm/config`): `OGM_API_PORT`, `OGM_ANALYTICS_RETENTION_DAYS` (default `90`), `OGM_DATA_DIR`,
`OGM_INTERNAL_TOKEN`, `OGM_JOB_TOKEN_SECRET`, `OGM_BLOB_ROOT`, `OGM_BLOB_SIGNING_KEY`, `OGM_PUBLIC_ORIGIN`,
`OGM_APP_ORIGIN`, `OGM_ROOMS_INTERNAL_URL`, `OGM_ROOMS_INTERNAL_SECRET`, `OGM_WS_TOKEN_SECRET`,
`OGM_COMMIT_INTERNAL_URL`, `OGM_COMMIT_SERVICE_TOKEN`, `OGM_GAME_TEMPLATE_REF` (defaults to `game-2d@1`),
`OGM_VAPID_KEY_FILE`, and `OGM_VAPID_SUBJECT`.

`OGM_VAPID_KEY_FILE` defaults to `~/.config/ogm/env/ogm-api.vapid.json`; the API creates the key pair with mode
`0600` on first boot. Set `OGM_VAPID_SUBJECT` to the contact email used for the Web Push `mailto:` subject.
Push requests use a 10-second socket timeout. Expired subscriptions are removed immediately; other failures are
removed after five consecutive attempts without failing the notification emitter.

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
