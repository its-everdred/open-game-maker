#!/usr/bin/env bash
# Build, inspect, and manually deploy the public app site.
# Host-local inputs (all gitignored) are the origins and OGM_INSTANCE_ALL_ASSETS in web.env, assets-local/,
# scripts/audio/.venv/,
# prototypes/ui-v0/site/assets/, prototypes/studio-v0/{town,demo}/, and
# apps/web/title-town/models/{bake,sprites,variants,candidates,mdungeon}/.
set -euo pipefail

ROOT="$(realpath "$(dirname "${BASH_SOURCE[0]}")/../../..")"
DRY_RUN=false
case "${1:-}" in
  '') ;;
  --dry-run) DRY_RUN=true ;;
  *) printf 'usage: %s [--dry-run]\n' "$0" >&2; exit 2 ;;
esac

# shellcheck source=deploy-lib.sh
source "$ROOT/apps/web/tools/deploy-lib.sh"
DEPLOY_STARTED="$(date +%s)"
DEPLOY_DIR="$(mktemp -d)"
PREVIEW_PID=''
PROTO_PID=''
PROTO_LOG=''
cleanup() {
  # Let a background prototype build finish so a retry never runs two builds over the same trees.
  if [[ -n "$PROTO_PID" ]]; then
    wait "$PROTO_PID" 2>/dev/null || true
  fi
  if [[ -n "$PROTO_LOG" ]]; then
    rm -f -- "$PROTO_LOG"
  fi
  if [[ -n "$PREVIEW_PID" ]]; then
    kill "$PREVIEW_PID" 2>/dev/null || true
    wait "$PREVIEW_PID" 2>/dev/null || true
  fi
  rm -rf -- "$DEPLOY_DIR"
}
trap cleanup EXIT

require_directory() {
  if [[ ! -d "$1" ]]; then
    printf 'deploy: required host-local directory is missing: %s\n' "$1" >&2
    exit 1
  fi
}

# Without it the build falls back to 127.0.0.1, which a phone cannot load; the reader refuses when it is unset.
GAMES_ORIGIN="$(node "$ROOT/apps/web/tools/games-origin.mjs")"
if [[ -z "$GAMES_ORIGIN" ]]; then
  printf '%s\n' 'deploy: the games origin reader printed nothing' >&2
  exit 1
fi
printf 'games origin: %s (OGM_APP_ORIGIN in games.env must list this app for frame-ancestors)\n' "$GAMES_ORIGIN"

INSTANCE_ALL_ASSETS="$(node "$ROOT/apps/web/tools/games-origin.mjs" --instance-all-assets)"
ASSET_FILTER_ARGS=()
if [[ "$INSTANCE_ALL_ASSETS" == 1 ]]; then
  printf '%s\n' 'instance assets: every host-library asset used by the screens is enabled'
else
  printf '%s\n' 'instance assets: public-only mode is enabled'
  ASSET_FILTER_ARGS+=(--public)
fi
INSTANCE_LOGO_URL="$(node "$ROOT/apps/web/tools/instance-branding.mjs")"

# The /api and /auth proxy target is a host value, so _redirects is written here and never kept in the repo.
REDIRECTS="$(node "$ROOT/apps/web/tools/redirects.mjs")"
if [[ "$DRY_RUN" == true ]]; then
  printf '%s\n' "$REDIRECTS"
fi

require_directory "$ROOT/assets-local"
require_directory "$ROOT/scripts/audio/.venv"
require_directory "$ROOT/prototypes/ui-v0/site/assets"
require_directory "$ROOT/prototypes/studio-v0/town"
require_directory "$ROOT/prototypes/studio-v0/demo"
require_directory "$ROOT/apps/web/title-town/models/bake"
require_directory "$ROOT/apps/web/title-town/models/sprites"
require_directory "$ROOT/apps/web/title-town/models/variants"
require_directory "$ROOT/apps/web/title-town/models/candidates"
require_directory "$ROOT/apps/web/title-town/models/mdungeon"

