#!/usr/bin/env bash

set -euo pipefail

usage() {
  printf 'usage: ogm-host-setup.sh [--dry-run|--stop]\n' >&2
  exit 64
}

mode=install
if [[ $# -gt 1 ]]; then
  usage
elif [[ $# -eq 1 ]]; then
  case "$1" in
    --dry-run) mode=dry-run ;;
    --stop) mode=stop ;;
    *) usage ;;
  esac
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$script_dir" rev-parse --show-toplevel)
systemctl=${OGM_SYSTEMCTL:-systemctl}
config_home=${XDG_CONFIG_HOME:-$HOME/.config}
unit_dir=$config_home/systemd/user
ogm_config_dir=$HOME/.config/ogm
units=(ogm-api ogm-review-watchdog ogm-rooms ogm-games ogm-commit ogm-voice-host ogm-intake ogm-drive-sync ogm-backup.timer ogm-core-bump.timer ogm-qa-new-game.timer ogm-qa-publish-review.timer)

if [[ $mode == stop ]]; then
  "$systemctl" --user disable --now "${units[@]}"
  exit 0
fi

if [[ $mode == dry-run ]]; then
  printf 'Would create OGM config, data, state, and user-unit directories.\n'
  printf 'Would render OGM user units.\n'
  printf 'Would reload systemd and enable %s.\n' "${units[*]}"
  printf 'ogm-commit reads ~/.config/ogm/env/ogm-commit.env (copy services/commit/ops/ogm-commit.env.example).\n'
  exit 0
fi

install -d -m 0700 "$ogm_config_dir" "$ogm_config_dir/env"
install -d -m 0700 \
  "$HOME/.local/share/ogm/data" \
  "$HOME/.local/share/ogm/blobs" \
  "$HOME/.local/share/ogm/games" \
  "$HOME/.local/share/ogm/repos" \
  "$HOME/.local/state/ogm"
install -d -m 0755 "$unit_dir"

escaped_repo=${repo//\\/\\\\}
escaped_repo=${escaped_repo//&/\\&}
escaped_repo=${escaped_repo//#/\\#}

unit_sources=("$repo"/ops/systemd/*)
[[ -e ${unit_sources[0]:-} ]] || {
  printf 'no unit files found under ops/systemd\n' >&2
  exit 1
}

for source in "${unit_sources[@]}"; do
  name=${source##*/}
  destination=$unit_dir/$name
  temporary=$(mktemp "$unit_dir/.$name.XXXXXX")
  sed "s#@REPO@#$escaped_repo#g" "$source" > "$temporary"
  chmod 0644 "$temporary"

  if [[ -f $destination ]] && cmp -s "$temporary" "$destination"; then
    rm -f -- "$temporary"
  else
    mv -f -- "$temporary" "$destination"
    printf 'Installed %s\n' "$name"
  fi
done

"$systemctl" --user daemon-reload
"$systemctl" --user enable --now "${units[@]}"
"$systemctl" --user list-units 'ogm-*' --no-pager
