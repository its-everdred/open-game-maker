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

DEPLOY_DIR="$(mktemp -d)"
PREVIEW_PID=''
cleanup() {
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

if [[ ! -d "$ROOT/apps/web/title-town/vendor" ]]; then
  bash "$ROOT/apps/web/title-town/tools/build.sh"
fi
if [[ ! -d "$ROOT/apps/web/title-town/models/sounds" ]]; then
  bash "$ROOT/apps/web/title-town/tools/sounds.sh"
fi
bash "$ROOT/apps/web/tools/town.sh" "${ASSET_FILTER_ARGS[@]}"

VITE_GAMES_ORIGIN="$GAMES_ORIGIN" VITE_INSTANCE_LOGO_URL="$INSTANCE_LOGO_URL" \
  pnpm --dir "$ROOT" --filter @ogm/web build
# The archived prototype's generated art/, demo/, and town/ payload is gitignored.
bash "$ROOT/prototypes/studio-v0/tools/build.sh"
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

RECORD_DIR="$(mktemp -d)"
PREVIEW_LOG="$RECORD_DIR/preview.log"
LOAD_LOG="$RECORD_DIR/loadrec.log"
LOAD_SECONDS="${OGM_DEPLOY_LOAD_SECONDS:-240}"
pnpm --dir "$ROOT/apps/web" exec vite preview \
  --host 127.0.0.1 --port 43171 --outDir "$DEPLOY_DIR" \
  >"$PREVIEW_LOG" 2>&1 &
PREVIEW_PID=$!
for _attempt in {1..40}; do
  if curl --fail --silent --output /dev/null http://127.0.0.1:43171/; then
    break
  fi
  sleep 0.25
done
if ! curl --fail --silent --output /dev/null http://127.0.0.1:43171/; then
  sed -n '1,120p' "$PREVIEW_LOG" >&2
  exit 1
fi

node "$ROOT/apps/web/tools/loadrec.mjs" \
  "$RECORD_DIR" http://127.0.0.1:43171/ "$LOAD_SECONDS" >"$LOAD_LOG"
sed -n '1,160p' "$LOAD_LOG"

VIDEO="$(find "$RECORD_DIR" -maxdepth 1 -type f -name '*.webm' | head -n 1)"
if [[ -z "$VIDEO" ]]; then
  printf '%s\n' 'load recording did not produce a video' >&2
  exit 1
fi
SHEET="$RECORD_DIR/sheet.png"
ffmpeg -loglevel error -ss 0 -t 3 -i "$VIDEO" \
  -vf 'fps=12.5,scale=156:-2,tile=10x4' -frames:v 1 "$SHEET"

TOWN_READY="$(grep ' msg town-ready$' "$LOAD_LOG" | tail -n 1 || true)"
printf 'contact sheet: %s\n' "$SHEET"
if [[ -z "$TOWN_READY" ]]; then
  printf '%s\n' 'deploy: load check did not report town-ready; refusing to deploy' >&2
  exit 1
fi
printf 'town-ready: %s\n' "$TOWN_READY"

if [[ "$DRY_RUN" == true ]]; then
  exit 0
fi

netlify deploy --prod --no-build --filter @ogm/web --dir "$DEPLOY_DIR" \
  --site "$(<"$ROOT/apps/web/.netlify-site-id")"
