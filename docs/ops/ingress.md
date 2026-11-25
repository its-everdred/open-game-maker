# Ingress

Tailscale is the whole reverse proxy and TLS story: the node `<tailnet-host>` already has a certificate and
Funnel capability on 443, 8443 and 10000. OGM takes 8443 and 10000. Port 443 and :80 serve other apps tailnet-only and
are never touched. Every OGM service binds `127.0.0.1`; Tailscale is the only public listener.

## Origin map

```
https://makeopen.games/ (www -> apex)         Netlify marketing site (apps/site): splash, /setup; app paths 302 to weaver
https://weaver.makeopen.games/                Netlify static app (OGM-070)
https://weaver.makeopen.games/api/*   -> _redirects:  /api/*   https://<tailnet-host>:8443/api/:splat   200
https://weaver.makeopen.games/auth/*  -> _redirects:  /auth/*  https://<tailnet-host>:8443/auth/:splat  200
wss://<tailnet-host>:8443/ws/rooms/*   rooms (OGM-051), token auth, no cookies      -> 127.0.0.1:$OGM_ROOMS_PORT
wss://<tailnet-host>:8443/ws/voice/*   voice host (OGM-085), token auth              -> 127.0.0.1:$OGM_VOICE_PORT
https://<tailnet-host>:8443/*          everything else: API, /blobs/*, /ws/chat SSE  -> 127.0.0.1:$OGM_API_PORT
https://<tailnet-host>:10000/g/<gameId>/<buildId>/   games origin (OGM-007)         -> 127.0.0.1:$OGM_GAMES_PORT
https://<tailnet-host>/ (443) and :80  untouched (pre-existing tailnet-only serves)
```

Cookies stay first-party on `weaver.makeopen.games`: `/api/*` and `/auth/*` go through Netlify 200 rewrites. Netlify
proxies carry no WebSocket upgrades, so sockets connect to 8443 directly with short-lived tokens (OGM-011, OGM-052).

## Netlify lines (OGM-070 copies these)

`_redirects`, the retired-host and alias redirects and proxies before the SPA fallback. The repo holds no copy:
`apps/web/tools/deploy.sh` writes it into the deploy payload from `OGM_PUBLIC_APP_ORIGIN=https://weaver.makeopen.games`,
`OGM_APP_ALIAS_ORIGINS` (one `301!` line each) and `VITE_API_ORIGIN=https://<tailnet-host>:8443` in `~/.config/ogm/env/web.env`
(`apps/web/tools/redirects.mjs`):

```
https://ogm2000.netlify.app/*  https://weaver.makeopen.games/:splat  301!
/api/*  https://<tailnet-host>:8443/api/:splat  200
/auth/*  https://<tailnet-host>:8443/auth/:splat  200
/*  /index.html  200
```

`apps/web/public/_headers` adds the CSP to the `/*` block, next to today's `X-Robots-Tag: noindex, nofollow` and the
cache rules in `prototypes/studio-v0/tools/deploy.sh`:

```
/*
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://<tailnet-host>:8443 wss://<tailnet-host>:8443; frame-src https://<tailnet-host>:10000; img-src 'self' data: blob: https://<tailnet-host>:8443; media-src 'self' blob: https://<tailnet-host>:8443; worker-src 'self' blob:
```

## Hand step (GATE-TS-OPERATOR)

The node's operator is its owner, so the service account `<user>` cannot change serve or Funnel until Kevin runs once:

```
sudo tailscale set --operator=<user>
```

Kevin also chooses Funnel (public, needed for invites) or tailnet-only.

## Script

`ops/bin/ogm-ingress.sh [--dry-run] [--off] [--tailnet-only]` reads the four ports by name from
`~/.config/ogm/env/{api,rooms,voice-host,games}.env` (grep only; the files hold secrets and are never sourced or
printed) and runs:

```
tailscale funnel --bg --yes --https=8443 http://127.0.0.1:$OGM_API_PORT
tailscale funnel --bg --yes --https=8443 --set-path=/ws/rooms http://127.0.0.1:$OGM_ROOMS_PORT
tailscale funnel --bg --yes --https=8443 --set-path=/ws/voice http://127.0.0.1:$OGM_VOICE_PORT
tailscale funnel --bg --yes --https=10000 http://127.0.0.1:$OGM_GAMES_PORT
tailscale serve status
tailscale funnel status
```

- `--tailnet-only` runs the same mounts with `tailscale serve`, which also turns Funnel off on those ports. Tailscale
  1.104 sets Funnel per port on every mount, so all mounts on a port use the same command.
- `--off` removes the four mounts, newest first, with `tailscale serve --yes --https=<port> [--set-path=<path>] off`.
- `--dry-run` prints the commands with the real ports and calls nothing.
- Re-running is safe: the commands depend only on the env files and Tailscale replaces a mount in place.
- A failing command stops the run and prints the operator hand step.

`ops/test/ingress.sh` pins the command set with a fake `tailscale`.

## Outside check

On this host after the hand step:

```
ops/bin/ogm-ingress.sh
```

Then from a phone with Wi-Fi off (not on the tailnet):

```
curl -sS https://<tailnet-host>:8443/healthz      # {"ok":true,...}
curl -sSI https://<tailnet-host>:10000/healthz    # 200 once OGM-007 runs
```

Until OGM-010 serves `/healthz`, a loopback stand-in proves the path:

```
node -e "require('node:http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({ok:true,service:'stand-in',version:'0',uptimeSec:0}))}).listen(process.env.OGM_API_PORT,'127.0.0.1')"
```

With the stand-in stopped the same `curl` gets a Tailscale error, which shows nothing else answers on 8443.

## Mount paths

Unverified until the first real run: whether `--set-path=/ws/rooms` passes `/ws/rooms/...` to the upstream unchanged or
strips the prefix. The default assumption is unchanged, so rooms and voice mount under `/ws/rooms` and `/ws/voice`
themselves. Check with `nc -l 127.0.0.1 $OGM_ROOMS_PORT` and a `curl` to `/ws/rooms/x`, record the request line here,
and move the services' mount prefix if it is stripped.

## Caveats

- Funnel makes 8443 and 10000 reachable by anyone; sign-in and tokens (OGM-011, OGM-052) are the protection. Until they
  merge, run with `--tailnet-only`.
- Netlify bills proxied bandwidth and times proxied requests out, so only JSON goes through `/api` and `/auth`. Blobs,
  game bundles and sockets go direct to 8443 and 10000.
- Funnel traffic is relayed and its bandwidth is limited; large game bundles load slower from outside the tailnet.
- Without an owned domain all games share the 10000 origin (no per-game subdomains, D-GAMES-ORIGIN).

## Tailnet-only alternative

`ops/bin/ogm-ingress.sh --tailnet-only` keeps the same map reachable only from devices on the tailnet. Invites to
friends off the tailnet stop working; everything else is unchanged.

## Later, with a domain

A domain would allow cloudflared or Caddy with DNS-01 and per-game subdomains. Not V1.
