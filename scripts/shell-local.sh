#!/usr/bin/env bash
# Host wrapper: point DIST at a built game, then call this script with an output directory.
# TAP uses > between exact text targets; EDIT=1 and MP4=1 add optional captures.
set -euo pipefail
: "${DIST:?Set DIST to the built game directory}"
: "${1:?Pass the output directory}"
args=(look shell --dist "$DIST" --out "$1")
if [[ -n "${TAP:-}" ]]; then args+=(--tap "$TAP"); fi
if [[ "${EDIT:-0}" == 1 ]]; then args+=(--edit); fi
if [[ "${MP4:-0}" == 1 ]]; then args+=(--mp4); fi
exec gm "${args[@]}"