TC="$ROOT/apps/web/title-town"
PACKS="$ROOT/assets-local/packs"
# Step results keyed by their inputs; delete this directory to force every step.
CACHE="$ROOT/node_modules/.cache/ogm-deploy"
if [[ ! -d "$TC/vendor" ]]; then
  timed title-town-vendor bash "$TC/tools/build.sh"
fi
if [[ ! -d "$TC/models/sounds" ]]; then
  timed title-town-sounds bash "$TC/tools/sounds.sh"
fi

# The archived prototype's generated art/, demo/, and town/ payload is gitignored. Nothing in the web build reads it,
# so it builds alongside the web build.
PROTO_LOG="$(mktemp)"
PROTO_KEY="$(inputs_key "$ROOT/prototypes/studio-v0/tools" "$ROOT/prototypes/ui-v0/site" "$TC" --packs "$PACKS")"
cached "$CACHE" prototype "$PROTO_KEY" \
  "$ROOT/prototypes/studio-v0/art" "$ROOT/prototypes/studio-v0/demo" "$ROOT/prototypes/studio-v0/town" -- \
  bash "$ROOT/prototypes/studio-v0/tools/build.sh" >"$PROTO_LOG" 2>&1 &
PROTO_PID=$!

TOWN_KEY="$(inputs_key "${ASSET_FILTER_ARGS[@]}" "$ROOT/apps/web/tools/town.sh" "$TC" \
  "$ROOT/prototypes/ui-v0/site/assets/img/logo.png" --packs "$PACKS")"
cached "$CACHE" town "$TOWN_KEY" "$ROOT/apps/web/public/town" "$ROOT/apps/web/public/art" -- \
  bash "$ROOT/apps/web/tools/town.sh" "${ASSET_FILTER_ARGS[@]}"

timed web-deps pnpm --dir "$ROOT/apps/web" run build:deps
if ci_typechecked "$ROOT"; then
  printf '%s\n' 'deploy step: typecheck skipped, CI typechecked this commit'
else
  mkdir -p "$CACHE"
  timed typecheck pnpm --dir "$ROOT/apps/web" exec tsc --noEmit --incremental --tsBuildInfoFile "$CACHE/web.tsbuildinfo"
fi
timed web-build env VITE_GAMES_ORIGIN="$GAMES_ORIGIN" VITE_INSTANCE_LOGO_URL="$INSTANCE_LOGO_URL" \
  pnpm --dir "$ROOT/apps/web" exec vite build

PROTO_STATUS=0
wait "$PROTO_PID" || PROTO_STATUS=$?
PROTO_PID=''
cat "$PROTO_LOG"
if ((PROTO_STATUS != 0)); then
  exit "$PROTO_STATUS"
fi

STAGE_STARTED="$(date +%s)"
cp -R "$ROOT/apps/web/dist/." "$DEPLOY_DIR/"
node "$ROOT/apps/web/tools/stage-prototype.mjs" \
  "$ROOT/prototypes/studio-v0" "$ROOT/prototypes/ui-v0/site" "$DEPLOY_DIR/proto" "${ASSET_FILTER_ARGS[@]}"
# Keep the checked-in showcase images when the archived prototype build lacks
# its separately captured Goblin Cellar stills.
cp -R "$ROOT/apps/web/public/proto/art/." "$DEPLOY_DIR/proto/art/"
printf '%s\n' "$REDIRECTS" >"$DEPLOY_DIR/_redirects"
if [[ "$INSTANCE_ALL_ASSETS" == 0 && -d "$DEPLOY_DIR/art/packs" ]]; then
  find "$DEPLOY_DIR/art/packs" -maxdepth 1 -type f -name 'synty-*' -delete
fi

BUILD_STAMP="$(date +%s)"
for WORKER in "$DEPLOY_DIR/sw.js" "$DEPLOY_DIR/proto/sw.js"; do
  sed -i "s/__BUILD__/$BUILD_STAMP/" "$WORKER"
  if grep -q '__BUILD__' "$WORKER"; then
    printf 'service-worker build stamp was not replaced: %s\n' "$WORKER" >&2
    exit 1
  fi
done

if [[ "$DRY_RUN" == true ]]; then
  printf '%s\n' 'prototype payload:'
  find "$DEPLOY_DIR/proto" -type f -printf 'proto/%P\n' | LC_ALL=C sort
