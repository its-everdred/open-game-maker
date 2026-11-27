#!/usr/bin/env bash
# Build and manually deploy the separate marketing site (splash at /, /setup). Never run by CI: Netlify credits are limited.
set -euo pipefail

SITE="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"
DRY_RUN=false
case "${1:-}" in
  '') ;;
  --dry-run) DRY_RUN=true ;;
  *) printf 'usage: %s [--dry-run]\n' "$0" >&2; exit 2 ;;
esac

if [[ "$DRY_RUN" == false && ! -s "$SITE/.netlify-site-id" ]]; then
  printf 'missing %s: create the site'"'"'s Netlify project and write its id there\n' "$SITE/.netlify-site-id" >&2
  exit 1
fi

# App-shaped paths leave the marketing site for the configured try-it instance. The instance host stays out of git.
REDIRECTS="$(node "$SITE/tools/redirects.mjs")"
if [[ "$DRY_RUN" == true ]]; then
  printf '%s\n' "$REDIRECTS"
fi

# build from a clean dist/ so files removed from public/ or src/ are not published
pnpm --dir "$SITE" exec tsc -b --clean
rm -rf "$SITE/dist"
pnpm --dir "$SITE" build

# dist/ also holds tsc's output (one .js, .d.ts and maps per src/**/*.ts); publish only the site files, which include
# the /setup page scripts tsc compiles from src/page/
DEPLOY_DIR="$(mktemp -d)"
trap 'rm -rf -- "$DEPLOY_DIR"' EXIT
cp -R "$SITE/dist/." "$DEPLOY_DIR/"
while IFS= read -r source; do
  stem="${source#"$SITE/src/"}"; stem="${stem%.ts}"
  rm -f "$DEPLOY_DIR/$stem".{js.map,d.ts,d.ts.map}
  [[ "$stem" == page/* ]] || rm -f "$DEPLOY_DIR/$stem.js"
done < <(find "$SITE/src" -name '*.ts')
rm -f "$DEPLOY_DIR"/*.tsbuildinfo
printf '%s\n' "$REDIRECTS" >"$DEPLOY_DIR/_redirects"
find "$DEPLOY_DIR" -type d -empty -delete
find "$DEPLOY_DIR" -type f | sed "s#^$DEPLOY_DIR##" | sort

if [[ "$DRY_RUN" == true ]]; then
  exit 0
fi

netlify deploy --prod --no-build --filter @ogm/site --dir "$DEPLOY_DIR" --site "$(<"$SITE/.netlify-site-id")"
