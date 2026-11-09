# Netlify proxy and auth origin

Safari blocks third-party cookies, so the browser must only ever see `https://makeopen.games`. The API's auth
routes reach it through Netlify 200 rewrites; cookies never cross to `ts.net` (D-ORIGIN). [ingress.md](ingress.md) has
the full origin map.

## Values to copy

| Where | Value |
| --- | --- |
| `_redirects`, written by `apps/web/tools/deploy.sh` from `OGM_PUBLIC_APP_ORIGIN` in `web.env` | `https://ogm2000.netlify.app/*  https://makeopen.games/:splat  301!` |
| `_redirects`, written by `apps/web/tools/deploy.sh` from `VITE_API_ORIGIN` in `web.env`, before the SPA fallback | `/api/*  https://<tailnet-host>:8443/api/:splat  200` |
| | `/auth/*  https://<tailnet-host>:8443/auth/:splat  200` |
| `OGM_APP_ORIGIN` in `~/.config/ogm/env/api.env` | `https://makeopen.games` (Better Auth `baseURL`, `trustedOrigins`, passkey `origin`) |
| Better Auth `basePath` | `/auth` |
| Passkey `rpID` | `makeopen.games` (host of `OGM_APP_ORIGIN`) |
| Google authorized JavaScript origin | `https://makeopen.games` |
| Google authorized redirect URI | `https://makeopen.games/auth/callback/google` |
| Magic link | `https://makeopen.games/auth/magic-link/verify?token=…` (15 min, one use) |

`ts.net` is never a trusted origin or the RP ID. Google stays off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
are both set (GATE-GOOGLE-OAUTH). With Google on, the Sign-in page offers **Continue with Google** and a passkey;
with it off, the page falls back to the email link. Invite emails still use magic links either way.

## Google sign-in client (GATE-GOOGLE-OAUTH)

The operator clicks these in the Google Cloud console; the client secret is never committed, pasted into a chat or
printed in a log.

1. Open `https://console.cloud.google.com/auth/overview` in a project of your own (no billing account is needed).
2. **Branding**: app name `Open Game Maker 2000`, your support email, authorised domain `makeopen.games`.
3. **Audience**: user type **External**, publishing status **Testing**. Add every allow-listed Google address as a
   test user: in testing mode Google refuses anyone else before the app sees them (100 test users at most). The
   allow-list at `/admin/users` still decides on top of that.
4. **Data access**: keep the default `openid`, `email` and `profile` scopes; add nothing else.
5. **Clients → Create client → Web application**, with the two Google rows from the table above: authorised
   JavaScript origin `https://makeopen.games` and authorised redirect URI `https://makeopen.games/auth/callback/google`.
   For another instance, use its `OGM_APP_ORIGIN` in both.
6. On the API host, edit `~/.config/ogm/env/api.env` (mode `0600`) and set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` from the client's download. Nothing goes in `web.env` or Netlify: the web app asks the API
   (`GET /auth/providers`) whether Google is on.
7. `systemctl --user restart ogm-api`, then check `journalctl --user -u ogm-api -n 50` shows `auth-ready` with
   `"google":true` and `curl -s https://makeopen.games/auth/providers` lists `google`.

The Google flow keeps the same-origin rule: the browser starts at `/auth/sign-in/social`, Google returns to
`/auth/callback/google` on the app origin, and Netlify proxies both to the API. An address that is not on the
allow-list is sent back to Sign-in with an error and gets no account or session.

## Cookies

- `__Secure-better-auth.session_token`: the session, 7 days, renewed daily, same attributes.

It does not set `Domain`, so it stays host-only on `makeopen.games`. `_headers` must not add caching to `/api/*` or
`/auth/*`.

## Sockets

Netlify proxies carry no WebSocket upgrades, so sockets connect to `wss://<tailnet-host>:8443` directly and
authenticate with a token, never a cookie: `POST /auth/ws-token` (an `ogw1` session proof, 5 min), room grants
(OGM-050) or the voice token (OGM-085). Native or CLI callers can send `Authorization: Bearer <session token>` (the
`set-auth-token` response header) instead of the cookie.

## Rate limits

Magic-link sends allow 10 an hour per client address (`x-nf-client-connection-ip`, then the first `x-forwarded-for`
entry) and 10 an hour per email. A caller hitting 8443 directly through Funnel can set those headers itself, so the
per-email limit is the one that holds against it.

## Age-check removal rollout

Deploy and restart the API before deploying the web app. `POST /auth/age` remains a side-effect-free `204` response so
cached copies of the old web app can cross the retired screen during the rollout; it sets no cookie and stores no age
data. After the API is live, deploy the web app and confirm Start opens email sign-in directly.

## iPhone check (after OGM-006 and OGM-070 are live)

1. Open `https://makeopen.games` in Safari, press Start, and sign in with **Continue with Google** using an
   allowed address (or, while Google is off, by magic link from the admin inbox). Confirm no birth-date screen
   appears.
2. Register a passkey, sign out, sign in with the passkey.
3. Note the iOS and Safari versions. If `Set-Cookie` arrives without `Secure` or with a `Domain`, the proxy rewrote it.
