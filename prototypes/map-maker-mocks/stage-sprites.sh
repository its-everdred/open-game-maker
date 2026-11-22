#!/usr/bin/env bash
# Copy the SmallScaleInt sprites the mocks use from the local library into ./sprites (gitignored: commercial pack art).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
lib="${ASSETS_LOCAL:-$here/../../assets-local}"
blobs="${OGM_BLOB_ROOT:?OGM_BLOB_ROOT must point at the blob store}/blobs/sha256"
env="$lib/packs/smallscaleint-fantasy-tileset-2d-isometric/2026-11-01/extracted/Environment"
rural="$lib/packs/smallscaleint-2d-hd-zombie-rural-tileset/2026-11-01/extracted/Isometric Tiles"
out="$here/sprites"
mkdir -p "$out"
for f in "Ground A2_E" "Ground H1_E" "Stone A4_E" "Stone A13_E" "Stone A5_E" "Tree A1_E" "Tree B4_E" "Flora A5_E" "Wall F1_S" "Wall F6_S" \
  "Chest A1_E" "Chest B1_E" "Door A1_E" "Torch2" "Flora B1_E" "Flora A2_E" "Tree A3_E" "Tree B1_E" "Misc A1_E" "Misc A5_E" \
  "Misc B1_E" "Misc C1_E" "WallFlora A1_E" "Roof A1_E" "Ground E3_E" "Ground C1_E"; do
  cp "$env/$f.png" "$out/$(echo "$f" | tr ' A-Z' '_a-z').png"
done
for n in A1 A3 A6 B1 B2 B3 B6; do
  for d in N E S W; do cp "$rural/Fence ${n}_$d.png" "$out/fence_$(echo "$n$d" | tr A-Z a-z | sed 's/^\(..\)/\1_/').png"; done
done
# Dusk Helm's staged character sheets (t3:dusk-helm/asset-staging/{knight,warrior}-idle, 128px frames, 4x8).
install -m 0644 "$blobs/78c46c85003940224203659e3b34b1afe8fe6fb8597830173c24838c832529b5" "$out/knight_idle.png"
install -m 0644 "$blobs/de2d3b4c61b1716ba1f1624908960a6ef2611e13f09a60ca62c2a0f585286c5b" "$out/warrior_idle.png"
