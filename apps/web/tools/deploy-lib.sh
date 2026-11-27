# Helpers for deploy.sh: step timings, an input-hash cache for the slow asset builds, the CI typecheck lookup and
# the post-upload attention line. Sourced, never run.

# Run one step and log its wall time: `timed <name> <command...>`.
timed() {
  local name="$1" started status=0
  shift
  started=$(date +%s)
  "$@" || status=$?
  printf 'deploy step: %s %ds\n' "$name" $(($(date +%s) - started))
  return "$status"
}

# Hash a step's inputs: every argument as text, and for each existing path every file's path, size and mtime.
# `--packs <dir>` lists only each pack's <pack>/<version>/extracted folder: the library holds hundreds of thousands
# of pack files (89 s to list at load ~38), other tools keep writing cards and analysis next to them, and intake
# installs or re-extracts a pack as a new extracted folder rather than editing files in place.
inputs_key() {
  local select=()
  while (($#)); do
    if [[ "$1" == --packs ]]; then
      select=(-mindepth 3 -maxdepth 3 -name extracted)
      shift
      continue
    fi
    printf 'arg %s %s\n' "${select[*]}" "$1"
    if [[ -e "$1" ]]; then
      # A dangling link or unreadable entry is skipped rather than stopping the deploy.
      find -L "$1" "${select[@]}" -printf '%P\t%s\t%T@\n' 2>/dev/null | LC_ALL=C sort || true
    fi
    select=()
    shift
  done | sha256sum | cut -d' ' -f1
}

# `cached <cache dir> <name> <key> <output...> -- <command...>`: skip the command when its last successful run had
# the same key and left the outputs exactly as they are now (a manual town.sh run without --public, for one, adds
# licensed music that only a --public run removes). Delete the cache dir to force every step.
cached() {
  local dir="$1" name="$2" key="$3" outputs=()
  shift 3
  while [[ "$1" != -- ]]; do
    outputs+=("$1")
    shift
  done
  shift
  local stamp="$dir/$name.key" output
  for output in "${outputs[@]}"; do
    if [[ ! -e "$output" ]]; then
      rm -f -- "$stamp"
      break
    fi
  done
  if [[ -f "$stamp" && "$(<"$stamp")" == "$key $(inputs_key "${outputs[@]}")" ]]; then
    printf 'deploy step: %s unchanged, skipped\n' "$name"
    return 0
  fi
  rm -f -- "$stamp"
  timed "$name" "$@"
  mkdir -p "$dir"
  printf '%s %s\n' "$key" "$(inputs_key "${outputs[@]}")" >"$stamp"
}

# Succeed when CI's workspace job (which typechecks every package) passed on this exact checkout: no tracked change
# anywhere and no untracked file under apps/web, the tree this typecheck covers.
ci_typechecked() {
  local root="$1" sha passed
  [[ -z "$(git -C "$root" status --porcelain --untracked-files=no)" ]] || return 1
  [[ -z "$(git -C "$root" status --porcelain --untracked-files=all -- apps/web)" ]] || return 1
  sha="$(git -C "$root" rev-parse HEAD)" || return 1
  passed="$(timeout 30 gh api "repos/its-everdred/open-game-maker/commits/$sha/check-runs?check_name=workspace" \
    --jq '[.check_runs[] | select(.conclusion == "success")] | length' 2>/dev/null)" || return 1
  [[ "$passed" =~ ^[1-9][0-9]*$ ]]
}

# Append one line to the Executor's attention file: $OGM_QA_ATTENTION, else the path ogm-qa-review-hook remembered.
report_attention() {
  local attention="${OGM_QA_ATTENTION:-}" remembered="${OGM_QA_ROOT:-$HOME/.local/state/ogm/qa}/attention-path"
  if [[ -z "$attention" && -f "$remembered" ]]; then
    IFS= read -r attention <"$remembered" || :
  fi
  printf 'deploy: %s\n' "$1" >&2
  if [[ -n "$attention" ]]; then
    printf '%s web deploy: %s\n' "$(date -u +%FT%TZ)" "$1" >>"$attention"
  fi
}

# The commit recorded for a deploy must identify the source actually used for the build.
source_unchanged() {
  local root="$1" sha="$2" current dirty
  current="$(git -C "$root" rev-parse HEAD)" || return 1
  dirty="$(git -C "$root" status --porcelain --untracked-files=all)" || return 1
  [[ "$current" == "$sha" && -z "$dirty" ]]
}
