#!/usr/bin/env bash
# Headless Effekseer: fetch the pinned Linux editor and export .efkproj projects to runtime .efk files.
#   effekseer.sh fetch                      download and verify Effekseer 1.80.8 (once per host)
#   effekseer.sh export <x.efkproj>...      write x.efk beside each project
# GM_EFFEKSEER_HOME overrides the install directory.
set -euo pipefail

VERSION=1.80.8
ZIP=Effekseer${VERSION}Linux.zip
SHA256=4bab586ed5664a1b02fc5bba7309050d7e6453067444fd3dacc4a9157e3de190
URL=https://github.com/effekseer/Effekseer/releases/download/1808/$ZIP
HOME_DIR=${GM_EFFEKSEER_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/gm/effekseer/$VERSION}
TOOL=$HOME_DIR/Effekseer${VERSION}Linux/Tool/Effekseer

fetch() {
  [[ -x $TOOL ]] && { echo "$TOOL"; return; }
  mkdir -p "$HOME_DIR"
  local zip=$HOME_DIR/$ZIP
  curl -fsSL -o "$zip" "$URL"
  echo "$SHA256  $zip" | sha256sum -c --quiet -
  unzip -q -o "$zip" -d "$HOME_DIR"
  rm "$zip"
  chmod +x "$TOOL" "$HOME_DIR/Effekseer${VERSION}Linux/Tool/bin/Effekseer"
  echo "$TOOL"
}

export_all() {
  [[ -x $TOOL ]] || { echo "Effekseer is not installed: run $0 fetch" >&2; exit 1; }
  local project out
  for project in "$@"; do
    # The editor changes into its own directory, so both paths must be absolute.
    project=$(realpath "$project")
    out=${project%.efkproj}.efk
    rm -f "$out"
    "$TOOL" -cui -in "$project" -e "$out" >/dev/null
    [[ -s $out ]] || { echo "export failed: $project" >&2; exit 1; }
    echo "$out"
  done
}

case ${1:-} in
  fetch) fetch ;;
  export) shift; export_all "$@" ;;
  *) sed -n '2,5p' "$0" >&2; exit 2 ;;
esac