fi
printf 'deploy step: stage %ds\n' $(($(date +%s) - STAGE_STARTED))

# Serve the staged payload and record a throttled phone visit until the title town reports ready. Runs with errexit
# off (it is called in a condition), so every failure returns explicitly.
load_check() {
  local record_dir preview_log load_log video sheet town_ready
  record_dir="$(mktemp -d)" || return 1
  preview_log="$record_dir/preview.log"
  load_log="$record_dir/loadrec.log"
  # The bin shim execs node, so PREVIEW_PID is the server itself and cleanup stops it.
  "$ROOT/apps/web/node_modules/.bin/vite" preview "$ROOT/apps/web" \
    --host 127.0.0.1 --port 43171 --strictPort --outDir "$DEPLOY_DIR" \
    >"$preview_log" 2>&1 &
  PREVIEW_PID=$!
  for _attempt in {1..40}; do
    if curl --fail --silent --output /dev/null http://127.0.0.1:43171/; then
      break
    fi
    sleep 0.25
  done
  if ! curl --fail --silent --output /dev/null http://127.0.0.1:43171/; then
    sed -n '1,120p' "$preview_log" >&2
    return 1
  fi

  if ! node "$ROOT/apps/web/tools/loadrec.mjs" \
    "$record_dir" http://127.0.0.1:43171/ "${OGM_DEPLOY_LOAD_SECONDS:-240}" >"$load_log"; then
    sed -n '1,160p' "$load_log"
    return 1
  fi
  sed -n '1,160p' "$load_log"

  video="$(find "$record_dir" -maxdepth 1 -type f -name '*.webm' | head -n 1)"
  if [[ -z "$video" ]]; then
    printf '%s\n' 'load recording did not produce a video' >&2
    return 1
  fi
  sheet="$record_dir/sheet.png"
  ffmpeg -loglevel error -ss 0 -t 3 -i "$video" \
    -vf 'fps=12.5,scale=156:-2,tile=10x4' -frames:v 1 "$sheet" || return 1

  town_ready="$(grep ' msg town-ready$' "$load_log" | tail -n 1)"
  printf 'contact sheet: %s\n' "$sheet"
  if [[ -z "$town_ready" ]]; then
    printf '%s\n' 'deploy: load check did not report town-ready' >&2
    return 1
  fi
  printf 'town-ready: %s\n' "$town_ready"
}

total() {
  printf 'deploy step: %s after %ds\n' "$1" $(($(date +%s) - DEPLOY_STARTED))
}

if [[ "$DRY_RUN" == true ]]; then
  if ! timed load-check load_check; then
    printf '%s\n' 'deploy: load check failed; refusing to deploy' >&2
    exit 1
  fi
  total done
  exit 0
fi

# Energy counts production deploys as Netlify credits (#1219). Prepared before deploying, and a failed append after a
# successful deploy only warns, so it never prompts a second (paid) deploy.
DEPLOY_LOG="${OGM_NETLIFY_DEPLOY_LOG:-$HOME/.local/share/ogm/netlify-deploys.log}"
mkdir -p "$(dirname "$DEPLOY_LOG")"

timed upload netlify deploy --prod --no-build --filter @ogm/web --dir "$DEPLOY_DIR" \
  --site "$(<"$ROOT/apps/web/.netlify-site-id")"

date -u +%Y-%m-%dT%H:%M:%SZ >>"$DEPLOY_LOG" ||
  printf 'deploy: succeeded, but could not record it in %s\n' "$DEPLOY_LOG" >&2
total uploaded
# Post-deploy QA: the payload is live, so a failed load check wakes the Executor instead of holding the upload back.
timed load-check load_check || report_attention 'the load check on the uploaded payload failed (see the deploy log)'
# Every app domain must frame a game in WebKit, as on an iPhone (#1297): an alias whose 301 is missing, or a games
# host whose frame-ancestors lacks the app, shows Try again in every game.
timed frame-check "$ROOT/ops/bin/ogm-qa-game-play" --frames-only --repo "$ROOT" ||
  report_attention 'the frame check on the app domains failed (see the deploy log)'
total done
